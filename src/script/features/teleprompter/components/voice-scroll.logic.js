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
const MAX_ASR_CURSOR_ADVANCE = 8;
const LOCAL_PACK_CHECK_TIMEOUT_MS = 3000;
const MIN_PACK_LANGUAGE_CONFIDENCE = 0.35;
const LANGUAGE_DETECTION_SAMPLE_WORDS = 200;
const LANGUAGE_DETECTOR_IDLE_RELEASE_MS = 5 * 60 * 1000;
const speechPackInstallJobs = new Map();
const speechPackResultCache = new Map();
const readySpeechPackLocales = new Set();
const SPEECH_PACK_RESULT_TTL_MS = Object.freeze({
  available: 5 * 60 * 1000,
  installed: 5 * 60 * 1000,
  unavailable: 10 * 60 * 1000,
  timeout: 60 * 1000,
  failed: 60 * 1000,
});
let cachedLanguageDetectorAPI = null;
let cachedLanguageDetector = null;
let languageDetectorLoadPromise = null;
let languageDetectorAvailabilityPromise = null;
let languageDetectorAvailability = null;
let languageDetectorReleaseTimer = null;

function speechRecognitionConstructor() {
  const globalScope = typeof self !== 'undefined' ? self : {};
  return globalScope.SpeechRecognition || globalScope.webkitSpeechRecognition || null;
}

function supportsOnDeviceSpeechInstall(SR) {
  if (!SR?.available || !SR?.install) return false;
  if (SR.prototype && 'processLocally' in SR.prototype) return true;
  try {
    return 'processLocally' in new SR();
  } catch {
    return false;
  }
}

function rememberSpeechPackResult(result) {
  const ttl = SPEECH_PACK_RESULT_TTL_MS[result.status];
  if (ttl === undefined) return result;
  if (result.status === 'available' || result.status === 'installed') {
    readySpeechPackLocales.add(result.locale);
  }
  speechPackResultCache.set(result.locale, {
    result,
    expiresAt: ttl === Infinity ? Infinity : Date.now() + ttl,
  });
  return result;
}

async function localSpeechAvailability(SR, locale, timeoutMs = LOCAL_PACK_CHECK_TIMEOUT_MS) {
  if (!SR?.available) return 'unsupported';
  try {
    return await Promise.race([
      SR.available({ langs: [locale], processLocally: true }),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ]);
  } catch {
    return 'unavailable';
  }
}

function resetLanguageDetectorCache(API) {
  if (cachedLanguageDetectorAPI === API) return;
  releaseLanguageDetector();
  cachedLanguageDetectorAPI = API;
  languageDetectorAvailabilityPromise = null;
  languageDetectorAvailability = null;
}

function scheduleLanguageDetectorRelease() {
  clearTimeout(languageDetectorReleaseTimer);
  languageDetectorReleaseTimer = setTimeout(() => {
    releaseLanguageDetector();
  }, LANGUAGE_DETECTOR_IDLE_RELEASE_MS);
  languageDetectorReleaseTimer?.unref?.();
}

export function releaseLanguageDetector() {
  clearTimeout(languageDetectorReleaseTimer);
  languageDetectorReleaseTimer = null;
  try {
    cachedLanguageDetector?.destroy?.();
  } catch { /* best-effort browser resource release */ }
  cachedLanguageDetector = null;
  languageDetectorLoadPromise = null;
}

function checkLanguageDetectorAvailability(API) {
  resetLanguageDetectorCache(API);
  if (languageDetectorAvailability) {
    return Promise.resolve(languageDetectorAvailability);
  }
  if (languageDetectorAvailabilityPromise) return languageDetectorAvailabilityPromise;

  const pending = Promise.resolve()
    .then(() => API.availability())
    .then((status) => {
      languageDetectorAvailability = status;
      return status;
    })
    .catch(() => {
      languageDetectorAvailability = 'unavailable';
      return 'unavailable';
    });
  languageDetectorAvailabilityPromise = pending;
  return pending;
}

