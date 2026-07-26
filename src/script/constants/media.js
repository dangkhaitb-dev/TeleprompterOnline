// media.js — magic numbers for the scene editor's trim + export media work.
// Pulled out of the demo preview.js so feature code holds no hardcoded limits.

// Minimum gap (seconds) kept between the trim in/out handles.
export const MIN_TRIM_SECONDS = 0.1;

// Ruler duration (seconds) shown for an empty/placeholder timeline.
export const EMPTY_TIMELINE_DURATION = 60;

// Toast auto-dismiss (ms).
export const TOAST_TIMEOUT_MS = 1300;

// Thumbnail extraction: seek offset past the (often black) first frame, a
// hard timeout so a stuck offscreen <video> resolves to null instead of
// hanging, and the JPEG encode quality for captured frames.
export const THUMB_SEEK_OFFSET = 0.1;
export const THUMB_TIMEOUT_MS = 4000;
export const THUMB_JPEG_QUALITY = 0.85;
// Cards render thumbnails ~100-300px wide — capture at card scale, never at the
// video's native resolution (a 4K frame is a multi-hundred-KB data URL and a
// full-frame main-thread JPEG encode).
export const THUMB_MAX_WIDTH = 480;
// How many detached <video> decoders may run at once during thumbnail
// extraction. Browsers cap hardware decoder instances; a burst of them stalls
// the page and times out the extras.
export const THUMB_MAX_CONCURRENT = 3;

// seekMedia() safety timeout (ms) — resolve even if "seeked" never fires.
export const SEEK_TIMEOUT_MS = 1200;

// Merge/export canvas defaults (resized to the first video clip's native dims).
export const EXPORT_CANVAS_WIDTH = 1280;
export const EXPORT_CANVAS_HEIGHT = 720;
export const EXPORT_FPS = 30;

// MediaRecorder timeslice (ms) for periodic dataavailable chunks.
export const RECORDER_TIMESLICE_MS = 500;
export const AUDIO_RECORDER_TIMESLICE_MS = 250;

// Preferred MediaRecorder mime types (first supported wins).
export const VIDEO_MIME_CANDIDATES = Object.freeze([
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]);
export const AUDIO_MIME_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
]);

// Ruler step ladder (seconds) — nearest step ≥ (duration / labelCount) is used.
export const TRIM_RULER_STEPS = Object.freeze([
  0.1, 0.2, 0.5, 1, 2, 3, 5, 6, 10, 12, 15, 20, 30, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 3600,
]);

// Ruler label counts (fewer on a narrow track).
export const RULER_LABELS_WIDE = 10;
export const RULER_LABELS_NARROW = 5;
export const RULER_NARROW_WIDTH = 520;

// hasAppliedTrim tolerance (ms): end-trims smaller than this are ignored so a
// tiny rounding at the tail doesn't force a (slow) re-encode on export.
export const TRIM_END_TOLERANCE_MS = 20;

// Fixed studio hues for the export canvas (theme-independent, drawn to bitmap).
export const AUDIO_GRADIENT_STOPS = Object.freeze([
  [0, '#173c4c'],
  [0.45, '#4d8f99'],
  [0.75, '#8b8074'],
  [1, '#6c5e51'],
]);
export const EXPORT_VIDEO_LETTERBOX = '#111214';
