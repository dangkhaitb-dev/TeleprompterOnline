// workspaces.model.js — pure transforms for the Workspaces library. Maps a
// stored Workspace (+ its recording count) into a card view-model. No DOM, no IO.

import { formatDuration } from '../../utils/format-time.js';

const SNIPPET_MAX = 260;
// Card previews are ~100px-tall clipped boxes — laying out a full 10k-word
// rich document inside each one is pure waste. Browsers parse truncated HTML
// fine via innerHTML (open tags are auto-closed).
const PREVIEW_HTML_MAX = 4000;

// A short single-block preview of the script for the card thumbnail.
export function deriveSnippet(scriptText, maxChars = SNIPPET_MAX) {
  const text = typeof scriptText === 'string' ? scriptText.replace(/\r\n/g, '\n').trim() : '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

// Absolute "Mon D, YYYY" date; empty string when the timestamp is missing.
export function formatUpdatedDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// raw = stored Workspace { id, title, scriptText, scriptHtml, settings, folderId, updatedAt, ... }
export function toWorkspaceCard(raw = {}) {
  return {
    id: raw.id,
    title: (raw.title || '').trim(),
    snippet: deriveSnippet(raw.scriptText),
    previewHtml: (raw.scriptHtml || '').slice(0, PREVIEW_HTML_MAX),
    settings: raw.settings || {},
    updatedDate: formatUpdatedDate(raw.updatedAt),
  };
}

// ===== Folders (organizing workspaces; parentId null = root, nesting ok) =====

// Treat null/undefined folderId/parentId the same ("at root").
export function sameFolder(a, b) {
  return (a == null ? null : String(a)) === (b == null ? null : String(b));
}

export function folderById(folders, id) {
  return folders.find((f) => String(f.id) === String(id)) || null;
}

export function childFolders(folders, parentId) {
  return folders.filter((f) => sameFolder(f.parentId, parentId));
}

export function childWorkspaces(workspaces, folderId) {
  return workspaces.filter((w) => sameFolder(w.folderId, folderId));
}

// Ancestor chain [root…leaf] for the breadcrumb; empty at root.
export function buildFolderPath(folders, folderId) {
  const path = [];
  let cursor = folderId != null ? folderById(folders, folderId) : null;
  let guard = 0;
  while (cursor && guard++ < 100) {
    path.unshift(cursor);
    cursor = cursor.parentId != null ? folderById(folders, cursor.parentId) : null;
  }
  return path;
}

// Is `folderId` inside `ancestorId`'s subtree? Guards drops into own descendants.
export function isDescendantOf(folders, folderId, ancestorId) {
  let cursor = folderById(folders, folderId);
  let guard = 0;
  while (cursor && guard++ < 100) {
    if (sameFolder(cursor.parentId, ancestorId)) return true;
    cursor = cursor.parentId != null ? folderById(folders, cursor.parentId) : null;
  }
  return false;
}

// A folder id plus every descendant folder id (for recursive delete).
export function collectFolderIds(folders, id) {
  const acc = [String(id)];
  childFolders(folders, id).forEach((child) => {
    acc.push(...collectFolderIds(folders, child.id));
  });
  return acc;
}

// Keep folder names unique within a parent scope — append " (2)", " (3)"…
export function uniqueFolderName(folders, base, parentId, excludeId) {
  const name = (base || '').trim() || 'New Folder';
  const taken = new Set();
  folders.forEach((f) => {
    if (sameFolder(f.parentId, parentId) && (excludeId == null || String(f.id) !== String(excludeId))) {
      taken.add(f.name.toLowerCase());
    }
  });
  if (!taken.has(name.toLowerCase())) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`.toLowerCase())) n += 1;
  return `${name} (${n})`;
}

export function toFolderCard(folder = {}, itemCount = 0) {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId ?? null,
    itemCount: Number.isFinite(itemCount) ? itemCount : 0,
  };
}

// ===== Recordings (the Recordings view — kept separate from script state) =====

// ms → "MM:SS" — shared formatter (utils/format-time.js).
export { formatDuration };

// raw = stored Recording { id, workspaceId, kind, duration, blob, createdAt }
export function toRecordingCard(raw = {}, workspaceTitle = '') {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId,
    workspaceTitle: (workspaceTitle || '').trim(),
    kind: raw.kind === 'audio' ? 'audio' : 'video',
    durationLabel: formatDuration(raw.duration),
    createdAt: raw.createdAt || 0,
    createdDate: formatUpdatedDate(raw.createdAt),
    blob: raw.blob || null,
    // WebKit-fallback records carry no blob in listings; the UI loads their
    // bytes on demand (preview/download/thumbnail) via ensureRecordingBlob.
    hasBytes: !!raw.hasBytes,
    mimeType: raw.mimeType || '',
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Local Y-M-D bucket key for a timestamp (calendar day in the user's timezone).
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Group recording cards into day sections (newest day first), the way media
// libraries do. Cards are assumed newest-first already, so items stay ordered.
// Returns [{ key, label, items }]. Labels: Today / Yesterday / "Mon D, YYYY".
export function groupRecordingsByDay(
  cards = [],
  { now = Date.now(), todayLabel = 'Today', yesterdayLabel = 'Yesterday' } = {},
) {
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(now - DAY_MS);
  const groups = new Map();
  cards.forEach((card) => {
    const ts = card.createdAt || 0;
    const key = dayKey(ts);
    if (!groups.has(key)) groups.set(key, { key, ts, items: [] });
    const group = groups.get(key);
    group.items.push(card);
    if (ts > group.ts) group.ts = ts;
  });
  return [...groups.values()]
    .sort((a, b) => b.ts - a.ts)
    .map(({ key, ts, items }) => ({
      key,
      label: key === todayKey ? todayLabel : key === yesterdayKey ? yesterdayLabel : formatUpdatedDate(ts),
      items,
    }));
}

// ===== Local storage budget ================================================
// User-chosen soft cap on local data (recordings dominate). The effective limit
// is the smaller of the user's chosen budget and the browser's real per-origin
// quota (the device's free disk) — the device is always the hard ceiling.
const GB = 1024 ** 3;
export const DEFAULT_STORAGE_LIMIT_BYTES = 2 * GB; // 2 GB out of the box
export const MIN_STORAGE_LIMIT_BYTES = Math.round(0.5 * GB); // floor the user can set
const STORAGE_WARN_RATIO = 0.8;

const toGB = (bytes) => Math.round((bytes / GB) * 10) / 10;
export const bytesToGB = toGB;
export const gbToBytes = (gb) => Math.round((Number(gb) || 0) * GB);

// The device is the hard ceiling: the user may never set the budget above the
// browser's real quota (nor below the floor). quota <= 0 means "unknown".
export function clampStorageLimit(bytes, quota = 0) {
  const ceiling = quota > 0 ? quota : DEFAULT_STORAGE_LIMIT_BYTES;
  const max = Math.max(MIN_STORAGE_LIMIT_BYTES, ceiling);
  return Math.min(Math.max(bytes || 0, MIN_STORAGE_LIMIT_BYTES), max);
}

// estimate = { usage, quota } from navigator.storage.estimate(), or null.
// limitBytes = the user's chosen budget (defaults to 2 GB).
export function evaluateStorage(estimate, limitBytes = DEFAULT_STORAGE_LIMIT_BYTES) {
  const budget = limitBytes || DEFAULT_STORAGE_LIMIT_BYTES;
  if (!estimate) {
    return { level: 'none', usedGB: 0, limitGB: toGB(budget), budgetGB: toGB(budget), maxGB: toGB(budget), percent: 0 };
  }
  const usage = estimate.usage || 0;
  const quota = estimate.quota || 0;
  const limit = quota > 0 ? Math.min(budget, quota) : budget;
  const ratio = limit > 0 ? usage / limit : 0;
  let level = 'none';
  if (ratio >= 1) level = 'full';
  else if (ratio >= STORAGE_WARN_RATIO) level = 'warn';
  return {
    level,
    usedGB: toGB(usage),
    limitGB: toGB(limit),
    // The user's chosen budget (may exceed the effective limit if quota is lower).
    budgetGB: toGB(budget),
    // The device ceiling the user can raise their budget up to (for the editor).
    maxGB: toGB(quota > 0 ? quota : budget),
    percent: Math.min(100, Math.round(ratio * 100)),
  };
}
