const MEDIA_ERROR_CODES = Object.freeze({
  1: 'MEDIA_ABORTED',
  2: 'MEDIA_NETWORK',
  3: 'MEDIA_DECODE',
  4: 'MEDIA_SOURCE_UNSUPPORTED',
});

const ERROR_NAME_CODES = Object.freeze({
  AbortError: 'PLAY_ABORTED',
  NotAllowedError: 'PLAY_NOT_ALLOWED',
  NotSupportedError: 'PLAY_NOT_SUPPORTED',
  TimeoutError: 'PREVIEW_TIMEOUT',
});

const FAILURE_MESSAGES = Object.freeze({
  EMPTY_BLOB: 'The saved recording contains no media bytes.',
  MEDIA_ABORTED: 'The browser stopped loading the recording before it was ready.',
  MEDIA_NETWORK: 'WebKit could not read the local recording URL.',
  MEDIA_DECODE: 'The file was loaded, but this device could not decode its media data.',
  MEDIA_SOURCE_UNSUPPORTED: 'This device does not support the recorded format or codec.',
  PLAY_ABORTED: 'Playback was interrupted while the recording was loading.',
  PLAY_NOT_ALLOWED: 'This device blocked the playback request.',
  PLAY_NOT_SUPPORTED: 'This device cannot play the recorded format or codec.',
  PREVIEW_TIMEOUT: 'No decodable video frame arrived before the preview timed out.',
  PLAYBACK_UNKNOWN: 'The browser could not start this recording for an unknown reason.',
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function diagnoseMediaPreview({
  error = null,
  media = null,
  blob = null,
  userAgent = '',
  stage = '',
} = {}) {
  const mediaErrorCode = finiteNumber(media?.error?.code);
  let code;
  if (blob instanceof Blob && blob.size === 0) code = 'EMPTY_BLOB';
  else if (mediaErrorCode && MEDIA_ERROR_CODES[mediaErrorCode]) {
    code = MEDIA_ERROR_CODES[mediaErrorCode];
  } else {
    code = ERROR_NAME_CODES[error?.name] || 'PLAYBACK_UNKNOWN';
  }

  const mimeType = blob?.type || '';
  let canPlayType;
  try {
    canPlayType = mimeType && typeof media?.canPlayType === 'function'
      ? media.canPlayType(mimeType)
      : '';
  } catch {
    canPlayType = '';
  }

  return {
    code,
    message: FAILURE_MESSAGES[code],
    errorName: error?.name || media?.error?.name || '',
    errorMessage: error?.message || media?.error?.message || '',
    mediaErrorCode,
    readyState: finiteNumber(media?.readyState),
    networkState: finiteNumber(media?.networkState),
    currentTime: finiteNumber(media?.currentTime),
    duration: finiteNumber(media?.duration),
    mimeType,
    blobSize: finiteNumber(blob?.size),
    canPlayType,
    stage: String(stage || ''),
    userAgent: String(userAgent || ''),
  };
}

export function formatMediaPreviewDiagnostics(details) {
  return JSON.stringify(details, null, 2);
}