function startLanguageDetectorLoad(API, { onProgress } = {}) {
  resetLanguageDetectorCache(API);
  if (cachedLanguageDetector) {
    return Promise.resolve({ status: 'available', detector: cachedLanguageDetector });
  }
  if (languageDetectorLoadPromise) return languageDetectorLoadPromise;

  let created;
  try {
    created = API.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          onProgress?.(Number(event.loaded) || 0);
        });
      },
    });
  } catch (error) {
    return Promise.resolve({
      status: 'failed',
      error: error?.message || String(error),
    });
  }

  const pending = Promise.resolve(created)
    .then((detector) => {
      cachedLanguageDetector = detector;
      languageDetectorAvailability = 'available';
      scheduleLanguageDetectorRelease();
      return { status: 'available', detector };
    })
    .catch((error) => {
      if (languageDetectorLoadPromise === pending) {
        languageDetectorLoadPromise = null;
      }
      return { status: 'failed', error: error?.message || String(error) };
    });
  languageDetectorLoadPromise = pending;
  return pending;
}

/**
 * Preloads Chrome's shared LanguageDetector model. Callers should fire and
 * forget this promise; detection uses the offline heuristic while it is pending.
 */
export function preloadLanguageDetector({ allowDownload = false, onProgress } = {}) {
  const API = typeof self !== 'undefined' ? self.LanguageDetector : null;
  if (!API?.availability || !API?.create) {
    return Promise.resolve({ status: 'unsupported' });
  }
  resetLanguageDetectorCache(API);
  if (cachedLanguageDetector) {
    return Promise.resolve({ status: 'available', detector: cachedLanguageDetector });
  }
  if (languageDetectorLoadPromise) return languageDetectorLoadPromise;

  // When an earlier idle preflight already learned the state, a user gesture
  // can enter create() synchronously instead of losing transient activation to
  // another availability await.
  const known = languageDetectorAvailability;
  if (known === 'available'
    || (allowDownload && (known === 'downloadable' || known === 'downloading'))) {
    return startLanguageDetectorLoad(API, { onProgress });
  }

  return checkLanguageDetectorAvailability(API).then((availability) => {
    if (availability === 'available'
      || (allowDownload
        && (availability === 'downloadable' || availability === 'downloading'))) {
      return startLanguageDetectorLoad(API, { onProgress });
    }
    return { status: availability || 'unavailable' };
  });
}

async function readyLanguageDetector() {
  const API = typeof self !== 'undefined' ? self.LanguageDetector : null;
  if (!API?.availability || !API?.create) return null;
  resetLanguageDetectorCache(API);
  if (cachedLanguageDetector) {
    scheduleLanguageDetectorRelease();
    return cachedLanguageDetector;
  }

  // Critical fallback rule: never wait for an in-flight model download.
  if (languageDetectorLoadPromise) return null;

  const availability = await checkLanguageDetectorAvailability(API);
  if (cachedLanguageDetector) {
    scheduleLanguageDetectorRelease();
    return cachedLanguageDetector;
  }
  if (languageDetectorLoadPromise || availability !== 'available') return null;
  const loaded = await startLanguageDetectorLoad(API);
  return loaded.status === 'available' ? loaded.detector : null;
}

/**
 * Detects the language of the script text with auto-fallback mechanisms.
 * @param {string} text - The script text to detect.
 * @returns {Promise<Object>} The detected language information.
 */
export async function detectScriptLanguage(text) {
  // 1. Try Chrome LanguageDetector API (on-device, best)
  const detector = await readyLanguageDetector();
  if (detector) {
    try {
      const excerpt = (text || '').trim().split(/\s+/)
        .slice(0, LANGUAGE_DETECTION_SAMPLE_WORDS)
        .join(' ');
      if (excerpt) {
        const results = await detector.detect(excerpt);
        const top = (results || []).find(r => r.detectedLanguage && r.detectedLanguage !== 'und');
        if (top) {
          const detectedTag = top.detectedLanguage;
          const iso = detectedTag.split('-')[0];
          return {
            iso,
            locale: ISO_TO_LOCALE[iso] || detectedTag,
            label: LABEL[iso] || detectedTag,
            confidence: top.confidence,
            source: 'on-device',
          };
        }
      }
    } catch { /* fallback */ }
  }
  
  // 2. Offline heuristic fallback
  const result = detectLanguage(text);
  if (result.confidence >= MIN_PACK_LANGUAGE_CONFIDENCE) {
    return { ...result, source: 'offline-heuristic' };
  }
  
  // 3. Default
  return { iso: 'vi', locale: 'vi-VN', label: 'Tiếng Việt', confidence: 0, source: 'default' };
}

