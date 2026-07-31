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
import { getItem, setItem } from '../../../utils/storage.js';
import { LS_VOICE_SCROLL_ASR_LOCALES } from '../../../utils/storage-keys.js';

const EMPTY_ABORT_LIMIT = 2;
const BROWSER_SERVICE_FAILURE_LIMIT = 2;
const ASR_UNAVAILABLE_FALLBACK_ERRORS = new Set([
  'unsupported',
  'start-timeout',
  'audio-capture',
  'not-allowed',
  'service-not-allowed',
  'recognizer-busy',
]);
const USER_OVERRIDE_GUARD_MS = 650;
const MAX_ASR_CURSOR_ADVANCE = 8;
const LOCAL_PACK_CHECK_TIMEOUT_MS = 3000;
const LANGUAGE_DETECTOR_AVAILABILITY_TIMEOUT_MS = 1500;
const MIN_PACK_LANGUAGE_CONFIDENCE = 0.35;
const LANGUAGE_DETECTION_SAMPLE_WORDS = 200;
const LANGUAGE_DETECTOR_IDLE_RELEASE_MS = 5 * 60 * 1000;
const MAX_REMEMBERED_SPEECH_PACK_LOCALES = 12;
const speechPackInstallJobs = new Map();
const speechPackResultCache = new Map();
const readySpeechPackLocales = new Set();
let speechPackInstallQueue = Promise.resolve();
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

function normalizeSpeechPackLocale(locale) {
  if (typeof locale !== 'string') return null;
  const candidate = locale.trim();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(candidate)) return null;
  try {
    return Intl.getCanonicalLocales(candidate)[0] || null;
  } catch {
    return null;
  }
}

export function getRememberedSpeechPackLocales() {
  const stored = getItem(LS_VOICE_SCROLL_ASR_LOCALES);
  if (!Array.isArray(stored)) return [];
  return [...new Set(stored.map(normalizeSpeechPackLocale).filter(Boolean))]
    .slice(0, MAX_REMEMBERED_SPEECH_PACK_LOCALES);
}

function rememberSpeechPackLocale(locale) {
  const normalized = normalizeSpeechPackLocale(locale);
  if (!normalized) return;
  const locales = getRememberedSpeechPackLocales()
    .filter((remembered) => remembered !== normalized);
  setItem(
    LS_VOICE_SCROLL_ASR_LOCALES,
    [normalized, ...locales].slice(0, MAX_REMEMBERED_SPEECH_PACK_LOCALES),
  );
}

function forgetSpeechPackLocale(locale) {
  const normalized = normalizeSpeechPackLocale(locale);
  if (!normalized) return;
  setItem(
    LS_VOICE_SCROLL_ASR_LOCALES,
    getRememberedSpeechPackLocales()
      .filter((remembered) => remembered !== normalized),
  );
}

function queueSpeechPackInstall(task) {
  const queued = speechPackInstallQueue
    .catch(() => {})
    .then(task);
  speechPackInstallQueue = queued.catch(() => {});
  return queued;
}

