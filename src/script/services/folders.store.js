// folders.store.js — persistence for Workspaces library folders. Local-only
// (localStorage) like workspaces.store; the shape is backend-ready. No DOM here.
//
// Folder = { id, name, parentId, createdAt, updatedAt }
//   parentId = null → the folder sits at the library root. Nesting is supported.

import { getItem, setItem } from '../utils/storage.js';
import { LS_FOLDERS, LS_WS_SEEDED } from '../utils/storage-keys.js';
import { makeId } from '../utils/id.js';

function readAll() {
  const list = getItem(LS_FOLDERS);
  return Array.isArray(list) ? list : [];
}

function writeAll(list) {
  setItem(LS_FOLDERS, list);
}

export function listFolders() {
  return readAll();
}

export function createFolder({ name, parentId = null } = {}) {
  const now = Date.now();
  const folder = {
    id: makeId('folder'),
    name: (name || '').trim() || 'New Folder',
    parentId: parentId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const list = readAll();
  list.push(folder);
  writeAll(list);
  return folder;
}

export function updateFolder(id, patch = {}) {
  const list = readAll();
  const index = list.findIndex((f) => f.id === id);
  if (index === -1) return null;
  const updated = { ...list[index], ...patch, id, updatedAt: Date.now() };
  list[index] = updated;
  writeAll(list);
  return updated;
}

// Remove a set of folders in one write (used for recursive folder-tree delete).
export function removeFolders(ids) {
  const doomed = new Set((ids || []).map((id) => String(id)));
  writeAll(readAll().filter((f) => !doomed.has(String(f.id))));
}

// One-shot default-folder seeding flag.
export function hasSeeded() {
  return getItem(LS_WS_SEEDED) === true;
}

export function markSeeded() {
  setItem(LS_WS_SEEDED, true);
}
