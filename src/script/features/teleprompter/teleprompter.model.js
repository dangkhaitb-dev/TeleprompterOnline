// teleprompter.model.js — pure helpers for the teleprompter record view.
// No DOM, no IO. Everything here is deterministic given its inputs.

import { pickRecorderMimeType } from '../../utils/media.js';

// --- Speed / scroll math -----------------------------------------------------

// Auto-scroll base: 40 px/s corresponds to ~130 WPM (from the reference design).
export const BASE_PX_PER_SEC = 40;
export const BASE_WPM = 130;

export const WPM_MIN = 1;
export const WPM_MAX = 1000;
export const WPM_DEFAULT = 110;
export const WPM_STEP = 5;
export const SCROLL_MODES = ['auto', 'wpm', 'time'];
export const SCROLL_DURATION_DEFAULT = 60;
export const SCROLL_DURATION_MIN = 1;
export const SCROLL_DURATION_MAX = 999999;

export function clampWpm(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return WPM_DEFAULT;
  return Math.max(WPM_MIN, Math.min(WPM_MAX, n));
}

// Words-per-minute → scroll speed in px/s.
export function wpmToPxPerSec(wpm) {
  return BASE_PX_PER_SEC * (clampWpm(wpm) / BASE_WPM);
}

// Remaining scroll distance + chosen duration → the exact fixed pixel speed.
// Keep this separate from WPM: timed scroll is a layout-duration control, not a
// reading-speed estimate.
export function pxPerSecForDuration(distance, durationSeconds) {
  const px = Math.max(0, Number(distance) || 0);
  const seconds = Math.max(1, Number(durationSeconds) || 1);
  return px / seconds;
}

export function clampScrollDuration(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return SCROLL_DURATION_DEFAULT;
  return Math.max(SCROLL_DURATION_MIN, Math.min(SCROLL_DURATION_MAX, seconds));
}

// Range-fill percent for the speed slider gradient (0..100).
export function rangeFillPercent(value, min, max) {
  const lo = Number(min) || 0;
  const hi = Number(max) || 100;
  if (hi === lo) return 0;
  return ((Number(value) - lo) / (hi - lo)) * 100;
}

// --- Keyboard-step constants (from the demo) --------------------------------
export const BAR_SPEED_STEP = 5; // WPM per ←/→ key
export const SCROLL_STEP = 48; // px per ↑/↓ key

// Per-frame scroll delta (px) given elapsed ms and speed. Keep the fractional
// part: scrollTop is subpixel-precise, and rounding to whole pixels makes slow
// speeds visibly wait and then jump one pixel at a time.
export function scrollDelta(elapsedMs, pxPerSec) {
  return (Math.max(0, elapsedMs) / 1000) * pxPerSec;
}

// --- Font-size clamps --------------------------------------------------------

export const FONT_MIN = 20;
export const FONT_MAX = 96;
export const FONT_DEFAULT = 40;
export const FONT_STEP = 2;

export function clampFontSize(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return FONT_DEFAULT;
  return Math.max(FONT_MIN, Math.min(FONT_MAX, n));
}

// --- Per-script settings (persisted on the Workspace) -----------------------
// The studio state a script remembers between sessions. Camera/mic are
// intentionally excluded (hardware/permission toggles — always default on open).

export const ALIGNMENTS = ['left', 'center', 'right', 'justify'];

function optionalMarginRatio(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0.01, Math.min(0.45, n));
}

function eyeLineRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.25;
  return Math.max(0.05, Math.min(0.95, n));
}

export const DEFAULT_SETTINGS = Object.freeze({
  wpm: WPM_DEFAULT,
  scrollMode: 'auto',
  scrollDurationSeconds: SCROLL_DURATION_DEFAULT,
  mirror: false,
  pageTheme: 'dark',
  panelTheme: 'dark-60',
  countdown: true,
  notchFullscreen: true,
  align: 'justify',
  promptMarginRatio: null,
  panelMarginRatio: null,
  eyeLineRatio: 0.25,
  eyeLineVisible: true,
  layoutGuides: false,
  fontSize: '',
  lineHeight: '1.25',
  color: '',
  bold: false,
  italic: false,
  underline: false,
});

