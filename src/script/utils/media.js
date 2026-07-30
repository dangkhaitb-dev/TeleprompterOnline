// media.js — small helpers for MediaRecorder / getUserMedia capture.

import { CAPTURE_REQUEST_TIMEOUT_MS } from '../constants/media.js';

// Pick the best MediaRecorder mimeType the browser actually supports.
export function pickRecorderMimeType({ video = true } = {}) {
  const candidates = video
    ? [
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
    : ['audio/mpeg', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// Map a recorded Blob MIME type to the correct download extension. In
// particular, the standards-based MP3 MIME is audio/mpeg rather than
// audio/mp3, so deriving the extension from the raw subtype would produce the
// misleading filename "recording.mpeg".
export function mediaFileExtension(mimeType) {
  const type = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'mp3';
  if (type === 'audio/ogg' || type === 'video/ogg') return 'ogg';
  if (type === 'audio/mp4' || type === 'video/mp4') return 'mp4';
  return 'webm';
}

// Request camera + mic (or mic only). Rejects if permission is denied.
export function getCaptureStream({ video = true, audio = true } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(new Error('Media capture unsupported'));
  }
  const request = navigator.mediaDevices.getUserMedia({ video, audio });
  let timedOut = false;
  let timeoutId = null;

  return new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      const error = new Error('Media capture request timed out');
      error.name = 'TimeoutError';
      reject(error);
    }, CAPTURE_REQUEST_TIMEOUT_MS);

    request.then(
      (stream) => {
        clearTimeout(timeoutId);
        // A browser permission/camera service can settle after our UI has
        // recovered. Never leave that late stream holding hardware open.
        if (timedOut) {
          stopStream(stream);
          return;
        }
        resolve(stream);
      },
      (error) => {
        clearTimeout(timeoutId);
        if (!timedOut) reject(error);
      },
    );
  });
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
  if (name === 'TimeoutError') return 'timeout';
  if (/unsupported/i.test(err.message || '')) return 'unsupported';
  return 'unknown';
}
