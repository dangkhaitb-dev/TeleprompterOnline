// storage-warning-prefs.js — user preference for storage warnings (on/off).
// Stored in localStorage so it persists across sessions globally (not per-script).
// Defaults to ON — users must explicitly opt out.

import { getItem, setItem } from '../utils/storage.js';
import { LS_STORAGE_WARNING } from '../utils/storage-keys.js';

/**
 * Returns true if storage warnings are enabled (default: true).
 * @returns {boolean}
 */
export function isStorageWarningEnabled() {
  const value = getItem(LS_STORAGE_WARNING);
  return value === null ? true : value !== false;
}

/**
 * Persist the user's preference.
 * @param {boolean} enabled
 */
export function setStorageWarningEnabled(enabled) {
  setItem(LS_STORAGE_WARNING, !!enabled);
}
