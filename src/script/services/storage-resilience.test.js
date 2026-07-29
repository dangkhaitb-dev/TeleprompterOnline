import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
} from './workspaces.store.js';
import {
  createFolder,
  listFolders,
  updateFolder,
} from './folders.store.js';
import {
  getStorageLimitBytes,
  isRecordingSaveEnabled,
} from './recording-prefs.store.js';
import { isStorageWarningEnabled } from './storage-warning-prefs.store.js';
import { getCachedAuthState } from '../libs/firebase/auth-cache.js';
import {
  LS_AUTH_STATE,
  LS_FOLDERS,
  LS_STORAGE_WARNING,
  LS_WORKSPACES,
  LS_WS_SAVE_RECORDINGS,
  LS_WS_STORAGE_LIMIT,
} from '../utils/storage-keys.js';
import { normalizeHexColor, normalizeSettings } from '../features/teleprompter/teleprompter.model.js';

let values;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function storeRaw(key, value) {
  values.set(key, typeof value === 'string' ? value : JSON.stringify(value));
}

describe('localStorage resilience', () => {
  it('keeps working when the browser blocks reads and writes entirely', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); },
      removeItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
    });

    expect(listWorkspaces()).toEqual([]);
    expect(listFolders()).toEqual([]);
    expect(() => createWorkspace({ title: 'Ephemeral fallback' })).not.toThrow();
    expect(() => createFolder({ name: 'Ephemeral folder' })).not.toThrow();
    expect(isRecordingSaveEnabled()).toBe(true);
    expect(isStorageWarningEnabled()).toBe(true);
  });

  it('falls back to an empty workspace library when JSON is unreadable', () => {
    storeRaw(LS_WORKSPACES, '{broken json');

    expect(listWorkspaces()).toEqual([]);
    expect(() => createWorkspace({ title: 'Recovered' })).not.toThrow();
    expect(listWorkspaces()).toHaveLength(1);
  });

  it('keeps usable workspaces while dropping or defaulting corrupt entries', () => {
    storeRaw(LS_WORKSPACES, [
      null,
      'not-a-workspace',
      { title: 'missing id' },
      {
        id: 'kept',
        title: { bad: true },
        scriptText: 42,
        scriptHtml: null,
        folderId: { bad: true },
        settings: ['bad'],
        createdAt: 'yesterday',
        updatedAt: Number.POSITIVE_INFINITY,
      },
      { id: 'kept', title: 'duplicate id' },
    ]);

    expect(listWorkspaces()).toEqual([{
      id: 'kept',
      title: 'Untitled script',
      scriptText: '',
      scriptHtml: '',
      folderId: null,
      settings: {},
      createdAt: 0,
      updatedAt: 0,
    }]);
    expect(getWorkspace('kept')?.id).toBe('kept');
    expect(() => updateWorkspace('kept', null)).not.toThrow();
  });

  it('keeps usable folders and supplies safe names and parents', () => {
    storeRaw(LS_FOLDERS, [
      null,
      { id: 'folder-a', name: { bad: true }, parentId: { bad: true } },
      { id: 'folder-a', name: 'duplicate id' },
    ]);

    expect(listFolders()).toEqual([{
      id: 'folder-a',
      name: 'New Folder',
      parentId: null,
      createdAt: 0,
      updatedAt: 0,
    }]);
    expect(() => updateFolder('folder-a', null)).not.toThrow();
    expect(() => createFolder({ name: null })).not.toThrow();
  });

  it('uses defaults for invalid boolean and numeric preferences', () => {
    values.set(LS_WS_SAVE_RECORDINGS, JSON.stringify('false'));
    storeRaw(LS_STORAGE_WARNING, { enabled: false });
    storeRaw(LS_WS_STORAGE_LIMIT, -50);

    expect(isRecordingSaveEnabled()).toBe(true);
    expect(isStorageWarningEnabled()).toBe(true);
    expect(getStorageLimitBytes()).toBeNull();
  });

  it('rejects malformed cached auth state instead of leaking it to callers', () => {
    storeRaw(LS_AUTH_STATE, { uid: 12, isAnonymous: 'yes' });
    expect(getCachedAuthState()).toBeNull();

    storeRaw(LS_AUTH_STATE, {
      uid: 'user-1',
      isAnonymous: 1,
      email: 42,
      displayName: 'User',
    });
    expect(getCachedAuthState()).toEqual({
      uid: 'user-1',
      isAnonymous: true,
      email: null,
      displayName: 'User',
      photoURL: null,
    });
  });

  it('normalizes malformed settings and color values without throwing', () => {
    expect(normalizeSettings(['bad'])).toMatchObject({
      scrollMode: 'wpm',
      color: '',
      fontSize: '',
      lineHeight: '1.25',
    });
    expect(normalizeSettings({
      color: { bad: true },
      fontSize: { bad: true },
      lineHeight: { bad: true },
    })).toMatchObject({
      color: '',
      fontSize: '',
      lineHeight: '1.25',
    });
    expect(normalizeHexColor({ bad: true })).toBeNull();
  });
});
