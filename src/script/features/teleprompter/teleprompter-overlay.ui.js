// teleprompter-overlay.ui.js — mounts the teleprompter studio as a full-screen
// overlay inside the current document (home/workspaces), so opening it costs
// zero server round-trips once the prefetch warm has run: markup comes from
// the shared HTML cache, JS/CSS from this dynamically imported chunk. The
// standalone /teleprompter page keeps working through the same boot module.

import '../../../styles/components/back-btn.css';
import '../../../styles/teleprompter.css';

import { bootTeleprompter } from './teleprompter-boot.ui.js';
import {
  loadWorkspace,
  createScratchWorkspace,
  resolveInitialSettings,
} from './teleprompter.logic.js';
import { fetchPageHtml, extractBodyHtml } from '../../utils/prefetch-page.js';
import { isFullscreen, exitFullscreen } from '../../utils/fullscreen.js';

const TELEPROMPTER_URL = '/teleprompter';

// Only one studio session at a time; repeated open calls return the live one.
let active = null;

// Warm the markup cache. Importing this module already warmed the JS+CSS
// chunks, so call sites lazy-import it on idle and then invoke this. Returns
// the fetch promise so callers can sequence work behind the warm-up. Also
// warms the deferred studio-panels chunk (loaded eagerly after mount) so a
// warmed open has nothing left to fetch.
export function preloadTeleprompterOverlay() {
  import('./components/studio-panels.ui.js').catch(() => {});
  return fetchPageHtml(TELEPROMPTER_URL);
}

export async function openTeleprompterOverlay(workspaceId, { onClosed } = {}) {
  if (active) return active;

  // Parity with teleprompter-main: a stale/missing id auto-creates a scratch
  // workspace instead of a dead end.
  const workspace = loadWorkspace(workspaceId) || createScratchWorkspace();
  const teleprompterUrl = `${TELEPROMPTER_URL}?ws=${encodeURIComponent(workspace.id)}`;

  // 'high' priority: this fetch is on the click-critical path — the user is
  // waiting for the studio to mount. (The idle warm above used the default
  // 'low'; if it's already cached this call just reuses the result.)
  const html = extractBodyHtml((await fetchPageHtml(TELEPROMPTER_URL, { priority: 'high' })) || '');
  if (!html) {
    // Cold cache and the fetch failed (offline/server error): fall back to a
    // real navigation so the user still gets the studio.
    window.location.href = teleprompterUrl;
    return null;
  }

  const prevTheme = document.documentElement.dataset.theme;
  const prevFocus = document.activeElement;

  // Mount synchronously in one task so no intermediate state ever paints.
  const rootEl = document.createElement('div');
  rootEl.className = 'tp-overlay';
  rootEl.innerHTML = html;
  document.body.appendChild(rootEl);
  // tp-page on <html> applies the studio's page-level rules and doubles as the
  // host scroll lock; the studio theme replaces the host theme until close.
  document.documentElement.classList.add('tp-page');
  document.documentElement.dataset.theme =
    resolveInitialSettings(workspace).pageTheme === 'light' ? 'light' : 'dark';

  // Real URL swap: F5 lands on the standalone page for this workspace, and the
  // browser Back button closes the overlay (popstate below).
  window.history.pushState({ vpTpOverlay: true }, '', teleprompterUrl);

  let session = null;
  let closing = false;
  let closed = false;

  const onPop = () => close('popstate');

  const close = (reason) => {
    if (closed) return;
    closed = true;
    active = null;
    // Boot may still be awaiting the session lock; flag it so the tail of
    // openTeleprompterOverlay destroys the session as soon as it exists.
    if (!session) closing = true;
    window.removeEventListener('popstate', onPop);
    if (isFullscreen()) {
      try {
        const exiting = exitFullscreen();
        if (exiting && exiting.catch) exiting.catch(() => {});
      } catch {
        // Leaving fullscreen is best-effort; the overlay teardown continues.
      }
    }
    if (session) session.destroy();
    rootEl.remove();
    document.documentElement.classList.remove('tp-page');
    if (prevTheme === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = prevTheme;
    // The UI close path still owns our history entry; the Back-button path
    // arrives here from popstate, where the browser already removed it.
    if (reason !== 'popstate') window.history.back();
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
    if (onClosed) onClosed();
  };

  window.addEventListener('popstate', onPop);

  session = await bootTeleprompter({
    root: rootEl,
    workspace,
    onExit: () => close('ui'),
  });
  if (closing) {
    session.destroy();
    return null;
  }

  active = { close: () => close('ui') };
  return active;
}
