// folders.store.js — persistence for Workspaces library folders. Local-only
// (localStorage) like workspaces.store; the shape is backend-ready. No DOM here.
//
// Folder = { id, name, parentId, createdAt, updatedAt }
//   parentId = null → the folder sits at the library root. Nesting is supported.

import { getItem, setItem } from '../utils/storage.js';
import { LS_FOLDERS, LS_WS_SEEDED } from '../utils/storage-keys.js';
import { makeId } from '../utils/id.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFolder(raw) {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' || typeof raw.id === 'number'
    ? String(raw.id).trim()
    : '';
  if (!id) return null;
  const parentId = raw.parentId === null || raw.parentId === undefined
    ? null
    : (typeof raw.parentId === 'string' || typeof raw.parentId === 'number'
      ? String(raw.parentId)
      : null);
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
    ? raw.createdAt
    : 0;
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
    ? raw.updatedAt
    : createdAt;

  return {
    ...raw,
    id,
    name: typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : 'New Folder',
    parentId,
    createdAt,
    updatedAt,
  };
}

function readAll() {
  const list = getItem(LS_FOLDERS);
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const safe = [];
  for (const raw of list) {
    const folder = normalizeFolder(raw);
    if (!folder || seen.has(folder.id)) continue;
    seen.add(folder.id);
    safe.push(folder);
  }
  return safe;
}

function writeAll(list) {
  const safe = Array.isArray(list)
    ? list.map(normalizeFolder).filter(Boolean)
    : [];
  setItem(LS_FOLDERS, safe);
}

export function listFolders() {
  return readAll();
}

export function createFolder({ name, parentId = null } = {}) {
  const now = Date.now();
  const folder = {
    id: makeId('folder'),
    name: typeof name === 'string' && name.trim() ? name.trim() : 'New Folder',
    parentId: typeof parentId === 'string' || typeof parentId === 'number'
      ? String(parentId)
      : null,
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
  const normalizedId = String(id ?? '');
  const index = list.findIndex((f) => f.id === normalizedId);
  if (index === -1) return null;
  const safePatch = isRecord(patch) ? patch : {};
  const updated = normalizeFolder({
    ...list[index],
    ...safePatch,
    id: normalizedId,
    updatedAt: Date.now(),
  });
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
