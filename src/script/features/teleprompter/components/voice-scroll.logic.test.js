import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectScriptLanguage,
  ensureOnDeviceSpeechPack,
  preloadLanguageDetector,
  prepareSpeechPackForText,
  releaseLanguageDetector,
} from './voice-scroll.logic.js';

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

afterEach(() => {
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
