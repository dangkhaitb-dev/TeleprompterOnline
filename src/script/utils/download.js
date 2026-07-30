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

// Chrome on iOS has historically handled blob downloads less consistently
// than Safari. Detect its stable CriOS product token so Safari keeps its
// existing direct-download behavior.
function isChromeIOS() {
  if (typeof navigator === 'undefined') return false;
  return /CriOS\//.test(navigator.userAgent);
}

function errorDetails(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
  };
}

// Trigger a browser download for a blob; the temporary URL self-revokes. The
// optional debug hook reports lifecycle names and safe metadata, never the
// object URL or file bytes.
export function downloadBlob(blob, filename, { onDebug } = {}) {
  if (!blob) return;
  const name = filename || 'download';
  const report = (event, details = {}) => onDebug?.(event, details);
  report('download:start', { name, type: blob.type || '', size: blob.size });

  // Chrome iOS path — prefer navigator.share with a File.
  if (isChromeIOS()) {
    if (navigator.share && navigator.canShare) {
      try {
        const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
        if (navigator.canShare({ files: [file] })) {
          report('download:share-started', { type: file.type, size: file.size });
          navigator.share({ files: [file] }).catch((error) => {
            report('download:share-rejected', errorDetails(error));
          });
          return;
        }
        report('download:share-unsupported', { type: file.type });
      } catch (error) {
        report('download:share-throw', errorDetails(error));
        // File constructor or canShare threw — fall through to blob-tab.
      }
    }
    // When file sharing is unavailable, a new blob tab gives WKWebView's host
    // app a navigation it can hand to its preview/download UI.
    try {
      const url = URL.createObjectURL(blob);
      report('download:url-created', { scheme: 'blob:' });
      const opened = window.open(url, '_blank', 'noopener');
      if (!opened) {
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.target = '_blank';
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        link.remove();
      }
      report('download:opened');
      setTimeout(() => {
        URL.revokeObjectURL(url);
        report('download:revoked');
      }, 60_000);
      return;
    } catch (error) {
      report('download:throw', errorDetails(error));
      throw error;
    }
  }

  // Standard path — works on desktop browsers.
  try {
    const url = URL.createObjectURL(blob);
    report('download:url-created', { scheme: 'blob:' });
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    report('download:clicked');
    // Give the download a tick to start before releasing the URL.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      report('download:revoked');
    }, 1000);
  } catch (error) {
    report('download:throw', errorDetails(error));
    throw error;
  }
}
