/**
 * voice-scroll.logic.js — Voice scroll controller
 * ASR lifecycle, language detection, transcript feed, creep timer.
 * Logic layer — NO DOM operations.
 */

import {
  MATCH, CREEP, BIAS,
  tokenizeSpoken,
  buildIndices, feedTranscript as modelFeedTranscript,
  detectLanguage, ISO_TO_LOCALE, LABEL,
} from './voice-scroll.model.js';

const PRE_AUDIO_ABORT_LIMIT = 2;
const USER_OVERRIDE_GUARD_MS = 650;

/**
 * Detects the language of the script text with auto-fallback mechanisms.
 * @param {string} text - The script text to detect.
 * @returns {Promise<Object>} The detected language information.
 */
export async function detectScriptLanguage(text) {
  // 1. Try Chrome LanguageDetector API (on-device, best)
  if (typeof self !== 'undefined' && 'LanguageDetector' in self) {
    try {
      const avail = await LanguageDetector.availability();
      if (avail !== 'unavailable') {
        const det = await LanguageDetector.create();
        const excerpt = (text || '').trim().split(/\s+/).slice(0, 15).join(' ');
        if (excerpt) {
          const results = await det.detect(excerpt);
          const top = (results || []).find(r => r.detectedLanguage && r.detectedLanguage !== 'und');
          if (top) {
            const iso = top.detectedLanguage.split('-')[0];
            return { iso, locale: ISO_TO_LOCALE[iso] || 'en-US', label: LABEL[iso] || iso, confidence: top.confidence, source: 'on-device' };
          }
        }
      }
    } catch (e) { /* fallback */ }
  }
  
  // 2. Offline heuristic fallback
  const result = detectLanguage(text);
  if (result.confidence >= 0.2) {
    return { ...result, source: 'offline-heuristic' };
  }
  
  // 3. Default
  return { iso: 'vi', locale: 'vi-VN', label: 'Tiếng Việt', confidence: 0, source: 'default' };
}

/**
 * Creates and manages the SpeechRecognition lifecycle with auto-fallback.
 * @param {Object} options - Callbacks for ASR events.
 * @param {Function} options.onResult - Callback for recognition results.
 * @param {Function} options.onPhaseChange - Callback for phase changes.
 * @param {Function} options.onError - Callback for errors.
 * @returns {Object} The ASR engine interface.
 */
