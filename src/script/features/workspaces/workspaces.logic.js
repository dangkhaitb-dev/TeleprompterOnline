// workspaces.logic.js — orchestration for the Workspaces library: read the
// folder tree + workspaces (with recording counts), create/rename/delete
// folders, move scripts & folders around, and delete with a recordings cascade.
// Returns plain data/promises; no DOM (logic layer).

import {
  listWorkspaces,
  removeWorkspace,
  moveWorkspace,
  renameWorkspace,
} from '../../services/workspaces.store.js';
import {
  listFolders,
  createFolder,
  updateFolder,
  removeFolders,
  hasSeeded,
  markSeeded,
} from '../../services/folders.store.js';
import {
  removeByWorkspace,
  listAllRecordings,
  removeRecording,
  removeRecordings,
  ensureRecordingBlob,
} from '../../services/recordings.store.js';
import { estimateStorage, requestPersistentStorage } from '../../utils/storage-quota.js';
import { createStreamingZipArtifact } from '../../utils/streaming-zip.js';
import { isoDateStamp } from '../../utils/export-data.js';
import {
  collectSelectedWorkspaceEntries,
  createWorkspaceJsonExport,
} from '../../services/workspace-export.service.js';
import { importWorkspaceJson } from '../../services/workspace-import.service.js';
import {
  isRecordingSaveEnabled,
  setRecordingSaveEnabled,
  getStorageLimitBytes,
  setStorageLimitBytes,
} from '../../services/recording-prefs.store.js';
import {
  toWorkspaceCard,
  toFolderCard,
  toRecordingCard,
  groupRecordingsByDay,
  evaluateStorage,
  clampStorageLimit,
  gbToBytes,
  bytesToGB,
  DEFAULT_STORAGE_LIMIT_BYTES,
  folderById,
  childFolders,
  childWorkspaces,
  buildFolderPath,
  isDescendantOf,
  collectFolderIds,
  uniqueFolderName,
  sameFolder,
} from './workspaces.model.js';
// Creating a workspace from a script is a home concern — reuse it here (Upload)
// instead of duplicating the validate-then-persist flow.
import { startFromScript, createBlankWorkspace } from '../home/home.logic.js';

export { startFromScript, createBlankWorkspace, groupRecordingsByDay };

export function exportScriptJson(id, now = Date.now()) {
  return createWorkspaceJsonExport(id, now);
}

export async function exportSelectedBackup(
  workspaceIds,
  { signal, onEntriesReady, onProgress, now = Date.now() } = {},
) {
  const entries = collectSelectedWorkspaceEntries(workspaceIds, now);
  onEntriesReady?.(entries.length);
  const artifact = await createStreamingZipArtifact(entries, { signal, onProgress });
  return {
    ...artifact,
    entryCount: entries.length,
    filename: `solprompter-selection-${isoDateStamp(now)}.zip`,
  };
}

export function uploadWorkspaceJson(text, folderId = null) {
  return importWorkspaceJson(text, { folderId });
}

// All workspaces (recency order) as card view-models — used by callers that
// don't care about folders.
export function loadWorkspaceCards() {
  return listWorkspaces().map((workspace) => toWorkspaceCard(workspace));
}

