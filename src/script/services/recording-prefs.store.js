// recording-prefs.store.js — persisted preferences for local recording storage,
// shared by the Workspaces settings UI and the teleprompter save path. Backed by
// localStorage through the utils/ wrapper (feature code must not touch it raw).

import { getItem, setItem } from '../utils/storage.js';
import { LS_WS_SAVE_RECORDINGS, LS_WS_STORAGE_LIMIT } from '../utils/storage-keys.js';

// Master switch for persisting recordings. Defaults ON (missing = enabled).
export function isRecordingSaveEnabled() {
  const value = getItem(LS_WS_SAVE_RECORDINGS);
  return typeof value === 'boolean' ? value : true;
}

export function setRecordingSaveEnabled(enabled) {
  setItem(LS_WS_SAVE_RECORDINGS, !!enabled);
}

// User-chosen budget in bytes, or null when unset (caller applies the default).
export function getStorageLimitBytes() {
  const value = getItem(LS_WS_STORAGE_LIMIT);
  return typeof value === 'number' && value > 0 ? value : null;
}

export function setStorageLimitBytes(bytes) {
  const value = Number(bytes);
  if (Number.isFinite(value) && value > 0) setItem(LS_WS_STORAGE_LIMIT, value);
}
