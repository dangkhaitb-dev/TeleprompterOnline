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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function storedString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function storedTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

// localStorage survives deployments, interrupted writes, manual edits, and old
// schemas. Treat every entry as untrusted: preserve usable records, replace bad
// fields with safe defaults, and drop only entries that have no usable id.
function normalizeWorkspace(raw) {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' || typeof raw.id === 'number'
    ? String(raw.id).trim()
    : '';
  if (!id) return null;

  const settings = isRecord(raw.settings) ? raw.settings : {};
  const folderId = raw.folderId === null || raw.folderId === undefined
    ? null
    : (typeof raw.folderId === 'string' || typeof raw.folderId === 'number'
      ? String(raw.folderId)
      : null);

  return {
    ...raw,
    id,
    title: storedString(raw.title).trim() || 'Untitled script',
    scriptText: storedString(raw.scriptText),
    scriptHtml: storedString(raw.scriptHtml),
    folderId,
    settings,
    createdAt: storedTimestamp(raw.createdAt),
    updatedAt: storedTimestamp(raw.updatedAt),
  };
}

function readAll() {
  const list = getItem(LS_WORKSPACES);
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const safe = [];
  for (const raw of list) {
    const workspace = normalizeWorkspace(raw);
    if (!workspace || seen.has(workspace.id)) continue;
    seen.add(workspace.id);
    safe.push(workspace);
  }
  return safe;
}

function writeAll(list) {
  const safe = Array.isArray(list)
    ? list.map(normalizeWorkspace).filter(Boolean)
    : [];
  setItem(LS_WORKSPACES, safe);
}

// Most-recently-updated first.
export function listWorkspaces() {
  return readAll().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getWorkspace(id) {
  const normalizedId = String(id ?? '');
  return readAll().find((w) => w.id === normalizedId) || null;
}

export function createWorkspace({ title, scriptText, folderId = null } = {}) {
  const now = Date.now();
  const workspace = {
    id: makeId('ws'),
    title: storedString(title).trim() || 'Untitled script',
    scriptText: storedString(scriptText),
    scriptHtml: '',
    folderId: typeof folderId === 'string' || typeof folderId === 'number'
      ? String(folderId)
      : null,
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
  const normalizedId = String(id ?? '');
  const index = list.findIndex((w) => w.id === normalizedId);
  if (index === -1) return null;
  const safePatch = isRecord(patch) ? patch : {};
  const updated = normalizeWorkspace({
    ...list[index],
    ...safePatch,
    id: normalizedId,
    updatedAt: Date.now(),
  });
  list[index] = updated;
  writeAll(list);
  return updated;
}

export function removeWorkspace(id) {
  const normalizedId = String(id ?? '');
  writeAll(readAll().filter((w) => w.id !== normalizedId));
}

// Move a workspace into a folder (folderId null = library root). Does not bump
// updatedAt — moving is organizing, not editing, so recency order is preserved.
export function moveWorkspace(id, folderId) {
  const list = readAll();
  const normalizedId = String(id ?? '');
  const index = list.findIndex((w) => w.id === normalizedId);
  if (index === -1) return null;
  const updated = {
    ...list[index],
    folderId: typeof folderId === 'string' || typeof folderId === 'number'
      ? String(folderId)
      : null,
  };
  list[index] = updated;
  writeAll(list);
  return updated;
}

// Persist a script's per-script studio settings. Does NOT bump updatedAt —
// tweaking speed/theme/etc. is configuration, not a content edit, so it must not
// reorder the recency-sorted library (mirrors moveWorkspace/renameWorkspace).
export function updateWorkspaceSettings(id, settings) {
  const list = readAll();
  const normalizedId = String(id ?? '');
  const index = list.findIndex((w) => w.id === normalizedId);
  if (index === -1) return null;
  const updated = {
    ...list[index],
    settings: isRecord(settings) ? settings : {},
  };
  list[index] = updated;
  writeAll(list);
  return updated;
}

// Rename a workspace's title without bumping updatedAt (keeps recency order).
export function renameWorkspace(id, title) {
  const list = readAll();
  const normalizedId = String(id ?? '');
  const index = list.findIndex((w) => w.id === normalizedId);
  if (index === -1) return null;
  const updated = {
    ...list[index],
    title: storedString(title).trim() || 'Untitled script',
  };
  list[index] = updated;
  writeAll(list);
  return updated;
}