// The library view for one folder scope: the breadcrumb path, the child folders
// (with item counts), and the child scripts.
export function loadLibrary(currentFolderId = null) {
  const folders = listFolders();
  const workspaces = listWorkspaces();
  const path = buildFolderPath(folders, currentFolderId);
  const folderCards = childFolders(folders, currentFolderId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((folder) => {
      const count =
        childFolders(folders, folder.id).length + childWorkspaces(workspaces, folder.id).length;
      return toFolderCard(folder, count);
    });
  const scripts = childWorkspaces(workspaces, currentFolderId).map((workspace) =>
    toWorkspaceCard(workspace),
  );
  return { path, folders: folderCards, scripts };
}

// ---- Folder mutations -----------------------------------------------------
// Give every new user one empty folder to organize into — once. Guarded by a
// seeded flag so it is not re-created after the user deletes it.
export function ensureDefaultFolder(name) {
  if (hasSeeded()) return null;
  markSeeded();
  if (listFolders().length > 0) return null;
  return createFolder({ name: name || 'New Folder', parentId: null });
}

export function createFolderIn(name, parentId = null) {
  const folders = listFolders();
  return createFolder({ name: uniqueFolderName(folders, name, parentId, null), parentId });
}

export function renameFolder(id, name) {
  const folders = listFolders();
  const folder = folderById(folders, id);
  if (!folder) return null;
  return updateFolder(id, { name: uniqueFolderName(folders, name, folder.parentId, id) });
}

// Counts for the delete-folder confirmation (before anything is removed).
export function folderDeleteStats(id) {
  const ids = new Set(collectFolderIds(listFolders(), id));
  const scriptCount = listWorkspaces().filter((w) => ids.has(String(w.folderId))).length;
  return { subFolderCount: ids.size - 1, scriptCount };
}

// Delete a folder and its whole subtree: the folders, plus every script inside
// them with its recordings cascade.
export async function deleteFolderTree(id) {
  const ids = new Set(collectFolderIds(listFolders(), id));
  const doomed = listWorkspaces().filter((w) => ids.has(String(w.folderId)));
  removeFolders([...ids]);
  await Promise.all(
    doomed.map(async (workspace) => {
      removeWorkspace(workspace.id);
      try {
        await removeByWorkspace(workspace.id);
      } catch {
        // best-effort recordings cleanup
      }
    }),
  );
}

// ---- Recordings (separate from script state) ------------------------------
// All recordings across every workspace as card view-models, each tagged with
// its parent script title. Kept independent of the script library.
export async function loadAllRecordings() {
  const recordings = await listAllRecordings();
  const titleById = new Map(listWorkspaces().map((w) => [w.id, w.title]));
  // Temporary takes (recorded with save turned off) are session-scoped and get
  // garbage collected — never surface them in the Workspaces recordings library.
  return recordings
    .filter((rec) => !rec.temporary)
    .map((rec) => toRecordingCard(rec, titleById.get(rec.workspaceId) || ''));
}

export async function deleteRecording(id) {
  await removeRecording(id);
}

// Load a card's media on demand (byte-backed WebKit records list blob-less).
// Returns the Blob or null when the media is genuinely gone.
export async function loadRecordingBlob(card) {
  if (card?.blob) return card.blob;
  return ensureRecordingBlob(card);
}

// Batch delete in one IndexedDB transaction (multi-select "Delete").
export async function deleteRecordings(ids = []) {
  await removeRecordings(ids);
}

// ---- Local storage budget -------------------------------------------------
// The user's chosen budget in bytes (falls back to the 2 GB default).
export function getStorageLimit() {
  return getStorageLimitBytes() || DEFAULT_STORAGE_LIMIT_BYTES;
}

// Persist a new budget (given in GB), clamped to [floor, device quota]. Returns
// the stored value in GB so the UI can echo what was actually saved.
export async function setStorageLimit(gb) {
  const estimate = await estimateStorage();
  const clamped = clampStorageLimit(gbToBytes(gb), (estimate && estimate.quota) || 0);
  setStorageLimitBytes(clamped);
  return bytesToGB(clamped);
}

// Whether new recordings are persisted to this device (master switch).
export { isRecordingSaveEnabled as getRecordingSaveEnabled };

export function setRecordingSave(enabled) {
  setRecordingSaveEnabled(enabled);
}

// Ask for persistent storage (so recordings survive disk pressure) and report
// the current budget state { level: 'none'|'warn'|'full', usedGB, limitGB, maxGB }.
// navigator.storage.estimate() scans origin usage (can take 100ms+), so the
// result is memoized briefly — view switches shouldn't re-pay it. Pass
// { fresh: true } after deletes so the numbers move.
let persistentStorageRequested = false;
let storageCheck = null; // { at, promise }
const STORAGE_CHECK_TTL_MS = 30_000;

export async function checkStorage({ fresh = false } = {}) {
  if (!persistentStorageRequested) {
    persistentStorageRequested = true;
    requestPersistentStorage();
  }
  const now = Date.now();
  if (!fresh && storageCheck && now - storageCheck.at < STORAGE_CHECK_TTL_MS) {
    return storageCheck.promise;
  }
  const promise = (async () => evaluateStorage(await estimateStorage(), getStorageLimit()))();
  storageCheck = { at: now, promise };
  return promise;
}

// ---- Script mutations -----------------------------------------------------
export function renameScript(id, title) {
  return renameWorkspace(id, title);
}

export function moveWorkspaceToFolder(id, folderId) {
  return moveWorkspace(id, folderId);
}

// Remove a workspace and cascade-delete its recordings (best-effort).
export async function deleteWorkspaceCascade(id) {
  removeWorkspace(id);
  try {
    await removeByWorkspace(id);
  } catch {
    // Recordings cleanup is best-effort — the workspace itself is already gone.
  }
}

// ---- Drag & drop ----------------------------------------------------------
// item = { type: 'script' | 'folder', id }. Can it drop into targetFolderId
// (null = root)? Rejects no-op moves and folder-into-itself/descendant.
function canMoveIntoLists(item, targetFolderId, folders, workspaces) {
  if (!item) return false;
  if (item.type === 'folder') {
    if (String(item.id) === String(targetFolderId)) return false;
    if (targetFolderId != null && isDescendantOf(folders, targetFolderId, item.id)) return false;
    const folder = folderById(folders, item.id);
    return !(folder && sameFolder(folder.parentId, targetFolderId));
  }
  const workspace = workspaces.find((w) => String(w.id) === String(item.id));
  return !(workspace && sameFolder(workspace.folderId, targetFolderId));
}

export function canMoveInto(item, targetFolderId) {
  return canMoveIntoLists(item, targetFolderId, listFolders(), listWorkspaces());
}

// Hover validation for an in-flight drag. dragover/touchmove fire at pointer
// rate; parsing the whole workspace list out of localStorage on every event
// saturates the main thread, so the lists are snapshotted once at drag start.
// The actual drop still re-validates against fresh data (moveItemInto).
export function createDragSession(item) {
  const folders = listFolders();
  const workspaces = listWorkspaces();
  return {
    item,
    canMoveInto: (targetFolderId) => canMoveIntoLists(item, targetFolderId, folders, workspaces),
  };
}

export function moveItemInto(item, targetFolderId) {
  if (!canMoveInto(item, targetFolderId)) return false;
  if (item.type === 'folder') {
    const folders = listFolders();
    const folder = folderById(folders, item.id);
    if (folder) {
      updateFolder(item.id, {
        parentId: targetFolderId ?? null,
        name: uniqueFolderName(folders, folder.name, targetFolderId, folder.id),
      });
    }
  } else {
    moveWorkspace(item.id, targetFolderId);
  }
  return true;
}