function rememberSpeechPackResult(result) {
  const ttl = SPEECH_PACK_RESULT_TTL_MS[result.status];
  if (ttl === undefined) return result;
  if (result.status === 'available' || result.status === 'installed') {
    readySpeechPackLocales.add(result.locale);
  } else {
    readySpeechPackLocales.delete(result.locale);
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
    return 'check-failed';
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

  let timeoutId = null;
  const availability = Promise.resolve()
    .then(() => API.availability());
  const timedOut = new Promise((resolve) => {
    timeoutId = setTimeout(
      () => resolve('unavailable'),
      LANGUAGE_DETECTOR_AVAILABILITY_TIMEOUT_MS,
    );
  });
  const pending = Promise.race([availability, timedOut])
    .then((status) => {
      languageDetectorAvailability = status;
      return status;
    })
    .catch(() => {
      languageDetectorAvailability = 'unavailable';
      return 'unavailable';
    })
    .finally(() => clearTimeout(timeoutId));
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
export async function ensureOnDeviceSpeechPack(
  locale,
  {
    onStatus,
    forceCheck = false,
    rememberUsage = true,
    signal,
  } = {},
) {
  const SR = speechRecognitionConstructor();
  const normalizedLocale = normalizeSpeechPackLocale(locale);
  const report = (status, details = {}) => {
    const result = { locale: normalizedLocale || locale, status, ...details };
    onStatus?.(result);
    return result;
  };

  if (!normalizedLocale || !supportsOnDeviceSpeechInstall(SR)) {
    return report('unsupported');
  }
  if (signal?.aborted) return report('aborted');
  locale = normalizedLocale;

  const cached = speechPackResultCache.get(locale);
  if (cached && !forceCheck) {
    if (cached.expiresAt > Date.now()) {
      if (rememberUsage && cached.result.status !== 'unavailable') {
        rememberSpeechPackLocale(locale);
      }
      const result = { ...cached.result, cached: true };
      onStatus?.(result);
      return result;
    }
    speechPackResultCache.delete(locale);
  }
  if (forceCheck) {
    speechPackResultCache.delete(locale);
    readySpeechPackLocales.delete(locale);
  }
  if (rememberUsage) rememberSpeechPackLocale(locale);

  const existing = speechPackInstallJobs.get(locale);
  if (existing) {
    report('downloading');
    const result = await existing;
    if (result.status === 'aborted' && !signal?.aborted) {
      if (speechPackInstallJobs.get(locale) === existing) {
        speechPackInstallJobs.delete(locale);
      }
      return ensureOnDeviceSpeechPack(locale, {
        onStatus,
        forceCheck: true,
        rememberUsage,
        signal,
      });
    }
    onStatus?.(result);
    return result;
  }

  const job = (async () => {
    const availability = await localSpeechAvailability(SR, locale);
    if (availability === 'available') {
      return rememberSpeechPackResult(report('available'));
    }
    if (availability === 'unavailable') {
      forgetSpeechPackLocale(locale);
      return rememberSpeechPackResult(report(availability));
    }
    if (availability === 'timeout' || availability === 'check-failed') {
      return rememberSpeechPackResult(report(
        availability === 'timeout' ? 'timeout' : 'failed',
        availability === 'check-failed' ? { availability } : {},
      ));
    }

    // Both `downloadable` and `downloading` are handled by install(). Chrome
    // either starts the pack download or joins the download already in flight.
    report('downloading', { availability });
    return queueSpeechPackInstall(async () => {
      if (signal?.aborted) return report('aborted');

      // Another tab or an earlier queued request may have completed this pack
      // while this locale was waiting for the single install slot.
      const queuedAvailability = await localSpeechAvailability(SR, locale);
      if (queuedAvailability === 'available') {
        return rememberSpeechPackResult(report('available'));
      }
      if (queuedAvailability === 'unavailable') {
        forgetSpeechPackLocale(locale);
        return rememberSpeechPackResult(report('unavailable'));
      }
      if (queuedAvailability === 'timeout' || queuedAvailability === 'check-failed') {
        return rememberSpeechPackResult(report(
          queuedAvailability === 'timeout' ? 'timeout' : 'failed',
          queuedAvailability === 'check-failed'
            ? { availability: queuedAvailability }
            : {},
        ));
      }
      if (signal?.aborted) return report('aborted');

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
    });
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
 * Re-checks previously used ASR locales whenever the Studio mounts. The
 * browser owns the model files, so a persisted locale is only a recovery hint:
 * every entry performs a fresh availability check and installs missing packs
 * one at a time.
 */
export async function restoreRememberedSpeechPacks({ onStatus, signal } = {}) {
  const SR = speechRecognitionConstructor();
  const locales = getRememberedSpeechPackLocales();
  if (!supportsOnDeviceSpeechInstall(SR)) {
    return { status: 'unsupported', locales, results: [] };
  }
  if (locales.length === 0) {
    return { status: 'empty', locales, results: [] };
  }

  const results = [];
  for (const locale of locales) {
    if (signal?.aborted) {
      return { status: 'aborted', locales, results };
    }
    const reportRestoreStatus = (details) => {
      if (!signal?.aborted) onStatus?.(details);
    };
    reportRestoreStatus({ locale, status: 'checking-remembered' });
    const result = await ensureOnDeviceSpeechPack(locale, {
      forceCheck: true,
      rememberUsage: false,
      signal,
      onStatus: reportRestoreStatus,
    });
    if (signal?.aborted || result.status === 'aborted') {
      return { status: 'aborted', locales, results };
    }
    results.push(result);

    // A background recovery can fail because download permission requires a
    // later user activation. Do not let its short failure TTL suppress the
    // immediate retry from Play or Record.
    if (result.status === 'failed' || result.status === 'timeout') {
      speechPackResultCache.delete(locale);
    }
  }
  return { status: 'complete', locales, results };
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
 * @param {Function} options.onError - Callback for fatal errors.
 * @param {Function} options.onDegraded - Callback when timed scrolling should
 * temporarily cover a degraded browser recognition service.
 * @param {Function} options.onDiagnostic - Receives allowlisted recognition
 * lifecycle signals without transcript text or browser error messages.
 * @returns {Object} The ASR engine interface.
 */
export function createASREngine({
  onResult,
  onPhaseChange,
  onError,
  onDegraded,
  onDiagnostic,
}) {
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
  let consecutiveEmptyAborts = 0;
  let browserServiceFailures = 0;
  let sessionFailureReported = false;
  let degradationReported = false;
  const asrInput = 'microphone';

  const log = (message, details) => {
    if (details === undefined) console.info(`[VoiceScroll] ${message}`);
    else console.info(`[VoiceScroll] ${message}`, details);
  };

  function reportBrowserServiceFailure(error) {
    if (useLocal || sessionFailureReported) return;
    sessionFailureReported = true;
    browserServiceFailures += 1;
    onDiagnostic?.('asr-browser-service-failure', {
      reason: error,
      asrMode: 'browser-service',
      asrFailureCount: browserServiceFailures,
    });
    if (browserServiceFailures < BROWSER_SERVICE_FAILURE_LIMIT || degradationReported) return;
    degradationReported = true;
    onDegraded?.({
      error,
      locale,
      mode: 'browser-service',
      failures: browserServiceFailures,
    });
  }

  function clearRestartTimer() {
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function startRecognition() {
    // Use the broadly supported microphone-owned path. Browsers that only
    // implement start() may silently ignore extra arguments instead of
    // throwing, so try/catch cannot safely detect start(audioTrack).
    recognition.start();
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
    const isFirstResult = !sessionHadResult;
    sessionHadResult = true;
    lastResultAt = performance.now();
    // Results can arrive many times per second. Retaining every one makes the
    // bounded diagnostic trace discard the setup/failure events we need most.
    if (isFirstResult) {
      onDiagnostic?.('asr-first-result', {
        asrMode: useLocal ? 'on-device' : 'browser-service',
      });
    }
    let interimText = '';
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
    if (rawTranscript) {
      browserServiceFailures = 0;
      degradationReported = false;
    }
    log('speech result', {
      hasTranscript: Boolean(rawTranscript),
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
      sessionFailureReported = false;
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
      onDiagnostic?.('asr-started', {
        asrMode: useLocal ? 'on-device' : 'browser-service',
        asrInput,
      });
    };

    instance.onaudiostart = () => {
      sessionHadAudio = true;
      log('audio capture started');
      onDiagnostic?.('asr-audio-started', { asrMode: useLocal ? 'on-device' : 'browser-service' });
    };

    instance.onsoundstart = () => {
      sessionHadSound = true;
      log('sound detected');
      onDiagnostic?.('asr-sound-started', { asrMode: useLocal ? 'on-device' : 'browser-service' });
    };

    instance.onspeechstart = () => {
      sessionHadSpeech = true;
      log('speech detected');
      onDiagnostic?.('asr-speech-started', { asrMode: useLocal ? 'on-device' : 'browser-service' });
    };

    instance.onnomatch = () => {
      console.warn('[VoiceScroll] Chrome heard speech but returned no transcript match');
      reportBrowserServiceFailure('no-match');
    };

    instance.onresult = handleResult;

    instance.onerror = (event) => {
      const code = event?.error || 'unknown';
      sessionErrorCode = code;
      onDiagnostic?.('asr-error', {
        reason: code,
        asrMode: useLocal ? 'on-device' : 'browser-service',
        asrInput,
      });
      console.warn('[VoiceScroll][ASR error]', {
        error: code,
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
        reportBrowserServiceFailure(code);
        console.warn('[VoiceScroll] transient recognition error', code);
        return;
      }

      fatalError = true;
      wantsListening = false;
      resolveStart(false);
      console.error('[VoiceScroll] recognition stopped', code);
      onError?.(code, { asrMode: useLocal ? 'on-device' : 'browser-service' });
    };

    instance.onend = () => {
      if (!wantsListening || fatalError) {
        onPhaseChange?.('idle');
        return;
      }

      const isEmptyAbort = sessionErrorCode === 'aborted'
        && !sessionHadSound
        && !sessionHadSpeech
        && !sessionHadResult;
      if (isEmptyAbort) consecutiveEmptyAborts += 1;
      else consecutiveEmptyAborts = 0;

      if (!sessionHadResult) {
        if (!sessionHadAudio) {
          console.warn('[VoiceScroll] recognition session ended without an audiostart event');
        } else if (!sessionHadSound) {
          console.warn('[VoiceScroll] microphone opened, but Chrome detected no sound');
        } else if (!sessionHadSpeech) {
          console.warn('[VoiceScroll] sound was detected, but Chrome did not classify it as speech');
        } else {
          console.warn('[VoiceScroll] speech was detected, but Chrome returned no transcript');
          reportBrowserServiceFailure('no-transcript');
        }
      }
      console.info('[VoiceScroll][ASR end]', {
        hadAudio: sessionHadAudio,
        hadSound: sessionHadSound,
        hadSpeech: sessionHadSpeech,
        hadResult: sessionHadResult,
        locale,
        mode: useLocal ? 'on-device' : 'browser-service',
        emptyAbortCount: consecutiveEmptyAborts,
      });
      onDiagnostic?.('asr-session-ended', {
        reason: sessionErrorCode || 'unknown',
        asrHadAudio: sessionHadAudio,
        asrHadSound: sessionHadSound,
        asrHadSpeech: sessionHadSpeech,
        asrHadResult: sessionHadResult,
        asrMode: useLocal ? 'on-device' : 'browser-service',
        asrInput,
        asrEmptyAbortCount: consecutiveEmptyAborts,
      });

      // Chromium's speech service is shared at browser level. Another active
      // recognizer can repeatedly abort this session before it acquires audio.
      // Do not create an endless restart duel between tabs.
      if (consecutiveEmptyAborts >= EMPTY_ABORT_LIMIT) {
        fatalError = true;
        wantsListening = false;
        console.error(
          '[VoiceScroll] recognition is busy or repeatedly aborted without a result'
        );
        onPhaseChange?.('idle');
        onError?.('recognizer-busy', { asrMode: useLocal ? 'on-device' : 'browser-service' });
        return;
      }

      const restartDelay = Math.max(250, consecutiveEmptyAborts * 500);
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
          startRecognition();
          console.debug('[VoiceScroll] recognition restarted', {
            mode: useLocal ? 'on-device' : 'browser-service',
          });
        } catch (err) {
          fatalError = true;
          wantsListening = false;
          const code = err?.message || 'restart-failed';
          console.error('[VoiceScroll] restart failed', err);
          onError?.(code, { asrMode: useLocal ? 'on-device' : 'browser-service' });
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
      onError?.('unsupported', { asrMode: 'browser-service' });
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
    consecutiveEmptyAborts = 0;
    browserServiceFailures = 0;
    sessionFailureReported = false;
    degradationReported = false;
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
      onDiagnostic?.('asr-start-requested', {
        asrMode: useLocal ? 'on-device' : 'browser-service',
        asrInput,
      });
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
          onError?.('start-timeout', { asrMode: useLocal ? 'on-device' : 'browser-service' });
        }, 10000);
      });
      startRecognition();
      return await started;
    } catch (e) {
      resolveStart(false);
      onError?.(e.message, { asrMode: useLocal ? 'on-device' : 'browser-service' });
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
    // Chromium keeps earlier final result slots in later events from the same
    // recognition session. Preserve their ids so a direct word re-anchor does
    // not ingest pre-click speech again. A genuinely restarted session clears
    // this set in createRecognition().onstart.
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
  onRecognitionDegraded,
  onDiagnostic,
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
  let timedFallbackActive = false;
  let timedFallbackIndex = -1;
  let timedFallbackAnchorAt = 0;

  function startTimedFallback(details) {
    if (!matcherState || timedFallbackActive) return;
    timedFallbackActive = true;
    timedFallbackIndex = Math.max(0, matcherState.cursor, displayIndex, creepIndex);
    timedFallbackAnchorAt = performance.now();
    const reason = typeof details?.error === 'string' ? details.error : 'unknown';
    // Timed motion keeps reading usable, but it is not voice-follow Auto
    // Scroll. Emit an explicit diagnostic so a hardware/browser failure is
    // never mistaken for a healthy ASR session.
    onDiagnostic?.('asr-timed-fallback-active', {
      reason,
      asrMode: details?.mode || 'browser-service',
      asrFailureCount: details?.failures || 0,
    });
    onRecognitionDegraded?.(details);
  }
  
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
      // Preserve fresh post-click chunks while the new anchor is still being
      // confirmed. On-device recognition may finalize one or two words at a
      // time; clearing the stream after every short non-match would prevent
      // those chunks from ever forming a match. Only a result that actually
      // moved behind the user's anchor is stale enough to discard.
      if (movedBehindUser) asr?.resetStream();
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
      const transcriptBehindFallback = timedFallbackActive
        && result.cursor < timedFallbackIndex;
      if (timedFallbackActive && !transcriptBehindFallback) {
        timedFallbackActive = false;
        timedFallbackIndex = -1;
        timedFallbackAnchorAt = 0;
      }
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
      if (!transcriptBehindFallback) {
        displayIndex = result.cursor;
        creepIndex = result.cursor;

        // Notify UI only after recovered speech catches the timed reading
        // position. A delayed transcript must not pull the page backward.
        onCursorMove?.({
          cursor: result.cursor,
          displayIndex,
          words: result.words,
        });
      }
      console.info('[VoiceScroll] cursor matched', {
        previous: prev,
        cursor: result.cursor,
        sequentialRecovery: isSequentialRecovery,
        behindTimedFallback: transcriptBehindFallback,
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
    timedFallbackActive = false;
    timedFallbackIndex = -1;
    timedFallbackAnchorAt = 0;
    
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
      onError: (err, asrDetails = {}) => {
        const message = err === 'unsupported'
          ? 'Browser does not support Web Speech API'
          : err;
        // The underlying cause can be a browser policy, service, device state,
        // or an unavailable capture path. Regardless of cause, Auto cannot
        // follow speech in this session without a transcript.
        if (ASR_UNAVAILABLE_FALLBACK_ERRORS.has(err)) {
          onDiagnostic?.('asr-unavailable-for-session', {
            reason: err,
            asrMode: asrDetails.asrMode || 'browser-service',
          });
          onDiagnostic?.('asr-timed-fallback', { reason: err });
          startTimedFallback({
            error: err,
            message,
            fatal: true,
            mode: asrDetails.asrMode || 'browser-service',
          });
        }
        if (timedFallbackActive) {
          phase = 'listening';
          onPhaseChange?.('listening');
          return;
        }
        phase = 'idle';
        onPhaseChange?.('idle');
        onError?.(message);
      },
      onDegraded: (details) => {
        onDiagnostic?.('asr-timed-fallback', { reason: details?.error || 'unknown' });
        startTimedFallback(details);
      },
      onDiagnostic,
    });
    
    // Recognition starts unbiased. Context is introduced only after the reader
    // has already advanced far enough to establish a real content match.
    biasAnchor = 0;
    const started = await asr.start(detected.locale);
    if (!started) {
      if (timedFallbackActive) return true;
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
    timedFallbackActive = false;
    timedFallbackIndex = -1;
    timedFallbackAnchorAt = 0;
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
    if (timedFallbackActive) {
      timedFallbackIndex = index;
      timedFallbackAnchorAt = anchorAt;
    }
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
      cursor: timedFallbackActive ? timedFallbackIndex : (matcherState?.cursor ?? -1),
      creepIndex: timedFallbackActive ? timedFallbackIndex : creepIndex,
      timedFallback: timedFallbackActive,
      displayIndex,
      wpm,
      anchorAt: timedFallbackActive ? timedFallbackAnchorAt : anchorAt,
      // Only a confirmed content match may keep optimistic creep alive. Raw
      // ASR noise must not extend scrolling merely by emitting transcripts.
      lastResultAt: timedFallbackActive ? performance.now() : anchorAt,
      wordsLength: matcherState?.words.length ?? 0,
    };
  }
  
  function updateCreepIndex(newIndex) {
    if (timedFallbackActive) {
      timedFallbackIndex = newIndex;
      timedFallbackAnchorAt = performance.now();
      return;
    }
    creepIndex = newIndex;
  }

  function isUserOverrideActive() {
    return !timedFallbackActive && (
      awaitingUserAnchorSpeech || performance.now() < userGuardUntil
    );
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
