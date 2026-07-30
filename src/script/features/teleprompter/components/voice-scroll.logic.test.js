import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectScriptLanguage,
  ensureOnDeviceSpeechPack,
  getRememberedSpeechPackLocales,
  preloadLanguageDetector,
  prepareSpeechPackForText,
  releaseLanguageDetector,
  restoreRememberedSpeechPacks,
} from './voice-scroll.logic.js';
import { removeItem, setItem } from '../../../utils/storage.js';
import { LS_VOICE_SCROLL_ASR_LOCALES } from '../../../utils/storage-keys.js';

function recognitionWith({ available, install }) {
  class FakeSpeechRecognition {}
  Object.defineProperty(FakeSpeechRecognition.prototype, 'processLocally', {
    configurable: true,
    writable: true,
    value: false,
  });
  FakeSpeechRecognition.available = available;
  FakeSpeechRecognition.install = install;
  return FakeSpeechRecognition;
}

beforeEach(() => {
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
  });
});

afterEach(() => {
  removeItem(LS_VOICE_SCROLL_ASR_LOCALES);
  vi.unstubAllGlobals();
});

describe('Voice Scroll on-device language packs', () => {
  it('preloads LanguageDetector but keeps detection on the heuristic while downloading', async () => {
    let finishDownload;
    const detect = vi.fn().mockResolvedValue([
      { detectedLanguage: 'vi', confidence: 0.96 },
    ]);
    const LanguageDetector = {
      availability: vi.fn().mockResolvedValue('downloadable'),
      create: vi.fn(() => new Promise((resolve) => {
        finishDownload = resolve;
      })),
    };
    vi.stubGlobal('LanguageDetector', LanguageDetector);
    vi.stubGlobal('self', { LanguageDetector });

    const preload = preloadLanguageDetector({ allowDownload: true });
    await vi.waitFor(() => expect(LanguageDetector.create).toHaveBeenCalledOnce());

    await expect(detectScriptLanguage(
      'Hôm nay tôi sẽ hướng dẫn các bạn sử dụng ứng dụng này',
    )).resolves.toMatchObject({ iso: 'vi', source: 'offline-heuristic' });

    finishDownload({ detect });
    await expect(preload).resolves.toMatchObject({ status: 'available' });
    await expect(detectScriptLanguage(
      'Hôm nay tôi sẽ hướng dẫn các bạn sử dụng ứng dụng này',
    )).resolves.toMatchObject({ iso: 'vi', source: 'on-device' });
  });

  it('releases the cached detector instance without removing the downloaded model', async () => {
    const detector = { detect: vi.fn(), destroy: vi.fn() };
    const LanguageDetector = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue(detector),
    };
    vi.stubGlobal('self', { LanguageDetector });

    await preloadLanguageDetector({ allowDownload: true });
    releaseLanguageDetector();
    expect(detector.destroy).toHaveBeenCalledOnce();

    await preloadLanguageDetector({ allowDownload: true });
    expect(LanguageDetector.create).toHaveBeenCalledTimes(2);
  });

  it('gives an available LanguageDetector up to 200 opening words', async () => {
    const detect = vi.fn().mockResolvedValue([
      { detectedLanguage: 'vi', confidence: 0.9 },
    ]);
    const LanguageDetector = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({ detect }),
    };
    vi.stubGlobal('LanguageDetector', LanguageDetector);
    vi.stubGlobal('self', { LanguageDetector });
    const script = Array.from({ length: 260 }, (_, index) => `word${index}`).join(' ');

    await expect(detectScriptLanguage(script)).resolves.toMatchObject({
      iso: 'vi',
      locale: 'vi-VN',
      source: 'on-device',
    });
    expect(detect.mock.calls[0][0].split(/\s+/)).toHaveLength(200);
    await detectScriptLanguage(`${script} changed`);
    expect(LanguageDetector.create).toHaveBeenCalledOnce();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('keeps an unmapped detector language tag instead of silently using English', async () => {
    const LanguageDetector = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({
        detect: vi.fn().mockResolvedValue([
          { detectedLanguage: 'da', confidence: 0.94 },
        ]),
      }),
    };
    vi.stubGlobal('self', { LanguageDetector });

    await expect(detectScriptLanguage(
      'Dette er en dansk tekst med flere almindelige danske ord',
    )).resolves.toMatchObject({
      iso: 'da',
      locale: 'da',
      label: 'da',
      source: 'on-device',
    });
  });

  it('does not download the separate LanguageDetector model', async () => {
    const LanguageDetector = {
      availability: vi.fn().mockResolvedValue('downloadable'),
      create: vi.fn(),
    };
    vi.stubGlobal('LanguageDetector', LanguageDetector);
    vi.stubGlobal('self', { LanguageDetector });

    const prepared = await prepareSpeechPackForText(
      'Hôm nay tôi sẽ hướng dẫn các bạn sử dụng ứng dụng này',
    );

    expect(LanguageDetector.create).not.toHaveBeenCalled();
    expect(prepared.detected).toMatchObject({
      iso: 'vi',
      source: 'offline-heuristic',
    });
  });

  it('falls back to heuristic detection when LanguageDetector availability hangs', async () => {
    vi.useFakeTimers();
    const LanguageDetector = {
      availability: vi.fn(() => new Promise(() => {})),
      create: vi.fn(),
    };
    vi.stubGlobal('self', { LanguageDetector });

    const detection = detectScriptLanguage(
      'Hôm nay tôi sẽ hướng dẫn các bạn sử dụng ứng dụng này',
    );
    await vi.advanceTimersByTimeAsync(1500);

    await expect(detection).resolves.toMatchObject({
      iso: 'vi',
      source: 'offline-heuristic',
    });
    vi.useRealTimers();
  });

  it('does not try to download when the browser lacks the on-device APIs', async () => {
    class BrowserServiceOnly {}
    vi.stubGlobal('self', { webkitSpeechRecognition: BrowserServiceOnly });

    await expect(ensureOnDeviceSpeechPack('vi-VN')).resolves.toEqual({
      locale: 'vi-VN',
      status: 'unsupported',
    });
  });

  it('downloads and verifies a downloadable language pack', async () => {
    const available = vi.fn()
      .mockResolvedValueOnce('downloadable')
      .mockResolvedValueOnce('downloadable')
      .mockResolvedValueOnce('available');
    const install = vi.fn().mockResolvedValue(true);
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    await expect(ensureOnDeviceSpeechPack('en-US')).resolves.toEqual({
      locale: 'en-US',
      status: 'installed',
      availability: 'available',
    });
    expect(install).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith({
      langs: ['en-US'],
      processLocally: true,
    });
    expect(getRememberedSpeechPackLocales()).toEqual(['en-US']);
  });

  it('checks remembered locales sequentially and reinstalls only missing packs', async () => {
    setItem(LS_VOICE_SCROLL_ASR_LOCALES, ['it-IT', 'nl-NL']);
    let finishMissingInstall;
    const checkedLocales = [];
    const available = vi.fn(({ langs }) => {
      checkedLocales.push(langs[0]);
      if (langs[0] === 'it-IT') return Promise.resolve('available');
      if (checkedLocales.filter((locale) => locale === 'nl-NL').length <= 2) {
        return Promise.resolve('downloadable');
      }
      return Promise.resolve('available');
    });
    const install = vi.fn(({ langs }) => new Promise((resolve) => {
      expect(langs).toEqual(['nl-NL']);
      finishMissingInstall = resolve;
    }));
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    const recovery = restoreRememberedSpeechPacks();
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    expect(checkedLocales).toEqual(['it-IT', 'nl-NL', 'nl-NL']);
    finishMissingInstall(true);

    await expect(recovery).resolves.toMatchObject({
      status: 'complete',
      locales: ['it-IT', 'nl-NL'],
      results: [
        { locale: 'it-IT', status: 'available' },
        { locale: 'nl-NL', status: 'installed' },
      ],
    });
    expect(checkedLocales).toEqual(['it-IT', 'nl-NL', 'nl-NL', 'nl-NL']);
    expect(getRememberedSpeechPackLocales()).toEqual(['it-IT', 'nl-NL']);
  });

  it('forces a fresh availability check for a remembered locale on re-entry', async () => {
    const available = vi.fn()
      .mockResolvedValueOnce('available')
      .mockResolvedValueOnce('available');
    const install = vi.fn();
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    await ensureOnDeviceSpeechPack('de-DE');
    await restoreRememberedSpeechPacks();

    expect(available).toHaveBeenCalledTimes(2);
    expect(install).not.toHaveBeenCalled();
  });

  it('serializes installs requested concurrently for different locales', async () => {
    const checks = new Map();
    const installResolvers = new Map();
    const available = vi.fn(({ langs }) => {
      const locale = langs[0];
      const count = (checks.get(locale) || 0) + 1;
      checks.set(locale, count);
      return Promise.resolve(count <= 2 ? 'downloadable' : 'available');
    });
    const install = vi.fn(({ langs }) => new Promise((resolve) => {
      installResolvers.set(langs[0], resolve);
    }));
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    const spanish = ensureOnDeviceSpeechPack('es-MX');
    const portuguese = ensureOnDeviceSpeechPack('pt-BR');
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    expect(install.mock.calls[0][0].langs).toEqual(['es-MX']);
    expect(installResolvers.has('pt-BR')).toBe(false);

    installResolvers.get('es-MX')(true);
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(install.mock.calls[1][0].langs).toEqual(['pt-BR']);
    installResolvers.get('pt-BR')(true);

    await expect(Promise.all([spanish, portuguese])).resolves.toMatchObject([
      { locale: 'es-MX', status: 'installed' },
      { locale: 'pt-BR', status: 'installed' },
    ]);
  });

  it('allows Play to retry after a transient restore availability failure', async () => {
    setItem(LS_VOICE_SCROLL_ASR_LOCALES, ['sv-SE']);
    const available = vi.fn()
      .mockRejectedValueOnce(new DOMException('Not ready', 'InvalidStateError'))
      .mockResolvedValueOnce('available');
    const install = vi.fn();
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    await expect(restoreRememberedSpeechPacks()).resolves.toMatchObject({
      status: 'complete',
      results: [{ locale: 'sv-SE', status: 'failed', availability: 'check-failed' }],
    });
    await expect(ensureOnDeviceSpeechPack('sv-SE')).resolves.toMatchObject({
      locale: 'sv-SE',
      status: 'available',
    });
    expect(available).toHaveBeenCalledTimes(2);
  });

  it('stops restoring additional locales after Studio teardown', async () => {
    setItem(LS_VOICE_SCROLL_ASR_LOCALES, ['da-DK', 'fi-FI']);
    let finishFirstCheck;
    const available = vi.fn(() => new Promise((resolve) => {
      finishFirstCheck = resolve;
    }));
    const install = vi.fn();
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });
    const controller = new AbortController();

    const recovery = restoreRememberedSpeechPacks({
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(available).toHaveBeenCalledOnce());
    controller.abort();
    finishFirstCheck('available');

    await expect(recovery).resolves.toMatchObject({
      status: 'aborted',
      results: [],
    });
    expect(available).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
  });

  it('retries an aborted queued job when a newly opened Studio joins it', async () => {
    const checks = new Map();
    const installResolvers = new Map();
    const available = vi.fn(({ langs }) => {
      const locale = langs[0];
      const count = (checks.get(locale) || 0) + 1;
      checks.set(locale, count);
      const downloadableChecks = locale === 'cs-CZ' ? 3 : 2;
      return Promise.resolve(count <= downloadableChecks ? 'downloadable' : 'available');
    });
    const install = vi.fn(({ langs }) => new Promise((resolve) => {
      installResolvers.set(langs[0], resolve);
    }));
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    const blocker = ensureOnDeviceSpeechPack('fr-CA');
    await vi.waitFor(() => expect(installResolvers.has('fr-CA')).toBe(true));

    setItem(LS_VOICE_SCROLL_ASR_LOCALES, ['cs-CZ']);
    const oldStudioController = new AbortController();
    const oldRecovery = restoreRememberedSpeechPacks({
      signal: oldStudioController.signal,
    });
    await vi.waitFor(() => expect(checks.get('cs-CZ')).toBe(1));
    oldStudioController.abort();

    const reopenedRecovery = restoreRememberedSpeechPacks();
    installResolvers.get('fr-CA')(true);
    await blocker;
    await vi.waitFor(() => expect(installResolvers.has('cs-CZ')).toBe(true));
    installResolvers.get('cs-CZ')(true);

    await expect(oldRecovery).resolves.toMatchObject({ status: 'aborted' });
    await expect(reopenedRecovery).resolves.toMatchObject({
      status: 'complete',
      results: [{ locale: 'cs-CZ', status: 'installed' }],
    });
  });

  it('bounds remembered locales and prunes a permanently unavailable pack', async () => {
    const locales = [
      'en-US', 'vi-VN', 'fr-FR', 'de-DE', 'it-IT', 'es-ES', 'pt-BR',
      'ja-JP', 'ko-KR', 'zh-CN', 'nl-NL', 'pl-PL', 'tr-TR',
    ];
    setItem(LS_VOICE_SCROLL_ASR_LOCALES, locales);
    expect(getRememberedSpeechPackLocales()).toEqual(locales.slice(0, 12));

    const available = vi.fn().mockResolvedValue('unavailable');
    const SR = recognitionWith({ available, install: vi.fn() });
    vi.stubGlobal('self', { SpeechRecognition: SR });
    await ensureOnDeviceSpeechPack('en-US', { forceCheck: true });

    expect(getRememberedSpeechPackLocales()).not.toContain('en-US');
  });

  it('keeps fallback recognition and never installs an unavailable pack', async () => {
    const available = vi.fn().mockResolvedValue('unavailable');
    const install = vi.fn();
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    await expect(ensureOnDeviceSpeechPack('zz-ZZ')).resolves.toEqual({
      locale: 'zz-ZZ',
      status: 'unavailable',
    });
    expect(install).not.toHaveBeenCalled();
    expect(getRememberedSpeechPackLocales()).not.toContain('zz-ZZ');
  });

  it('caches a negative pack result instead of polling after every edit', async () => {
    const available = vi.fn().mockResolvedValue('unavailable');
    const install = vi.fn();
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    await ensureOnDeviceSpeechPack('fr-FR');
    await expect(ensureOnDeviceSpeechPack('fr-FR')).resolves.toMatchObject({
      locale: 'fr-FR',
      status: 'unavailable',
      cached: true,
    });
    expect(available).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
  });

  it('does not download a speech pack for an ambiguous short sample', async () => {
    const available = vi.fn();
    const install = vi.fn();
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    await expect(prepareSpeechPackForText('example')).resolves.toMatchObject({
      status: 'uncertain',
      locale: 'vi-VN',
      confidence: 0,
      source: 'default',
    });
    expect(available).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('deduplicates simultaneous requests for the same locale', async () => {
    let finishInstall;
    const available = vi.fn()
      .mockResolvedValueOnce('downloadable')
      .mockResolvedValueOnce('downloadable')
      .mockResolvedValueOnce('available');
    const install = vi.fn(() => new Promise((resolve) => {
      finishInstall = resolve;
    }));
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    const first = ensureOnDeviceSpeechPack('ko-KR');
    const second = ensureOnDeviceSpeechPack('ko-KR');
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    finishInstall(true);

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        locale: 'ko-KR',
        status: 'installed',
        availability: 'available',
      },
      {
        locale: 'ko-KR',
        status: 'installed',
        availability: 'available',
      },
    ]);
  });

  it('returns the detected locale immediately while installation continues', async () => {
    let finishInstall;
    const available = vi.fn()
      .mockResolvedValueOnce('downloadable')
      .mockResolvedValueOnce('downloadable')
      .mockResolvedValueOnce('available');
    const install = vi.fn(() => new Promise((resolve) => {
      finishInstall = resolve;
    }));
    const SR = recognitionWith({ available, install });
    vi.stubGlobal('self', { SpeechRecognition: SR });

    const prepared = await prepareSpeechPackForText(
      'Hôm nay tôi sẽ hướng dẫn các bạn sử dụng ứng dụng này',
    );

    expect(prepared.status).toBe('preparing');
    expect(prepared.detected).toMatchObject({
      iso: 'vi',
      locale: 'vi-VN',
    });
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    finishInstall(true);
    await expect(prepared.packPromise).resolves.toMatchObject({
      locale: 'vi-VN',
      status: 'installed',
    });
  });
});
