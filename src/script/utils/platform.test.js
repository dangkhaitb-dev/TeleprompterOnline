import { describe, expect, it } from 'vitest';
import { detectPlatform } from './platform.js';

// Real UA strings (trimmed) for the platforms we render permission steps for.
const UA = {
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  desktopEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  desktopFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  desktopSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};

describe('detectPlatform', () => {
  it('detects desktop Chrome on Windows', () => {
    expect(detectPlatform({ userAgent: UA.desktopChrome })).toEqual({
      os: 'windows',
      browser: 'chrome',
      isMobile: false,
    });
  });

  it('detects desktop Edge (Edg wins over Chrome)', () => {
    const p = detectPlatform({ userAgent: UA.desktopEdge });
    expect(p.browser).toBe('edge');
    expect(p.os).toBe('windows');
  });

  it('detects desktop Firefox', () => {
    expect(detectPlatform({ userAgent: UA.desktopFirefox })).toMatchObject({
      os: 'windows',
      browser: 'firefox',
    });
  });

  it('detects desktop Safari on macOS', () => {
    expect(detectPlatform({ userAgent: UA.desktopSafari })).toMatchObject({
      os: 'macos',
      browser: 'safari',
    });
  });

  it('detects iOS Safari as mobile', () => {
    expect(detectPlatform({ userAgent: UA.iosSafari })).toEqual({
      os: 'ios',
      browser: 'safari',
      isMobile: true,
    });
  });

  it('detects iOS Chrome (CriOS) as chrome, not safari', () => {
    expect(detectPlatform({ userAgent: UA.iosChrome })).toMatchObject({
      os: 'ios',
      browser: 'chrome',
      isMobile: true,
    });
  });

  it('detects Android Chrome as mobile', () => {
    expect(detectPlatform({ userAgent: UA.androidChrome })).toEqual({
      os: 'android',
      browser: 'chrome',
      isMobile: true,
    });
  });

  it('treats iPadOS (desktop Mac UA + touch) as iOS', () => {
    const p = detectPlatform({ userAgent: UA.desktopSafari, maxTouchPoints: 5 });
    expect(p.os).toBe('ios');
  });

  it('prefers userAgentData.mobile when present', () => {
    const p = detectPlatform({
      userAgent: UA.desktopChrome,
      userAgentData: { mobile: true },
    });
    expect(p.isMobile).toBe(true);
  });

  it('falls back to sane defaults on an empty navigator', () => {
    expect(detectPlatform({})).toEqual({
      os: 'other',
      browser: 'other',
      isMobile: false,
    });
  });
});
