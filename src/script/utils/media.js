// media.js — small helpers for MediaRecorder / getUserMedia capture.

import {
  CAPTURE_MP4_RECORDER_TIMESLICE_MS,
  CAPTURE_RECORDER_TIMESLICE_MS,
  CAPTURE_REQUEST_TIMEOUT_MS,
} from '../constants/media.js';

// Pick the best MediaRecorder mimeType the browser actually supports.
export function pickRecorderMimeType({ video = true } = {}) {
  const candidates = video
    ? [
        // Prefer an explicit, broadly playable MP4 combination. Some WebKit
        // releases support H.264 with Opus but not AAC through MediaRecorder,
        // so probe that documented combination before falling back to WebM.
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1.42000a,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
        // Generic MP4 is deliberately late: it preserves support for older
        // Safari without making an ambiguous codec configuration the default.
        'video/mp4',
      ]
    : [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mpeg',
      ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // A malformed/unknown codec string should reject only that candidate,
      // not the entire browser-default fallback.
    }
  }
  return '';
}

export function recorderTimesliceForMimeType(mimeType) {
  const container = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return container.endsWith('/mp4')
    ? CAPTURE_MP4_RECORDER_TIMESLICE_MS
    : CAPTURE_RECORDER_TIMESLICE_MS;
}

function readBoxType(bytes) {
  return String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
}

// This is a cheap container-integrity gate, not a decoder. It catches empty
// output and the common broken WebKit MP4 artifact that was never finalized
// with its `moov` metadata. Preview still performs the final decoder check.
export async function validateRecordedMediaBlob(blob, mimeType = blob?.type) {
  if (!blob || blob.size === 0) return { valid: false, reason: 'EMPTY_BLOB' };
  const container = String(mimeType || blob.type || '').toLowerCase().split(';')[0].trim();
  if (container !== 'video/mp4' && container !== 'audio/mp4') return { valid: true };

  let offset = 0;
  let boxCount = 0;
  let hasFileType = false;
  let hasMovieMetadata = false;
  let hasMediaData = false;

  while (offset + 8 <= blob.size && boxCount < 100_000) {
    const headerBytes = new Uint8Array(
      await blob.slice(offset, Math.min(offset + 16, blob.size)).arrayBuffer(),
    );
    if (headerBytes.length < 8) return { valid: false, reason: 'MP4_INVALID_BOX' };

    const view = new DataView(
      headerBytes.buffer,
      headerBytes.byteOffset,
      headerBytes.byteLength,
    );
    const size32 = view.getUint32(0);
    const type = readBoxType(headerBytes);
    let headerSize = 8;
    let boxSize = size32;

    if (size32 === 1) {
      if (headerBytes.length < 16) return { valid: false, reason: 'MP4_INVALID_BOX' };
      const high = view.getUint32(8);
      const low = view.getUint32(12);
      boxSize = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = blob.size - offset;
    }

    if (!Number.isSafeInteger(boxSize)
      || boxSize < headerSize
      || offset + boxSize > blob.size) {
      return { valid: false, reason: 'MP4_INVALID_BOX' };
    }

    if (type === 'ftyp') hasFileType = true;
    if (type === 'moov') hasMovieMetadata = true;
    if (type === 'mdat') hasMediaData = true;
    offset += boxSize;
    boxCount += 1;
    // A fragmented MediaRecorder MP4 can contain thousands of moof/mdat pairs.
    // The initialization metadata plus the first media payload is enough for
    // this cheap gate; the preview decoder remains responsible for full media
    // validation.
    if (hasFileType && hasMovieMetadata && hasMediaData) return { valid: true };
  }

  if (offset !== blob.size || boxCount >= 100_000) {
    return { valid: false, reason: 'MP4_INVALID_BOX' };
  }
  if (!hasFileType || !hasMovieMetadata || !hasMediaData) {
    return { valid: false, reason: 'MP4_MISSING_REQUIRED_BOX' };
  }
  return { valid: true };
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
