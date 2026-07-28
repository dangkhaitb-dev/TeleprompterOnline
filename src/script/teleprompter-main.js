// teleprompter-main.js — entry for the teleprompter record page.
// Reads ?ws=<id>, loads that workspace through the logic layer, then boots the
// record UI via the shared boot module (also used by the in-page overlay).

import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/components/back-btn.css';
import '../styles/teleprompter.css';

import { bootTeleprompter } from './features/teleprompter/teleprompter-boot.ui.js';
import {
  loadWorkspace,
  createScratchWorkspace,
} from './features/teleprompter/teleprompter.logic.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';

releasePointerButtonFocus();

const params = new URLSearchParams(window.location.search);
const workspaceId = params.get('ws');

// No workspace (opened with no ?ws=, or a stale/deleted id) is not a dead end:
// auto-create a fresh workspace so the studio is immediately usable with no
// content — no blocking empty state. Reflect the new id in the URL so reloads,
// the session lock, and GC all track it like any normal script.
let workspace = loadWorkspace(workspaceId);
if (!workspace) {
  workspace = createScratchWorkspace();
  const next = `${window.location.pathname}?ws=${encodeURIComponent(workspace.id)}`;
  window.history.replaceState(null, '', next);
}

// The standalone page never calls destroy(): teardown runs on pagehide and the
// browser releases the session lock when the page goes away.
bootTeleprompter({ workspace }).catch((error) => {
  // Never turn an initialization failure into a mysteriously inert UI.
  // Storage is normalized before this point; remaining boot failures belong in
  // the console so they can be diagnosed without deleting user data.
  console.error('[Teleprompter] Failed to initialize the studio', error);
});
