// workspaces.store.js — persistence for saved script projects ("workspaces").
// Local-only (localStorage) for v1; the shape is backend-ready so a server sync
// can slot in later. No DOM here (service layer).
//
// Workspace = { id, title, scriptText, scriptHtml, folderId, settings, createdAt, updatedAt }
//   scriptText — plain innerText (used for card snippets/previews)
//   scriptHtml — rich innerHTML of the prompt surface (preserves inline formatting)
//   settings   — per-script studio state; shape/defaults live in teleprompter.model
//   timestamps — epoch ms

import { getItem, setItem } from '../utils/storage.js';
import { LS_WORKSPACES } from '../utils/storage-keys.js';
import { makeId } from '../utils/id.js';

function readAll() {
  const list = getItem(LS_WORKSPACES);
  return Array.isArray(list) ? list : [];
}

function writeAll(list) {
  setItem(LS_WORKSPACES, list);
}

// Most-recently-updated first.
export function listWorkspaces() {
  return readAll().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getWorkspace(id) {
  return readAll().find((w) => w.id === id) || null;
}

export function createWorkspace({ title, scriptText, folderId = null } = {}) {
  const now = Date.now();
  const workspace = {
    id: makeId('ws'),
    title: (title || '').trim() || 'Untitled script',
    scriptText: scriptText || '',
    scriptHtml: '',
    folderId: folderId ?? null,
    settings: {},
    createdAt: now,
    updatedAt: now,
  };
  const list = readAll();
  list.push(workspace);
  writeAll(list);
  return workspace;
}

export function updateWorkspace(id, patch = {}) {
  const list = readAll();
  const index = list.findIndex((w) => w.id === id);
  if (index === -1) return null;
  const updated = { ...list[index], ...patch, id, updatedAt: Date.now() };
  list[index] = updated;
  writeAll(list);
  return updated;
}

export function removeWorkspace(id) {
  writeAll(readAll().filter((w) => w.id !== id));
}

// Move a workspace into a folder (folderId null = library root). Does not bump
// updatedAt — moving is organizing, not editing, so recency order is preserved.
export function moveWorkspace(id, folderId) {
  const list = readAll();
  const index = list.findIndex((w) => w.id === id);
  if (index === -1) return null;
  const updated = { ...list[index], folderId: folderId ?? null };
  list[index] = updated;
  writeAll(list);
  return updated;
}

// Persist a script's per-script studio settings. Does NOT bump updatedAt —
// tweaking speed/theme/etc. is configuration, not a content edit, so it must not
// reorder the recency-sorted library (mirrors moveWorkspace/renameWorkspace).
export function updateWorkspaceSettings(id, settings) {
  const list = readAll();
  const index = list.findIndex((w) => w.id === id);
  if (index === -1) return null;
  const updated = { ...list[index], settings: settings || {} };
  list[index] = updated;
  writeAll(list);
  return updated;
}

// Rename a workspace's title without bumping updatedAt (keeps recency order).
export function renameWorkspace(id, title) {
  const list = readAll();
  const index = list.findIndex((w) => w.id === id);
  if (index === -1) return null;
  const updated = { ...list[index], title: (title || '').trim() || 'Untitled script' };
  list[index] = updated;
  writeAll(list);
  return updated;
}