export function createASREngine({ onResult, onPhaseChange, onError }) {
  let recognition = null;
  let wantsListening = false;
  let locale = 'vi-VN';
  let finalTokens = [];
  let finalizedIds = new Set();
  let pendingTokens = 0;
  let rawFinalWords = [];
  let previousInterimTokens = [];
  let lastResultAt = 0;
  let restartTimer = null;
  let useLocal = false;
  let fallbackToCloud = false;
  let fatalError = false;
  let biasSupported = true;
  let settleStart = null;
  let hasLoggedListening = false;
  let sessionHadAudio = false;
  let sessionHadSound = false;
  let sessionHadSpeech = false;
  let sessionHadResult = false;
  let sessionErrorCode = '';
  let consecutivePreAudioAborts = 0;

  const log = (message, details) => {
    if (details === undefined) console.info(`[VoiceScroll] ${message}`);
    else console.info(`[VoiceScroll] ${message}`, details);
  };

  function clearRestartTimer() {
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function resolveStart(started) {
    if (!settleStart) return;
    const resolve = settleStart;
    settleStart = null;
    resolve(started);
  }
  
  // Handle Chrome two-slot interim quirk
  function handleResult(event) {
    sessionHadResult = true;
    lastResultAt = performance.now();
    let interimText = '';
    // Raw ASR trace, ported from the reference app. Log the browser payload
    // before tokenization/matching so recognition failures cannot be mistaken
    // for matcher failures.
    for (let i = event.resultIndex || 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result || !result[0]) continue;
      console.info(
        `[VoiceScroll][ASR raw] ${result.isFinal ? 'final' : 'interim'} #${i}`,
        {
          transcript: result[0].transcript || '',
          confidence: Number(result[0].confidence) || 0,
          resultIndex: event.resultIndex || 0,
          resultCount: event.results.length,
        }
      );
    }
    // Build from ALL event.results, not just resultIndex
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      if (!res) continue;
      if (res.isFinal) {
        if (!finalizedIds.has(i)) {
          finalizedIds.add(i);
          const toks = tokenizeSpoken(res[0].transcript || '');
          finalTokens.push(...toks);
          pendingTokens += toks.length;
          if (finalTokens.length > MATCH.BUF * 4) finalTokens = finalTokens.slice(-MATCH.BUF * 4);
          rawFinalWords.push(...(res[0].transcript || '').split(/\s+/).filter(Boolean));
          if (rawFinalWords.length > MATCH.BUF * 4) {
            rawFinalWords = rawFinalWords.slice(-MATCH.BUF * 4);
          }
        }
      } else {
        interimText += ' ' + (res[0].transcript || '');
      }
    }
    const interimToks = tokenizeSpoken(interimText);
    let stableInterimLength = 0;
    while (stableInterimLength < interimToks.length
      && stableInterimLength < previousInterimTokens.length
      && interimToks[stableInterimLength] === previousInterimTokens[stableInterimLength]) {
      stableInterimLength += 1;
    }
    const stableInterimToks = interimToks.slice(0, stableInterimLength);
    previousInterimTokens = interimToks;
    const allTokens = finalTokens.concat(stableInterimToks);
    const reach = pendingTokens + stableInterimToks.length;
    const tailPartial = stableInterimToks.length > 0;

    const rawTranscript = `${rawFinalWords.slice(-16).join(' ')} ${interimText}`.trim();
    log('speech result', {
      transcript: rawTranscript,
      finalTokens: finalTokens.length,
      interimTokens: interimToks.length,
      stableInterimTokens: stableInterimToks.length,
      isInterim: tailPartial,
    });
    try {
      onResult({
        allTokens,
        reach,
        tailPartial,
        interimText,
        rawFinalWords: [...rawFinalWords],
        lastResultAt,
      });
    } catch (err) {
      // A matcher/UI failure must not kill Chrome's recognition event loop.
      console.error('[VoiceScroll] transcript matching failed', err);
    }
  }

  function createRecognition(SR) {
    const instance = new SR();
    instance.lang = locale;
    instance.continuous = true;
    instance.interimResults = true;

    if (useLocal) {
      try { instance.processLocally = true; } catch {}
    }

    instance.onstart = () => {
      fatalError = false;
      sessionHadAudio = false;
      sessionHadSound = false;
      sessionHadSpeech = false;
      sessionHadResult = false;
      sessionErrorCode = '';
      previousInterimTokens = [];
      // Chrome result indexes start at zero again for each restarted session.
      // Preserve accumulated final tokens, but allow new indexes to be committed.
      finalizedIds = new Set();
      resolveStart(true);
      const details = { locale, mode: useLocal ? 'on-device' : 'browser-service' };
      if (!hasLoggedListening) {
        hasLoggedListening = true;
        log('listening', details);
      } else {
        console.debug('[VoiceScroll] listening resumed', details);
      }
      onPhaseChange?.('listening');
    };

    instance.onaudiostart = () => {
      sessionHadAudio = true;
      consecutivePreAudioAborts = 0;
      log('audio capture started');
    };

    instance.onsoundstart = () => {
      sessionHadSound = true;
      log('sound detected');
    };

    instance.onspeechstart = () => {
      sessionHadSpeech = true;
      log('speech detected');
    };

    instance.onnomatch = () => {
      console.warn('[VoiceScroll] Chrome heard speech but returned no transcript match');
    };

    instance.onresult = handleResult;

    instance.onerror = (event) => {
      const code = event?.error || 'unknown';
      sessionErrorCode = code;
      console.warn('[VoiceScroll][ASR error]', {
        error: code,
        message: event?.message || '',
        locale,
        mode: useLocal ? 'on-device' : 'browser-service',
      });
      const isPermissionError = code === 'not-allowed' || code === 'service-not-allowed';
      const isCaptureError = code === 'audio-capture';
      const canFallback = useLocal && !isPermissionError && !isCaptureError;

      if (code === 'aborted') return;
      if (code === 'no-speech') {
        log('recognition no-speech');
        return;
      }

      // Some Chrome builds expose SpeechRecognitionPhrase but the selected
      // recognition service still rejects contextual biasing asynchronously.
      // Bias is optional: disable it for this session and keep ASR running.
      if (code === 'phrases-not-supported') {
        biasSupported = false;
        try { instance.phrases = []; } catch {}
        console.warn('[VoiceScroll] contextual phrases unsupported; continuing without bias');
        return;
      }

      if (canFallback) {
        fallbackToCloud = true;
        log('on-device recognition failed; falling back', { error: code });
        return;
      }

      // Network failures are usually transient. Let onend restart the service,
      // but keep a visible diagnostic in the console.
      if (code === 'network') {
        console.warn('[VoiceScroll] transient recognition error', code);
        return;
      }

      fatalError = true;
      wantsListening = false;
      resolveStart(false);
      console.error('[VoiceScroll] recognition stopped', code);
      onError?.(code);
    };

    instance.onend = () => {
      if (!wantsListening || fatalError) {
        onPhaseChange?.('idle');
        return;
      }

      if (sessionErrorCode === 'aborted' && !sessionHadAudio) {
        consecutivePreAudioAborts += 1;
      } else if (sessionHadAudio || sessionHadResult) {
        consecutivePreAudioAborts = 0;
      }

      if (!sessionHadResult) {
        if (!sessionHadAudio) {
          console.warn('[VoiceScroll] recognition session ended without an audiostart event');
        } else if (!sessionHadSound) {
          console.warn('[VoiceScroll] microphone opened, but Chrome detected no sound');
        } else if (!sessionHadSpeech) {
          console.warn('[VoiceScroll] sound was detected, but Chrome did not classify it as speech');
        } else {
          console.warn('[VoiceScroll] speech was detected, but Chrome returned no transcript');
        }
      }
      console.info('[VoiceScroll][ASR end]', {
        hadAudio: sessionHadAudio,
        hadSound: sessionHadSound,
        hadSpeech: sessionHadSpeech,
        hadResult: sessionHadResult,
        locale,
        mode: useLocal ? 'on-device' : 'browser-service',
        preAudioAbortCount: consecutivePreAudioAborts,
      });

      // Chromium's speech service is shared at browser level. Another active
      // recognizer can repeatedly abort this session before it acquires audio.
      // Do not create an endless restart duel between tabs.
      if (consecutivePreAudioAborts >= PRE_AUDIO_ABORT_LIMIT) {
        fatalError = true;
        wantsListening = false;
        console.error(
          '[VoiceScroll] recognition is busy or repeatedly aborted before audio capture'
        );
        onPhaseChange?.('idle');
        onError?.('recognizer-busy');
        return;
      }

      const restartDelay = Math.max(250, consecutivePreAudioAborts * 500);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!wantsListening) return;
        if (fallbackToCloud) {
          fallbackToCloud = false;
          useLocal = false;
          recognition = createRecognition(SR);
        }
        try {
          recognition.start();
          console.debug('[VoiceScroll] recognition restarted', {
            mode: useLocal ? 'on-device' : 'browser-service',
          });
        } catch (err) {
          fatalError = true;
          wantsListening = false;
          const code = err?.message || 'restart-failed';
          console.error('[VoiceScroll] restart failed', err);
          onError?.(code);
          onPhaseChange?.('idle');
        }
      }, restartDelay);
    };

    return instance;
  }
  
  async function start(detectedLocale) {
    const globalScope = typeof self !== 'undefined' ? self : {};
    const SR = globalScope.SpeechRecognition || globalScope.webkitSpeechRecognition;
    if (!SR) {
      console.error('[VoiceScroll] Web Speech API is unavailable');
      onError?.('unsupported');
      return false;
    }
    
    locale = detectedLocale || 'vi-VN';
    wantsListening = true;
    finalTokens = [];
    finalizedIds = new Set();
    pendingTokens = 0;
    rawFinalWords = [];
    previousInterimTokens = [];
    lastResultAt = 0;
    fallbackToCloud = false;
    fatalError = false;
    biasSupported = true;
    hasLoggedListening = false;
    consecutivePreAudioAborts = 0;
    clearRestartTimer();
    
    // Try on-device first
    useLocal = false;
    if (SR.available) {
      try {
        const status = await Promise.race([
          SR.available({ langs: [locale], processLocally: true }),
          new Promise(r => setTimeout(() => r('timeout'), 3000))
        ]);
        useLocal = status === 'available';
      } catch { useLocal = false; }
    }

    recognition = createRecognition(SR);
    // Start unbiased. Seeding the recognizer with script phrases before it has
    // heard verified speech can make music/noise hallucinate those exact
    // phrases with a misleading confidence of 1.
    log('starting recognition', { locale, mode: useLocal ? 'on-device' : 'browser-service' });
    
    try {
      const started = new Promise((resolve) => {
        let timeoutId = null;
        settleStart = (value) => {
          if (timeoutId !== null) clearTimeout(timeoutId);
          resolve(value);
        };
        timeoutId = setTimeout(() => {
          if (!settleStart) return;
          console.error('[VoiceScroll] recognition start timed out');
          wantsListening = false;
          fatalError = true;
          resolveStart(false);
          try { recognition?.abort(); } catch {}
          onError?.('start-timeout');
        }, 10000);
      });
      recognition.start();
      return await started;
    } catch (e) {
      resolveStart(false);
      onError?.(e.message);
      return false;
    }
  }
  
  function stop() {
    wantsListening = false;
    fatalError = false;
    fallbackToCloud = false;
    clearRestartTimer();
    resolveStart(false);
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }
    log('stopped');
    onPhaseChange?.('idle');
  }
  
  function applyBias(words, cursor) {
    if (!recognition || !biasSupported || !words?.length) return 0;
    try {
      if (typeof SpeechRecognitionPhrase === 'undefined') {
        log('contextual hints unavailable');
        return 0;
      }
      // Build bias phrases
      const anchor = Math.max(0, cursor);
      const from = Math.max(0, anchor - BIAS.BEHIND);
      const to = Math.min(words.length - 1, anchor + BIAS.AHEAD);
      const phrases = [];
      const language = locale.toLowerCase().split('-')[0];
      const nearBoost = BIAS.BOOST_NEAR_BY_LANGUAGE?.[language]
        ?? BIAS.BOOST_NEAR;
      let clause = [];
      let clauseStart = from;
      const flush = () => {
        if (clause.length >= BIAS.MIN_LEN) {
          for (let s = 0; s < clause.length; s += Math.max(1, BIAS.STRIDE)) {
            const win = clause.slice(s, s + BIAS.MAX_LEN);
            if (win.length < BIAS.MIN_LEN) break;
            const dist = Math.max(0, clauseStart + s - anchor);
            phrases.push(new SpeechRecognitionPhrase(
              win.join(' '),
              dist <= BIAS.NEAR ? nearBoost : BIAS.BOOST_FAR
            ));
            if (s + BIAS.MAX_LEN >= clause.length) break;
          }
        }
        clause = [];
      };
      for (let i = from; i <= to; i++) {
        if (!clause.length) clauseStart = i;
        clause.push(words[i].raw || words[i].display);
        if (words[i].breakAfter || clause.length >= BIAS.MAX_LEN * 3) flush();
      }
      flush();
      const selected = phrases.slice(0, BIAS.MAX_PHRASES);
      recognition.phrases = selected;
      log('contextual hints applied', {
        count: selected.length,
        anchor,
        nearBoost,
        farBoost: BIAS.BOOST_FAR,
        language,
      });
      return selected.length;
    } catch (err) {
      console.warn('[VoiceScroll] contextual hints could not be applied', err);
      return 0;
    }
  }
  
  function resetStream() {
    finalTokens = [];
    finalizedIds = new Set();
    pendingTokens = 0;
    rawFinalWords = [];
    previousInterimTokens = [];
  }
  
  function getLastResultAt() { return lastResultAt; }
  function resetPending() { pendingTokens = 0; }
  
  return { start, stop, applyBias, resetStream, getLastResultAt, resetPending, isActive: () => wantsListening };
}