/**
 * Checks and, when possible, installs the on-device speech-recognition pack.
 * Installation is intentionally non-blocking at call sites: browser-service
 * recognition remains available while Chrome downloads the local pack.
 */
export async function ensureOnDeviceSpeechPack(locale, { onStatus } = {}) {
  const SR = speechRecognitionConstructor();
  const report = (status, details = {}) => {
    const result = { locale, status, ...details };
    onStatus?.(result);
    return result;
  };

  if (!locale || !supportsOnDeviceSpeechInstall(SR)) {
    return report('unsupported');
  }

  const cached = speechPackResultCache.get(locale);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      const result = { ...cached.result, cached: true };
      onStatus?.(result);
      return result;
    }
    speechPackResultCache.delete(locale);
  }

  const existing = speechPackInstallJobs.get(locale);
  if (existing) {
    report('downloading');
    const result = await existing;
    onStatus?.(result);
    return result;
  }

  const job = (async () => {
    const availability = await localSpeechAvailability(SR, locale);
    if (availability === 'available') {
      return rememberSpeechPackResult(report('available'));
    }
    if (availability === 'unavailable' || availability === 'timeout') {
      return rememberSpeechPackResult(report(availability));
    }

    // Both `downloadable` and `downloading` are handled by install(). Chrome
    // either starts the pack download or joins the download already in flight.
    report('downloading', { availability });
    try {
      const installed = await SR.install({
        langs: [locale],
        processLocally: true,
      });
      if (!installed) return rememberSpeechPackResult(report('failed'));

      const verified = await localSpeechAvailability(SR, locale);
      return rememberSpeechPackResult(
        report(verified === 'available' ? 'installed' : 'failed', {
          availability: verified,
        }),
      );
    } catch (error) {
      return rememberSpeechPackResult(
        report('failed', { error: error?.message || String(error) }),
      );
    }
  })();

  speechPackInstallJobs.set(locale, job);
  try {
    return await job;
  } finally {
    if (speechPackInstallJobs.get(locale) === job) {
      speechPackInstallJobs.delete(locale);
    }
  }
}

/**
 * Detects the script language and warms its on-device ASR pack. Ambiguous text
 * is left alone so the default locale cannot trigger an unrelated download.
 */
