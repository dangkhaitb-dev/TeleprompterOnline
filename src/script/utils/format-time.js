// format-time.js — shared duration formatting. Single source of truth so every
// surface (workspaces cards, record timer, scene badges) renders the same way.

// ms → "MM:SS". Floors to whole elapsed seconds (a duration never rounds up).
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
