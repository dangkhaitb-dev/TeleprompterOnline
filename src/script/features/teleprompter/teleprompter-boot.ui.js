// teleprompter-boot.ui.js — shared boot sequence for the teleprompter studio.
// Used by both the standalone /teleprompter page (root = document) and the
// in-page overlay (root = overlay element), so session-lock + UI init + GC
// stay in one place.

import { initTeleprompterUI } from './teleprompter.ui.js';
import {
  opfsGarbageCollect,
  indexedDbGarbageCollect,
} from './teleprompter.logic.js';
import { acquireWorkspaceSessionLock } from '../../utils/workspace-session-lock.js';

export async function bootTeleprompter({ root = document, workspace, onExit } = {}) {
  const lock = workspace && workspace.id
    ? await acquireWorkspaceSessionLock(workspace.id)
    : { acquired: false, release: () => {} };

  const teardownUI = initTeleprompterUI(workspace, { root, onExit });

  // Orphans are deleted only when their resource/workspace has no live lock,
  // so GC can wait for idle — its OPFS/IndexedDB churn must not compete with
  // mounting the studio.
  const runGarbageCollect = () => {
    opfsGarbageCollect().catch(() => {});
    indexedDbGarbageCollect().catch(() => {});
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(runGarbageCollect, { timeout: 5000 });
  } else {
    window.setTimeout(runGarbageCollect, 2000);
  }

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (teardownUI) teardownUI();
      lock.release();
    },
  };
}
