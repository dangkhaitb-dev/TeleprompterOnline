// workspace-export.service.js — turn selected workspaces into portable JSON.
// No DOM and no download behavior lives here.

import { getWorkspace, listWorkspaces } from './workspaces.store.js';
import { createJsonBlob, safeZipSegment } from '../utils/export-data.js';

export const WORKSPACE_EXPORT_FORMAT = 'vteleprompter-workspace';
export const EXPORT_SCHEMA_VERSION = 1;

function exportTimestamp(now) {
  return new Date(now).toISOString();
}

export function buildWorkspaceExportPayload(workspace, now = Date.now()) {
  if (!workspace?.id) throw new Error('Workspace not found');
  return {
    format: WORKSPACE_EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: exportTimestamp(now),
    workspace: {
      id: workspace.id,
      title: workspace.title || 'Untitled script',
      scriptText: workspace.scriptText || '',
      scriptHtml: workspace.scriptHtml || '',
      folderId: workspace.folderId ?? null,
      settings: workspace.settings || {},
      createdAt: workspace.createdAt || null,
      updatedAt: workspace.updatedAt || null,
    },
  };
}

export function buildSelectedWorkspaceEntries(workspaces = [], ids = [], now = Date.now()) {
  const selectedIds = new Set((ids || []).map(String));
  const selectedWorkspaces = workspaces.filter((workspace) => selectedIds.has(String(workspace.id)));
  const usedNames = new Map();
  return selectedWorkspaces.map((workspace) => {
    const base = safeZipSegment(workspace.title, 'untitled-script');
    const key = base.toLocaleLowerCase();
    const occurrence = (usedNames.get(key) || 0) + 1;
    usedNames.set(key, occurrence);
    const suffix = occurrence > 1 ? ` (${occurrence})` : '';
    return {
      name: `${base}${suffix}.json`,
      blob: createJsonBlob(buildWorkspaceExportPayload(workspace, now)),
    };
  });
}

export function createWorkspaceJsonExport(workspaceId, now = Date.now()) {
  const workspace = getWorkspace(workspaceId);
  const payload = buildWorkspaceExportPayload(workspace, now);
  return { blob: createJsonBlob(payload), workspace: payload.workspace };
}

export function collectSelectedWorkspaceEntries(workspaceIds, now = Date.now()) {
  const entries = buildSelectedWorkspaceEntries(listWorkspaces(), workspaceIds, now);
  if (entries.length === 0) throw new Error('No workspaces selected');
  return entries;
}
