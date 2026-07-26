// load-crisp.js — lazily inject the Crisp live-chat widget on every page except
// the teleprompter recorder.
//
// Crisp is a third-party support script; it must never compete with the page's
// own critical work. We set the queue globals synchronously (so any hide/show
// command issued before the script loads is honoured), then hold the actual
// <script> download until the window `load` event has fired — all first-party
// JS/CSS plus any prefetched teleprompter chunk are done — and the main thread
// next goes idle. Best-effort and idempotent. Accepts injected `window`/
// `schedule` so it stays node-testable like utils/prefetch-page.js.
//
// `$crisp` / `CRISP_WEBSITE_ID` are Crisp's own API globals, not `window.__*`
// cross-module channels, so they are outside the eslint window-underscore ban.

// Public Crisp website ID: identifies the site to Crisp, safe to ship in client
// code (not a secret credential). Single source of truth — no scattered literals.
export const CRISP_WEBSITE_ID = '728a94ed-4d50-4e56-bbc4-9dd58b88a153';

const CRISP_SRC = 'https://client.crisp.chat/l.js';

// Defer `cb` until the page has fully loaded AND the browser is next idle, so
// the widget download lands dead last. Runs on the next idle immediately when
// `load` already fired (script wired after a slow import).
function afterLoadWhenIdle(cb, win) {
  const whenIdle = () => {
    if (typeof win.requestIdleCallback === 'function') {
      win.requestIdleCallback(cb, { timeout: 3000 });
    } else {
      win.setTimeout(cb, 0);
    }
  };
  if (win.document.readyState === 'complete') whenIdle();
  else win.addEventListener('load', whenIdle, { once: true });
}

// Initialise Crisp for this page. Returns true when it scheduled a fresh
// injection, false when it was a no-op (already initialised, or no DOM).
export function loadCrisp(websiteId = CRISP_WEBSITE_ID, options = {}) {
  const win = options.window ?? (typeof window !== 'undefined' ? window : null);
  const schedule = options.schedule ?? afterLoadWhenIdle;
  if (!win || !win.document || !websiteId) return false;
  if (win.CRISP_WEBSITE_ID || win.document.querySelector(`script[src="${CRISP_SRC}"]`)) {
    return false; // already initialised on this page
  }

  // Set queue + id synchronously so commands queued before load are applied.
  win.$crisp = win.$crisp || [];
  win.CRISP_WEBSITE_ID = websiteId;

  schedule(() => {
    if (win.document.querySelector(`script[src="${CRISP_SRC}"]`)) return;
    const script = win.document.createElement('script');
    script.src = CRISP_SRC;
    script.async = true;
    win.document.head.appendChild(script);
  }, win);

  return true;
}

// Hide/show the Crisp launcher. Used while the in-page teleprompter overlay is
// open so the bubble never covers the recorder. Commands queue on `$crisp` and
// are applied once the script loads, so they are safe even before Crisp is ready.
export function hideCrisp(win = typeof window !== 'undefined' ? window : null) {
  win?.$crisp?.push(['do', 'chat:hide']);
}

export function showCrisp(win = typeof window !== 'undefined' ? window : null) {
  win?.$crisp?.push(['do', 'chat:show']);
}