/**
 * Creates the main voice scroll controller that orchestrates everything.
 * @param {Object} options - Callbacks for controller events.
 * @param {Function} options.onCursorMove - Callback when the cursor moves.
 * @param {Function} options.onPhaseChange - Callback when the phase changes.
 * @param {Function} options.onError - Callback for errors.
 * @returns {Object} The voice scroll controller interface.
 */
export function createVoiceScrollController({
  onCursorMove,
  onPhaseChange,
  onError,
  onTranscript,
}) {
  // Matcher state (passed to model layer functions)
  let matcherState = null;
  let asr = null;
  let phase = 'idle';  // 'idle' | 'detecting' | 'listening'
  let biasAnchor = -1e9;
  
  // Creep state
  let wpm = CREEP.DEFAULT_WPM;
  let anchorAt = 0;
  let creepIndex = -1;
  let displayIndex = -1;
  let userOverridePending = false;
  let userAnchor = -1;
  let userGuardUntil = 0;
  let awaitingUserAnchorSpeech = false;
  
  function initMatcherState(wordParts) {
    const indices = buildIndices(wordParts);
    return {
      words: wordParts,
      ...indices,
      cursor: -1,
      displayIndex: -1,
      creepIndex: -1,
      curDrift: 0,
      stallRuns: 0,
      forcedRun: 0,
      pendingTokens: 0,
      missStreak: 0,
      lastFeedStreamLen: 0,
      lastMatchStreamLen: 0,
      lastGlobalAt: 0,
      lastMatch: null,
      feedTailPartial: false,
    };
  }
  
  function handleASRResult({ allTokens, reach, tailPartial }) {
    if (!matcherState) return;

    // Direct manipulation always wins over recognition. While a manual scroll
    // is still settling, or while an in-flight ASR result may predate the
    // user's click/scroll, drop the result before it can mutate matcher state.
    if (userOverridePending || performance.now() < userGuardUntil) {
      asr?.resetStream();
      onTranscript?.({
        tokenCount: allTokens.length,
        cursor: matcherState.cursor,
        matched: false,
        userOverride: true,
      });
      return;
    }
    
    const result = modelFeedTranscript(allTokens, reach, tailPartial, matcherState);
    const cursorMoved = result.cursor !== matcherState.cursor;
    const isGlobal = !!(result.lastMatch && result.lastMatch.global);
    const movedBehindUser = cursorMoved && userAnchor >= 0 && result.cursor < userAnchor;
    const confirmedUserAnchor = cursorMoved
      && result.cursor >= userAnchor
      && !isGlobal;

    // After a user re-anchor, only a local voice match at/after that anchor may
    // resume ASR control. A global rescue or a stale result behind the manual
    // position is never allowed to pull the prompter away from the user.
    if (movedBehindUser || (awaitingUserAnchorSpeech && !confirmedUserAnchor)) {
      asr?.resetStream();
      onTranscript?.({
        tokenCount: allTokens.length,
        cursor: matcherState.cursor,
        matched: false,
        userOverride: true,
      });
      return;
    }

    if (confirmedUserAnchor) awaitingUserAnchorSpeech = false;
    onTranscript?.({
      tokenCount: allTokens.length,
      cursor: result.cursor,
      matched: cursorMoved,
    });
    
    if (result.cursor !== undefined && cursorMoved) {
      const prev = matcherState.cursor;
      
      // Update reading speed (EMA)
      const now = performance.now();
      if (prev >= 0 && result.cursor > prev && anchorAt) {
        const secs = (now - anchorAt) / 1000;
        if (secs > 0.25 && secs < 12) {
          const measured = ((result.cursor - prev) / secs) * 60;
          if (measured >= CREEP.MIN_WPM && measured <= CREEP.MAX_WPM) {
            wpm = wpm * 0.7 + measured * 0.3;
          }
        }
      }
      anchorAt = now;
      displayIndex = result.cursor;
      creepIndex = result.cursor;
      
      // Notify UI to scroll
      onCursorMove?.({
        cursor: result.cursor,
        displayIndex,
        isGlobal,
        words: result.words,
      });
      console.info('[VoiceScroll] cursor matched', {
        previous: prev,
        cursor: result.cursor,
        global: isGlobal,
      });
      asr?.resetPending();
      
      // Update contextual biasing
      if (asr && Math.abs(result.cursor - biasAnchor) >= BIAS.REFRESH_EVERY) {
        asr.applyBias(result.words, result.cursor);
        biasAnchor = result.cursor;
      }
    }
    
    matcherState = result;
  }
  
  async function start(wordParts, scriptText) {
    if (phase !== 'idle') return;
    phase = 'detecting';
    onPhaseChange?.('detecting');
    
    // Initialize matcher
    matcherState = initMatcherState(wordParts);
    wpm = CREEP.DEFAULT_WPM;
    anchorAt = 0;
    creepIndex = -1;
    displayIndex = -1;
    biasAnchor = -1e9;
    userOverridePending = false;
    userAnchor = -1;
    userGuardUntil = 0;
    awaitingUserAnchorSpeech = false;
    
    // Detect language
    const detected = await detectScriptLanguage(scriptText);
    console.info('[VoiceScroll] language detected', detected);
    
    // Start ASR
    asr = createASREngine({
      onResult: handleASRResult,
      onPhaseChange: (p) => {
        phase = p === 'listening' ? 'listening' : phase;
        onPhaseChange?.(phase);
      },
      onError: (err) => {
        phase = 'idle';
        onPhaseChange?.('idle');
        const message = err === 'unsupported'
          ? 'Browser does not support Web Speech API'
          : err;
        onError?.(message);
      },
    });
    
    // Recognition starts unbiased. Context is introduced only after the reader
    // has already advanced far enough to establish a real content match.
    biasAnchor = 0;
    const started = await asr.start(detected.locale);
    if (!started) {
      phase = 'idle';
      onPhaseChange?.('idle');
      return false;
    }
    
    return true;
  }
  
  function stop() {
    if (asr) { asr.stop(); asr = null; }
    phase = 'idle';
    matcherState = null;
    userOverridePending = false;
    userAnchor = -1;
    userGuardUntil = 0;
    awaitingUserAnchorSpeech = false;
    onPhaseChange?.('idle');
  }
  
  function beginUserOverride() {
    if (!matcherState || userOverridePending) return;
    userOverridePending = true;
    userGuardUntil = performance.now() + USER_OVERRIDE_GUARD_MS;
    awaitingUserAnchorSpeech = true;
    asr?.resetStream();
  }

  function setCursorTo(index, { userInitiated = false } = {}) {
    if (!matcherState || index < 0 || index >= matcherState.words.length) return;
    if (userInitiated) {
      userOverridePending = false;
      userAnchor = index;
      userGuardUntil = performance.now() + USER_OVERRIDE_GUARD_MS;
      awaitingUserAnchorSpeech = true;
    }
    matcherState.cursor = index - 1;
    displayIndex = index;
    creepIndex = index;
    anchorAt = performance.now();
    matcherState.missStreak = 0;
    matcherState.stallRuns = 0;
    matcherState.forcedRun = 0;
    matcherState.pendingTokens = 0;
    matcherState.lastFeedStreamLen = 0;
    matcherState.lastMatchStreamLen = 0;
    matcherState.curDrift = 0;
    matcherState.lastGlobalAt = 0;
    matcherState.lastMatch = null;
    matcherState.feedTailPartial = false;
    if (asr) {
      asr.resetStream();
      // A direct re-anchor changes the user's expected reading context, so
      // replace the recognizer hints immediately instead of waiting for the
      // normal BIAS.REFRESH_EVERY cursor advance.
      asr.applyBias(matcherState.words, index);
      biasAnchor = index;
    }
  }
  
  // Creep state getters for UI layer
  function getCreepInfo() {
    return {
      cursor: matcherState?.cursor ?? -1,
      creepIndex,
      displayIndex,
      wpm,
      anchorAt,
      // Only a confirmed content match may keep optimistic creep alive. Raw
      // ASR noise must not extend scrolling merely by emitting transcripts.
      lastResultAt: anchorAt,
      wordsLength: matcherState?.words.length ?? 0,
    };
  }
  
  function updateCreepIndex(newIndex) {
    creepIndex = newIndex;
  }
  
  return {
    start,
    stop,
    beginUserOverride,
    setCursorTo,
    getCreepInfo,
    updateCreepIndex,
    isActive: () => phase !== 'idle',
    getPhase: () => phase,
    getWords: () => matcherState?.words ?? [],
    getCursor: () => matcherState?.cursor ?? -1,
  };
}
