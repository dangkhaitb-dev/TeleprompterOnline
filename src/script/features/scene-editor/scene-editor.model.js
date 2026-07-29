// scene-editor.model.js — pure helpers + shapes for the post-record editor.
// No DOM, no IO. Trim/ruler/export math lives here; UI consumes computed values.

import {
  MIN_TRIM_SECONDS,
  TRIM_RULER_STEPS,
  RULER_LABELS_WIDE,
  RULER_LABELS_NARROW,
  RULER_NARROW_WIDTH,
  TRIM_END_TOLERANCE_MS,
} from '../../constants/media.js';

// Map a stored recording → the scene shape the editor renders. This is the
// single place stored field names are mapped to the app shape (trim in ms).
export function toScene(recording) {
  return {
    id: recording.id,
    kind: recording.kind || 'video',
    blob: recording.blob,
    mimeType: recording.mimeType || (recording.blob && recording.blob.type) || '',
    duration: recording.duration || 0, // ms
    durationMetadataFixed: !!recording.durationMetadataFixed,
    trimStart: recording.trimStart ?? null, // ms | null
    trimEnd: recording.trimEnd ?? null, // ms | null
    order: recording.order || recording.createdAt || 0,
  };
}

// Effective (trimmed) duration in ms — used for the scene time badge.
export function effectiveDurationMs(recording) {
  const original = Math.max(0, Number(recording?.duration) || 0);
  const start = Math.max(0, Number(recording?.trimStart) || 0);
  const end = Math.min(original, Number(recording?.trimEnd) || original);
  return end > start ? end - start : original;
}

// ms → "MM:SS" — shared formatter (utils/format-time.js).
export { formatDuration } from '../../utils/format-time.js';

// seconds → "MM:SS.d" (precise player time — one tenth of a second).
export function formatPreciseTime(totalSeconds) {
  const safe = Math.max(0, totalSeconds || 0);
  const minutes = Math.floor(safe / 60);
  const remaining = (safe % 60).toFixed(1).padStart(4, '0');
  return `${String(minutes).padStart(2, '0')}:${remaining}`;
}

// Playback bounds (seconds) for the active recording, given the media's real
// duration (passed in — the model never reads a global media element).
export function recordingBounds(recording, mediaDurationSec = 0) {
  const duration = Math.max(
    Number.isFinite(mediaDurationSec) ? mediaDurationSec : 0,
    (Number(recording?.duration) || 0) / 1000,
    MIN_TRIM_SECONDS,
  );
  const start = Math.min(
    Math.max(0, (Number(recording?.trimStart) || 0) / 1000),
    duration - MIN_TRIM_SECONDS,
  );
  const storedEnd = (Number(recording?.trimEnd) || 0) / 1000;
  const end = Math.min(duration, storedEnd > start ? storedEnd : duration);
  return { duration, start, end };
}

// Export bounds (seconds) — like recordingBounds but tolerant of missing media
// duration (falls back to the stored ms duration).
export function mediaExportBounds(recording, mediaDurationSec) {
  const duration = Number.isFinite(mediaDurationSec) && mediaDurationSec > 0
    ? mediaDurationSec
    : Math.max(MIN_TRIM_SECONDS, (Number(recording?.duration) || 0) / 1000);
  const start = Math.min(
    Math.max(0, (Number(recording?.trimStart) || 0) / 1000),
    duration - MIN_TRIM_SECONDS,
  );
  const storedEnd = (Number(recording?.trimEnd) || 0) / 1000;
  return { start, end: Math.min(duration, storedEnd > start ? storedEnd : duration) };
}

// Whether a recording carries a meaningful trim that requires a re-encode on
// export. Tiny end-trims (< tolerance) are ignored (documented fudge from demo).
export function hasAppliedTrim(recording) {
  const duration = Number(recording?.duration) || 0;
  const start = Number(recording?.trimStart) || 0;
  const end = Number(recording?.trimEnd) || duration;
  return start > 0 || (duration > 0 && end < duration - TRIM_END_TOLERANCE_MS);
}

// Clamp a proposed start (seconds) so it stays ≥0 and MIN_TRIM before end.
export function clampTrimStart(start, end) {
  return Math.max(0, Math.min(start, end - MIN_TRIM_SECONDS));
}

// Clamp a proposed end (seconds) so it stays ≤duration and MIN_TRIM after start.
export function clampTrimEnd(end, start, duration) {
  return Math.min(duration, Math.max(end, start + MIN_TRIM_SECONDS));
}

// Download file extension derived (loosely) from the recording's mime type.
export function fileExtension(recording) {
  if (recording.mimeType?.includes('mp4')) return 'mp4';
  if (recording.mimeType?.includes('ogg')) return 'ogg';
  return 'webm';
}

// ---- Ruler math (pure) ----

// Nearest "nice" ruler step (seconds) ≥ the rough target.
export function niceTrimRulerStep(rough) {
  return TRIM_RULER_STEPS.find((step) => step >= rough) || TRIM_RULER_STEPS[TRIM_RULER_STEPS.length - 1];
}

// Human ruler label for a time in seconds ("0s", "1.5s", "2m", "1m30s").
export function formatTrimRulerLabel(seconds) {
  if (seconds <= 0) return '0s';
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  if (seconds < 60) {
    const rounded = Math.round(seconds * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m${rest}s` : `${minutes}m`;
}

// Compute ruler ticks/labels as data (UI turns these into DOM nodes).
// Returns [{ type:'label'|'tick', ratio, label?, edge?:'start'|'end' }].
export function computeRulerTicks(duration, trackWidthPx) {
  if (!duration) return [];
  const targetLabelCount = trackWidthPx < RULER_NARROW_WIDTH ? RULER_LABELS_NARROW : RULER_LABELS_WIDE;
  const step = niceTrimRulerStep(duration / targetLabelCount);
  const precision = step < 1 ? 10 : 1;
  const nodes = [];
  for (let t = 0; t <= duration + 0.001; t += step) {
    const time = Math.min(duration, t);
    const ratio = time / duration;
    let edge;
    if (time <= 0) edge = 'start';
    else if (time >= duration - 0.001) edge = 'end';
    nodes.push({
      type: 'label',
      ratio,
      edge,
      label: formatTrimRulerLabel(Math.round(time * precision) / precision),
    });
    if (t + step <= duration + 0.001) {
      for (let minor = 1; minor <= 2; minor += 1) {
        const minorRatio = Math.min(1, (t + (step * minor) / 3) / duration);
        nodes.push({ type: 'tick', ratio: minorRatio });
      }
    }
  }
  return nodes;
}
