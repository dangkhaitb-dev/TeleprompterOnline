import { describe, expect, it } from 'vitest';
import { shouldShareAndroidCaptureAudio } from './voice-scroll-input-policy.js';

describe('Voice Scroll microphone ownership policy', () => {
  it('uses the single-mic fallback only for Android with active capture audio', () => {
    expect(shouldShareAndroidCaptureAudio({
      platform: { os: 'android' },
      hasLiveCaptureAudio: true,
    })).toBe(true);
  });

  it.each(['ios', 'macos', 'windows', 'linux', 'other'])(
    'preserves ASR behavior on %s',
    (os) => {
      expect(shouldShareAndroidCaptureAudio({
        platform: { os },
        hasLiveCaptureAudio: true,
      })).toBe(false);
    },
  );

  it('preserves Android ASR when no recording stream owns the microphone', () => {
    expect(shouldShareAndroidCaptureAudio({
      platform: { os: 'android' },
      hasLiveCaptureAudio: false,
    })).toBe(false);
  });
});
