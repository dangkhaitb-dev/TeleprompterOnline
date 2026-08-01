// Voice Scroll microphone ownership policy. Keep platform branching outside
// the ASR engine so non-Android browsers retain their existing behavior.

export function shouldShareAndroidCaptureAudio({
  platform,
  hasLiveCaptureAudio = false,
} = {}) {
  return platform?.os === 'android' && Boolean(hasLiveCaptureAudio);
}