// Coerce a stored (possibly stale/partial) settings blob into a valid, fully
// populated settings object. Pure — safe defaults for anything missing/invalid.
export function normalizeSettings(raw = {}) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const theme = (v) => (v === 'light' ? 'light' : 'dark');
  const normalizePanelTheme = (v) => {
    if (v === 'light' || v === 'light-60') return 'light-60';
    if (v === 'light-30') return 'light-30';
    if (v === 'dark-30') return 'dark-30';
    return 'dark-60';
  };
  return {
    wpm: clampWpm(s.wpm),
    scrollMode: SCROLL_MODES.includes(s.scrollMode) ? s.scrollMode : 'auto',
    scrollDurationSeconds: clampScrollDuration(s.scrollDurationSeconds),
    mirror: !!s.mirror,
    pageTheme: theme(s.pageTheme),
    panelTheme: normalizePanelTheme(s.panelTheme),
    countdown: s.countdown === undefined ? true : !!s.countdown,
    notchFullscreen: s.notchFullscreen === undefined ? true : !!s.notchFullscreen,
    align: ALIGNMENTS.includes(s.align) ? s.align : 'justify',
    promptMarginRatio: optionalMarginRatio(s.promptMarginRatio),
    panelMarginRatio: optionalMarginRatio(s.panelMarginRatio),
    eyeLineRatio: eyeLineRatio(s.eyeLineRatio),
    eyeLineVisible: s.eyeLineVisible === undefined ? true : !!s.eyeLineVisible,
    layoutGuides: !!s.layoutGuides,
    fontSize: (typeof s.fontSize === 'number' && Number.isFinite(s.fontSize))
      || typeof s.fontSize === 'string'
      ? s.fontSize
      : '',
    lineHeight: ['1', '1.15', '1.25', '1.5', '1.75', '2']
      .includes(String(s.lineHeight)) ? String(s.lineHeight) : '1.25',
    color: typeof s.color === 'string' ? s.color : '',
    bold: !!s.bold,
    italic: !!s.italic,
    underline: !!s.underline,
  };
}

// --- Duration formatting -----------------------------------------------------

// ms → "MM:SS" — shared formatter (utils/format-time.js).
export { formatDuration } from '../../utils/format-time.js';

// --- Color math (pure) — ported from the demo color picker ------------------

export const PRESET_COLORS = ['#ffffff', '#17181b', '#f2c94c', '#75dd28', '#4598e7'];
export const DEFAULT_COLOR_HISTORY = ['#8b9098', '#ef4d62', '#f2994a', '#9b51e0', '#ff66a1'];

export function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(v)) return null;
  return `#${v.toLowerCase()}`;
}

export function hexToRgb(hex) {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r;
  let g;
  let b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// Character index of each paragraph start (paragraphs split by blank lines, empty ones filtered).
export function paragraphStartIndices(text) {
  const rawStarts = [0];
  const re = /\n[ \t\r]*\n[ \t\r]*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    if (start < text.length) rawStarts.push(start);
  }

  const starts = [];
  for (let i = 0; i < rawStarts.length; i++) {
    const currentStart = rawStarts[i];
    const nextStart = i + 1 < rawStarts.length ? rawStarts[i + 1] : text.length;
    const segment = text.slice(currentStart, nextStart);
    if (/\S/.test(segment)) {
      starts.push(currentStart);
    }
  }

  return starts;
}

// --- Recording kind / mimetype ----------------------------------------------

// 'video' when the camera is on, otherwise a mic-only 'audio' clip.
export function recordingKind(hasVideo) {
  return hasVideo ? 'video' : 'audio';
}

// Best supported mimeType for the current capture mode.
export function recordingMimeType(hasVideo) {
  return pickRecorderMimeType({ video: !!hasVideo });
}

// Total recorded duration given the accumulated (paused) time plus the current
// running segment. `paused` freezes the running segment at the accumulated value.
export function computeDuration({ accumulatedMs = 0, startedAt = 0, now = Date.now(), paused = false }) {
  if (paused || !startedAt) return accumulatedMs;
  return accumulatedMs + Math.max(0, now - startedAt);
}
