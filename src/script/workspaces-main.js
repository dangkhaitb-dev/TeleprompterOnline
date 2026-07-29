// workspaces-main.js — entry for the Workspaces script library (workspaces.html).

import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/components/toast.css';
import '../styles/components/confirm-popup.css';
import '../styles/components/prompt-popup.css';
import '../styles/components/storage-settings-popup.css';
import '../styles/components/recording-preview.css';
import '../styles/components/export-status-popup.css';
import '../styles/workspaces.css';

import { initWorkspacesUI } from './features/workspaces/workspaces.ui.js';
import { indexedDbGarbageCollect } from './features/teleprompter/teleprompter.logic.js';
import { initButtonClickTracking } from './libs/firebase/button-click-analytics.ui.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';

document.documentElement.setAttribute('data-theme', 'light');

initButtonClickTracking();
releasePointerButtonFocus();
initWorkspacesUI();

// Clean up any orphaned temporary IndexedDB records when entering the workspaces
// dashboard — idle-gated so the getAll() scan never contends with the first render.
const runIndexedDbGc = () => indexedDbGarbageCollect().catch(() => {});
if ('requestIdleCallback' in window) {
  window.requestIdleCallback(runIndexedDbGc, { timeout: 3000 });
} else {
  window.setTimeout(runIndexedDbGc, 1500);
}
