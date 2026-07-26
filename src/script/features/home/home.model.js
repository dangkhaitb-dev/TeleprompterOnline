// home.model.js — pure helpers for the home script composer. No DOM, no IO.

// Normalize line endings and trim surrounding whitespace.
export function normalizeScript(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : '';
}

export function isEmptyScript(text) {
  return normalizeScript(text).length === 0;
}

// Derive a short workspace title from the first non-empty line of the script.
export function deriveTitle(text) {
  const firstLine = normalizeScript(text)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const title = (firstLine || '').slice(0, 60).trim();
  return title || 'Untitled script';
}
