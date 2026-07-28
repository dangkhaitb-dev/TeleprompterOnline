// icons.js — inline SVG strings for the scene editor (zero-dependency, matches
// the base's no-CDN stance). Plain strings, no DOM; imported by UI/components.

export const LOGO = '<svg viewBox="0 0 500 500" fill="none" aria-hidden="true"><image href="/logo.png" width="500" height="500"/></svg>';

export const ICON_BACK = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" style="stroke-width:1.5px"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M10 4 6 8l4 4"/></svg>';
export const ICON_EXPORT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v7m0 0 2.5-2.5M8 9 5.5 6.5M3 11v2.5h10V11"/></svg>';
export const ICON_SCISSORS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/></svg>';
export const ICON_FULL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
export const ICON_PLUS = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v12M3 9h12"/></svg>';
export const ICON_PLUS_THIN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10"/></svg>';
export const ICON_DELETE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m12 4-8 8m0-8 8 8"/></svg>';
export const ICON_TRASH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.4 7.2V12M9.6 7.2V12M1.6 4h12.8m-.8 0-.694 9.714A1.6 1.6 0 0 1 11.31 15.2H4.69a1.6 1.6 0 0 1-1.596-1.486L2.4 4m10 0V1.6a.8.8 0 0 0-.8-.8H6.4a.8.8 0 0 0-.8.8V4"/></svg>';
export const ICON_DOTS = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="8" cy="13" r="1"/></svg>';

export const ICON_PLAY_PAUSE = '<svg class="play-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 1.91a.5.5 0 0 1 .768-.421l9.57 6.09a.5.5 0 0 1 0 .843l-9.57 6.089A.5.5 0 0 1 3 14.089z"/></svg><svg class="pause-icon" viewBox="0 0 16 16" aria-hidden="true"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 2v12M11 2v12"/></svg>';

export const ICON_MEDIA_BADGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7.5A2.5 2.5 0 0 1 7 5h7a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 14 19H7a2.5 2.5 0 0 1-2.5-2.5z"/><path d="m16.5 10 4-2v8l-4-2z"/></svg>';

export const ICON_EXPORT_SEPARATE = '<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2.5" y="3" width="6" height="5" rx="1"/><rect x="9.5" y="10" width="6" height="5" rx="1"/><path d="m5.1 4.6 1.7.9-1.7.9zm7 7 1.7.9-1.7.9z"/></svg>';
export const ICON_EXPORT_MERGE = '<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="8.5" y="5" width="7" height="8" rx="1.2"/><path d="M2.5 4h3v3m-3 7h3v-3M5.5 5.5 8 7m-2.5 5.5L8 11"/><path d="m11 7.2 2.6 1.8-2.6 1.8z"/></svg>';

export const ICON_PLAYHEAD_FLAG = '<svg class="se-trim-playhead-flag" viewBox="0 0 16 18" aria-hidden="true"><path d="M4,2 L12,2 Q14,2 14,4 L14,10 L8,17 L2,10 L2,4 Q2,2 4,2 Z"/></svg>';

// Waveform art (audio preview + scene card).
export function waveformSvg(className = 'se-waveform-svg') {
  const bars = [16, 28, 20, 42, 31, 56, 36, 68, 48, 76, 54, 82, 62, 72, 48, 64, 39, 56, 30, 46, 23, 38, 18, 29, 14];
  const rects = bars.map((height, index) => {
    const x = 8 + index * 11.6;
    const y = (100 - height) / 2;
    return `<rect x="${x}" y="${y}" width="5.5" height="${height}" rx="2.75"></rect>`;
  }).join('');
  return `<svg class="${className}" viewBox="0 0 300 100" role="img" aria-label="Audio waveform">${rects}</svg>`;
}
