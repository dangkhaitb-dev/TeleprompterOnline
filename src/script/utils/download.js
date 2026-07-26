// download.js — object-URL lifecycle + blob download helper (DOM-touching util).
// The scene editor mints many transient object URLs (playback, thumbnails,
// export). This wraps them in a tracked Set so teardown can revoke every live
// URL, and offers a one-shot download that self-revokes.

// Create a tracked object URL. Pass the editor's Set so teardown can revoke all.
export function createTrackedUrl(blob, urlSet) {
  const url = URL.createObjectURL(blob);
  if (urlSet) urlSet.add(url);
  return url;
}

// Revoke one tracked URL (no-op if already gone).
export function revokeTrackedUrl(url, urlSet) {
  if (!url) return;
  URL.revokeObjectURL(url);
  if (urlSet) urlSet.delete(url);
}

// Revoke every URL in the set (teardown).
export function revokeAll(urlSet) {
  if (!urlSet) return;
  urlSet.forEach((url) => URL.revokeObjectURL(url));
  urlSet.clear();
}

// Turn a title into a safe-ish filename fragment (no path/reserved chars).
export function safeFileName(name, fallback = 'recording') {
  const cleaned = (name || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

// Trigger a browser download for a blob; the temporary URL self-revokes.
export function downloadBlob(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the download a tick to start before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