export async function prepareSpeechPackForText(text, { onStatus } = {}) {
  if (!(text || '').trim()) {
    const result = { status: 'empty' };
    onStatus?.(result);
    return result;
  }

  const detected = await detectScriptLanguage(text);
  onStatus?.({ status: 'detected', ...detected });
  if (detected.confidence < MIN_PACK_LANGUAGE_CONFIDENCE || detected.source === 'default') {
    const result = { status: 'uncertain', ...detected };
    onStatus?.(result);
    return result;
  }

  const packPromise = ensureOnDeviceSpeechPack(detected.locale, {
    onStatus: (pack) => onStatus?.({ ...pack, detected }),
  });
  return { status: 'preparing', detected, packPromise };
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
  let lastDeliveredTokens = [];
  let lastResultAt = 0;
  let restartTimer = null;
  let useLocal = false;
  let fallbackToCloud = false;
  let localDisabledForSession = false;
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

  function sameTokens(left, right) {
    return left.length === right.length
      && left.every((token, index) => token === right[index]);
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
    // A cumulative Chrome final can contain dozens of old words. Its length is
    // not evidence that the reader skipped the same number of unread words.
    const reach = Math.min(
      pendingTokens + stableInterimToks.length,
      MAX_ASR_CURSOR_ADVANCE
    );
    const tailPartial = stableInterimToks.length > 0;

    const rawTranscript = `${rawFinalWords.slice(-16).join(' ')} ${interimText}`.trim();
    log('speech result', {
      transcript: rawTranscript,
      finalTokens: finalTokens.length,
      interimTokens: interimToks.length,
      stableInterimTokens: stableInterimToks.length,
      isInterim: tailPartial,
    });
    // Chrome commonly emits the same token stream once as a stable interim and
    // again as final. Feeding both lets one utterance advance the cursor twice.
    if (sameTokens(allTokens, lastDeliveredTokens)) return;
    lastDeliveredTokens = [...allTokens];
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
        localDisabledForSession = true;
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
        } else if (!useLocal
          && !localDisabledForSession
          && readySpeechPackLocales.has(locale)) {
          // A pack may have finished downloading while browser-service
          // recognition was active. Upgrade on a natural recognition restart
          // instead of interrupting the user's current utterance.
          useLocal = true;
          recognition = createRecognition(SR);
          log('on-device language pack ready; upgrading recognition', { locale });
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
    const SR = speechRecognitionConstructor();
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
    lastDeliveredTokens = [];
    lastResultAt = 0;
    fallbackToCloud = false;
    localDisabledForSession = false;
    fatalError = false;
    biasSupported = true;
    hasLoggedListening = false;
    consecutivePreAudioAborts = 0;
    clearRestartTimer();
    
    // Try on-device first
    useLocal = false;
    const localStatus = await localSpeechAvailability(SR, locale);
    useLocal = localStatus === 'available';
    if (useLocal) readySpeechPackLocales.add(locale);

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
    localDisabledForSession = false;
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
    lastDeliveredTokens = [];
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
      lastMatch: null,
      feedTailPartial: false,
    };
  }
  
  function handleASRResult({ allTokens, reach, tailPartial }) {
    if (!matcherState) return;

    // An explicit word selection wins over recognition. While its transition
    // is settling, drop any in-flight ASR result that may predate the click.
    if (performance.now() < userGuardUntil) {
      asr?.resetStream();
      onTranscript?.({
        tokenCount: allTokens.length,
        cursor: matcherState.cursor,
        matched: false,
        userOverride: true,
      });
      return;
    }
    
    let result = modelFeedTranscript(allTokens, reach, tailPartial, matcherState);
    const previousCursor = matcherState.cursor;
    const isSequentialRecovery = !!result.lastMatch?.sequentialRecovery;
    if (!isSequentialRecovery
      && result.cursor > previousCursor + MAX_ASR_CURSOR_ADVANCE) {
      const rawCursor = result.cursor;
      const cursor = previousCursor + MAX_ASR_CURSOR_ADVANCE;
      result = {
        ...result,
        cursor,
        lastMatch: result.lastMatch
          ? { ...result.lastMatch, end: cursor, rawEnd: rawCursor, clamped: true }
          : result.lastMatch,
      };
      console.info('[VoiceScroll] cursor advance clamped', {
        previous: previousCursor,
        requested: rawCursor,
        accepted: cursor,
      });
    }
    const cursorMoved = result.cursor !== matcherState.cursor;
    const movedBehindUser = cursorMoved && userAnchor >= 0 && result.cursor < userAnchor;
    const confirmedUserAnchor = cursorMoved
      && result.cursor >= userAnchor;

    // After an explicit word re-anchor, only a local voice match at/after that
    // anchor may resume ASR control. A stale result behind the selected word
    // is never allowed to pull the prompter away from the user.
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
        words: result.words,
      });
      console.info('[VoiceScroll] cursor matched', {
        previous: prev,
        cursor: result.cursor,
        sequentialRecovery: isSequentialRecovery,
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
  
  async function start(wordParts, scriptText, detectedLanguage = null) {
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
    userAnchor = -1;
    userGuardUntil = 0;
    awaitingUserAnchorSpeech = false;
    
    // Detect language
    const detected = detectedLanguage || await detectScriptLanguage(scriptText);
    console.info('[VoiceScroll] language detected', detected);

    // Start or join the pack download without holding up recognition. The ASR
    // engine below uses browser-service until the local pack becomes available.
    if (detected.confidence >= MIN_PACK_LANGUAGE_CONFIDENCE && detected.source !== 'default') {
      void ensureOnDeviceSpeechPack(detected.locale);
    }
    
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
    userAnchor = -1;
    userGuardUntil = 0;
    awaitingUserAnchorSpeech = false;
    onPhaseChange?.('idle');
  }
  
  function setCursorTo(index, { userInitiated = false } = {}) {
    if (!matcherState || index < 0 || index >= matcherState.words.length) return;
    if (userInitiated) {
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

  function isUserOverrideActive() {
    return awaitingUserAnchorSpeech
      || performance.now() < userGuardUntil;
  }
  
  return {
    start,
    stop,
    setCursorTo,
    getCreepInfo,
    updateCreepIndex,
    isActive: () => phase !== 'idle',
    getPhase: () => phase,
    getWords: () => matcherState?.words ?? [],
    getCursor: () => matcherState?.cursor ?? -1,
    isUserOverrideActive,
  };
}
