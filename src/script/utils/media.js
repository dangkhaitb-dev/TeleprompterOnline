// media.js — small helpers for MediaRecorder / getUserMedia capture.

// Pick the best MediaRecorder mimeType the browser actually supports.
export function pickRecorderMimeType({ video = true } = {}) {
  const candidates = video
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ]
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// Request camera + mic (or mic only). Rejects if permission is denied.
export function getCaptureStream({ video = true, audio = true } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(new Error('Media capture unsupported'));
  }
  return navigator.mediaDevices.getUserMedia({ video, audio });
}

// Stop every track on a stream so the camera/mic indicator turns off.
export function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

// Read the current permission state without triggering a prompt.
// `name` is 'camera' or 'microphone'. Returns 'granted' | 'denied' | 'prompt'.
// Firefox/Safari historically don't support querying these — treat any failure
// as 'prompt' (fail-open) so we still attempt getUserMedia rather than block.
export async function queryPermissionState(name) {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'prompt';
    const status = await navigator.permissions.query({ name });
    return status.state;
  } catch {
    return 'prompt';
  }
}

// Normalize a getUserMedia rejection into a stable, browser-agnostic reason so
// the UI can show the right message (Chrome/Firefox/Safari throw different names
// for the same situation).
export function classifyMediaError(err) {
  if (!err) return 'unknown';
  const name = err.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'not-found';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'in-use';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'overconstrained';
  }
  if (/unsupported/i.test(err.message || '')) return 'unsupported';
  return 'unknown';
}
