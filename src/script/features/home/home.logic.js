// home.logic.js — orchestrates the home composer: validate a script, then
// persist it as a new workspace. No DOM here (logic layer).

import { createWorkspace } from '../../services/workspaces.store.js';
import { normalizeScript, isEmptyScript, deriveTitle } from './home.model.js';

// Returns { ok: true, workspace } on success, or { ok: false, reason } if the
// script is empty.
export function startFromScript(rawText) {
  const scriptText = normalizeScript(rawText);
  if (isEmptyScript(scriptText)) {
    return { ok: false, reason: 'empty' };
  }
  const workspace = createWorkspace({ title: deriveTitle(scriptText), scriptText });
  return { ok: true, workspace };
}

// Create a fresh, empty workspace so "New script" can open a blank, editable
// script straight in the teleprompter (which persists edits as you type).
export function createBlankWorkspace() {
  return createWorkspace({});
}
