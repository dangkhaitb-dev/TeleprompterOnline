// stale-detector.js — pure helpers that decide when a teleprompter tab is
// showing an out-of-date version of a workspace (another tab saved newer script
// content). No DOM, no storage — just snapshot + compare, so this stays the
// single, testable source of truth for "what counts as out of sync".
//
// Scope of a snapshot = the SCRIPT CONTENT only: the rich body html (which also
// carries the content's inline style — bold/color/etc.) plus its derived plain
// text. Per-script settings (speed/theme/align/margins…), timestamps, folderId
// and title are deliberately excluded — only content edits count as stale.

// Order-stable stringify: sorts object keys recursively so two settings objects
// with the same values but different key order serialize identically (the store
// can hand them back in any order).
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

// Canonical snapshot string for a workspace's script content. Two equal strings
// ⇒ the two tabs would render the same script body (text + inline style).
export function snapshotWorkspace(workspace) {
  const ws = workspace || {};
  return stableStringify({
    html: ws.scriptHtml || '',
    text: ws.scriptText || '',
  });
}

// True when `fresh` differs from the `baseline` the tab last synced to. Accepts
// either raw workspace objects or pre-computed snapshot strings (so callers can
// hold onto a cheap baseline string instead of re-snapshotting each compare).
export function isStale(baseline, fresh) {
  const a = typeof baseline === 'string' ? baseline : snapshotWorkspace(baseline);
  const b = typeof fresh === 'string' ? fresh : snapshotWorkspace(fresh);
  return a !== b;
}
