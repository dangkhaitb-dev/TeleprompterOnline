// workspace-import.service.js — validate a workspace JSON document and persist
// it as a new local workspace. Imported ids/folder relations never overwrite
// existing library data.

import { createWorkspace, updateWorkspace } from './workspaces.store.js';
import { normalizeSettings } from '../features/teleprompter/teleprompter.model.js';
import { parseWorkspaceJson, sanitizeWorkspaceHtml } from '../utils/workspace-json.js';

export function importWorkspaceJson(text, { folderId = null } = {}) {
  const imported = parseWorkspaceJson(text);
  const workspace = createWorkspace({
    title: imported.title,
    scriptText: imported.scriptText,
    folderId,
  });
  return updateWorkspace(workspace.id, {
    scriptText: imported.scriptText,
    scriptHtml: sanitizeWorkspaceHtml(imported.scriptHtml),
    settings: normalizeSettings(imported.settings),
    folderId: folderId ?? null,
  });
}
