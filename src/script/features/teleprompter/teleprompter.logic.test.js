import { afterEach, describe, expect, it, vi } from 'vitest';

const recordings = vi.hoisted(() => ({
  putRecording: vi.fn(),
  listAllRecordings: vi.fn(),
  removeRecordings: vi.fn(),
}));
const prefs = vi.hoisted(() => ({
  enabled: true,
  isRecordingSaveEnabled: vi.fn(),
}));
const media = vi.hoisted(() => ({
  getCaptureStream: vi.fn(),
  stopStream: vi.fn(),
}));

vi.mock('../../services/recordings.store.js', () => ({
  putRecording: recordings.putRecording,
  listAllRecordings: recordings.listAllRecordings,
  removeRecordings: recordings.removeRecordings,
}));
vi.mock('../../services/recording-prefs.store.js', () => ({
  isRecordingSaveEnabled: prefs.isRecordingSaveEnabled,
}));
vi.mock('../../utils/media.js', () => ({
  getCaptureStream: media.getCaptureStream,
  stopStream: media.stopStream,
  pickRecorderMimeType: ({ video }) => video ? 'video/webm' : 'audio/webm',
}));
vi.mock('../../utils/opfs-writer.js', () => ({
  isOPFSSupported: () => false,
  createOPFSWriter: vi.fn(),
}));

import {
  createRecordingController,
  indexedDbGarbageCollect,
  resolveInitialSettings,
  saveWorkspaceSettings,
} from './teleprompter.logic.js';
import { createWorkspace, getWorkspace } from '../../services/workspaces.store.js';
import { LS_GLOBAL_SETTING_PROMPTER } from '../../utils/storage-keys.js';
import { getItem, setItem } from '../../utils/storage.js';

class FakeMediaRecorder {
  static instance;

  static isTypeSupported() {
    return true;
  }

  constructor(_stream, options = {}) {
    this.state = 'inactive';
    this.mimeType = options.mimeType || 'audio/webm';
    this.videoBitsPerSecond = options.videoBitsPerSecond;
    this.listeners = new Map();
    FakeMediaRecorder.instance = this;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    queueMicrotask(() => this.emit('stop'));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  prefs.enabled = true;
});

function stubLocalStorage() {
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  });
}

describe('workspace setting inheritance', () => {
  it('keeps untouched global defaults on a new script first setting change', () => {
    stubLocalStorage();
    const globalSettings = {
      wpm: 180,
      scrollMode: 'wpm',
      scrollDurationSeconds: 60,
      mirror: true,
      pageTheme: 'light',
      panelTheme: 'light-60',
      countdown: false,
      notchFullscreen: false,
      align: 'right',
      promptMarginRatio: 0.2,
      panelMarginRatio: 0.12,
      eyeLineRatio: 0.4,
      eyeLineVisible: false,
      layoutGuides: true,
      fontSize: '',
      color: '',
      bold: false,
      italic: false,
      underline: false,
    };
    setItem(LS_GLOBAL_SETTING_PROMPTER, globalSettings);
    const workspace = createWorkspace({ title: 'New script' });

    expect(resolveInitialSettings(workspace)).toEqual(globalSettings);
    saveWorkspaceSettings(workspace.id, { align: 'center' });

    expect(getWorkspace(workspace.id).settings).toEqual({
      ...globalSettings,
      align: 'center',
    });
    expect(getItem(LS_GLOBAL_SETTING_PROMPTER)).toEqual({
      ...globalSettings,
      align: 'center',
    });
  });

  it('resets text color to theme-driven ("") for a new script, inheriting everything else', () => {
    stubLocalStorage();
    // The user's last-used color was an explicit yellow. A new script must NOT
    // inherit it — it starts theme-driven (dark page → white, light page → black).
    const globalSettings = {
      wpm: 180,
      scrollMode: 'wpm',
      scrollDurationSeconds: 60,
      mirror: true,
      pageTheme: 'light',
      panelTheme: 'light-60',
      countdown: false,
      notchFullscreen: false,
      align: 'right',
      promptMarginRatio: 0.2,
      panelMarginRatio: 0.12,
      eyeLineRatio: 0.4,
      eyeLineVisible: false,
      layoutGuides: true,
      fontSize: '',
      color: '#f2c94c',
      bold: false,
      italic: false,
      underline: false,
    };
    setItem(LS_GLOBAL_SETTING_PROMPTER, globalSettings);
    const workspace = createWorkspace({ title: 'New script' });

    // Everything inherited except color, which is reset to '' (auto/theme).
    expect(resolveInitialSettings(workspace)).toEqual({ ...globalSettings, color: '' });

    // A first non-color change must not silently bake the old global color back in:
    // the persisted settings keep the theme-driven '' that was shown to the user.
    saveWorkspaceSettings(workspace.id, { align: 'center' });
    expect(getWorkspace(workspace.id).settings).toEqual({
      ...globalSettings,
      color: '',
      align: 'center',
    });
  });

  it('starts a new script with underline off instead of inheriting it', () => {
    stubLocalStorage();
    setItem(LS_GLOBAL_SETTING_PROMPTER, {
      color: '#f2c94c',
      underline: true,
    });
    const workspace = createWorkspace({ title: 'New script' });

    expect(resolveInitialSettings(workspace)).toMatchObject({
      color: '',
      underline: false,
    });

    // Its first unrelated settings change must preserve the off default.
    saveWorkspaceSettings(workspace.id, { align: 'center' });
    expect(getWorkspace(workspace.id).settings.underline).toBe(false);
  });

  it('keeps a saved script\'s own color untouched', () => {
    stubLocalStorage();
    setItem(LS_GLOBAL_SETTING_PROMPTER, { color: '#ffffff' });
    const workspace = createWorkspace({ title: 'Saved script' });

    // Giving the script an explicit color makes its settings its own — from now on
    // it follows that color, not the theme default a fresh script would use.
    saveWorkspaceSettings(workspace.id, { color: '#ff0000' });

    expect(getWorkspace(workspace.id).settings.color).toBe('#ff0000');
    expect(resolveInitialSettings(getWorkspace(workspace.id)).color).toBe('#ff0000');
  });
});

describe('createRecordingController persistence tagging', () => {
  it('uses the selected camera and microphone for capture', async () => {
    const stream = {
      getVideoTracks: () => [{ kind: 'video', getSettings: () => ({ width: 1920, height: 1080 }) }],
    };
    media.getCaptureStream.mockResolvedValue(stream);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const controller = createRecordingController();

    await controller.start({
      wantsVideo: true,
      wantsAudio: true,
      videoDeviceId: 'camera-usb',
      audioDeviceId: 'mic-usb',
    });

    // The camera runs at its own default mode (no resolution/aspect constraints),
    // just the chosen device — like a normal video app.
    expect(media.getCaptureStream).toHaveBeenCalledWith({
      video: { deviceId: { exact: 'camera-usb' } },
      audio: { deviceId: { exact: 'mic-usb' } },
    });
    // Bitrate is derived from the resolution the camera actually produced.
    expect(FakeMediaRecorder.instance.videoBitsPerSecond).toBe(8_000_000);
    await controller.cancel();
  });

  it.each([
    { saveEnabled: false, expectedTemporary: true },
    { saveEnabled: true, expectedTemporary: false },
  ])('sets temporary=$expectedTemporary when saveEnabled=$saveEnabled', async ({
    saveEnabled,
    expectedTemporary,
  }) => {
    prefs.enabled = saveEnabled;
    prefs.isRecordingSaveEnabled.mockImplementation(() => prefs.enabled);
    const stream = { getVideoTracks: () => [] };
    media.getCaptureStream.mockResolvedValue(stream);
    recordings.putRecording.mockImplementation(async (record) => ({ ...record, id: 'stored' }));
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const controller = createRecordingController();

    await controller.start({ wantsVideo: false, wantsAudio: true });
    FakeMediaRecorder.instance.emit('dataavailable', {
      data: new Blob(['recorded bytes'], { type: 'audio/webm' }),
    });
    const saved = await controller.stop({ workspaceId: 'workspace-a' });

    expect(saved.id).toBe('stored');
    expect(recordings.putRecording).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-a',
      temporary: expectedTemporary,
    }));
    expect(media.stopStream).toHaveBeenCalledWith(stream);
  });

  it('persists with a single putRecording call — the WebKit bytes fallback lives in the store', async () => {
    prefs.isRecordingSaveEnabled.mockReturnValue(true);
    media.getCaptureStream.mockResolvedValue({ getVideoTracks: () => [] });
    recordings.putRecording.mockImplementation(async (record) => ({ ...record, id: 'stored' }));
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const onError = vi.fn();
    const controller = createRecordingController({ onError });

    await controller.start();
    FakeMediaRecorder.instance.emit('dataavailable', {
      data: new Blob(['recorded bytes'], { type: 'audio/webm' }),
    });
    const saved = await controller.stop({ workspaceId: 'workspace-a' });

    expect(saved.id).toBe('stored');
    expect(onError).not.toHaveBeenCalled();
    // No logic-layer retry/flatten: one call, the original blob untouched —
    // recordings.store owns the WebKit "Error preparing Blob/File" fallback.
    expect(recordings.putRecording).toHaveBeenCalledTimes(1);
    const blob = recordings.putRecording.mock.calls[0][0].blob;
    expect(blob.type).toBe('audio/webm');
    await expect(blob.text()).resolves.toBe('recorded bytes');
  });

  it('returns null and reports an IndexedDB persistence failure', async () => {
    prefs.isRecordingSaveEnabled.mockReturnValue(false);
    media.getCaptureStream.mockResolvedValue({ getVideoTracks: () => [] });
    recordings.putRecording.mockRejectedValue(new Error('quota exceeded'));
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const onError = vi.fn();
    const controller = createRecordingController({ onError });

    await controller.start();
    const saved = await controller.stop({ workspaceId: 'workspace-a' });

    expect(saved).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'quota exceeded' }));
    expect(controller.getState()).toBe('idle');
  });
});

describe('indexedDbGarbageCollect', () => {
  it('deletes only temporary ids for workspaces without a live session', async () => {
    recordings.listAllRecordings.mockResolvedValue([
      { id: 'temp-a', workspaceId: 'a', temporary: true },
      { id: 'saved-a', workspaceId: 'a', temporary: false },
      { id: 'temp-b', workspaceId: 'b', temporary: true },
    ]);
    recordings.removeRecordings.mockResolvedValue(1);
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn((name, _options, callback) =>
          Promise.resolve(callback(name === 'vp:ws:a' ? {} : null))),
      },
    });

    await expect(indexedDbGarbageCollect()).resolves.toBe(1);
    expect(recordings.removeRecordings).toHaveBeenCalledOnce();
    expect(recordings.removeRecordings).toHaveBeenCalledWith(['temp-a']);
  });

  it('cleans every inactive workspace and counts all deleted temporary ids', async () => {
    recordings.listAllRecordings.mockResolvedValue([
      { id: 'a-1', workspaceId: 'a', temporary: true },
      { id: 'a-2', workspaceId: 'a', temporary: true },
      { id: 'b-1', workspaceId: 'b', temporary: true },
    ]);
    recordings.removeRecordings.mockResolvedValue(undefined);
    const request = vi.fn((_name, options, callback) => {
      expect(options).toEqual({ ifAvailable: true });
      return Promise.resolve(callback({ mode: 'exclusive' }));
    });
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(indexedDbGarbageCollect()).resolves.toBe(3);
    expect(recordings.removeRecordings).toHaveBeenNthCalledWith(1, ['a-1', 'a-2']);
    expect(recordings.removeRecordings).toHaveBeenNthCalledWith(2, ['b-1']);
  });

  it('does not request locks when there are no temporary recordings', async () => {
    recordings.listAllRecordings.mockResolvedValue([
      { id: 'saved-a', workspaceId: 'a', temporary: false },
    ]);
    const request = vi.fn();
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(indexedDbGarbageCollect()).resolves.toBe(0);
    expect(request).not.toHaveBeenCalled();
    expect(recordings.removeRecordings).not.toHaveBeenCalled();
  });

  it('ignores malformed temporary records without a workspace id', async () => {
    recordings.listAllRecordings.mockResolvedValue([
      { id: 'orphan-null', workspaceId: null, temporary: true },
      { id: 'orphan-empty', workspaceId: '', temporary: true },
    ]);
    const request = vi.fn();
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(indexedDbGarbageCollect()).resolves.toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it('handles workspace ids that match Object prototype keys', async () => {
    recordings.listAllRecordings.mockResolvedValue([
      { id: 'edge-id', workspaceId: '__proto__', temporary: true },
    ]);
    recordings.removeRecordings.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn((_name, _options, callback) => Promise.resolve(callback({}))) },
    });

    await expect(indexedDbGarbageCollect()).resolves.toBe(1);
    expect(recordings.removeRecordings).toHaveBeenCalledWith(['edge-id']);
  });

  it('keeps temporary recordings when Web Locks is unavailable', async () => {
    recordings.listAllRecordings.mockResolvedValue([
      { id: 'temp-a', workspaceId: 'a', temporary: true },
    ]);
    vi.stubGlobal('navigator', {});

    await expect(indexedDbGarbageCollect()).resolves.toBe(0);
    expect(recordings.removeRecordings).not.toHaveBeenCalled();
  });

  it('keeps data if a lock request fails', async () => {
    recordings.listAllRecordings.mockResolvedValue([
      { id: 'temp-a', workspaceId: 'a', temporary: true },
    ]);
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn(() => Promise.reject(new Error('lock service failed'))) },
    });

    await expect(indexedDbGarbageCollect()).resolves.toBe(0);
    expect(recordings.removeRecordings).not.toHaveBeenCalled();
  });

  it('continues with other workspaces if one deletion fails', async () => {
    recordings.listAllRecordings.mockResolvedValue([
      { id: 'temp-a', workspaceId: 'a', temporary: true },
      { id: 'temp-b', workspaceId: 'b', temporary: true },
    ]);
    recordings.removeRecordings
      .mockRejectedValueOnce(new Error('IndexedDB transaction failed'))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn((_name, _options, callback) => Promise.resolve(callback({}))) },
    });

    await expect(indexedDbGarbageCollect()).resolves.toBe(1);
    expect(recordings.removeRecordings).toHaveBeenCalledTimes(2);
  });

  it('fails closed if IndexedDB scanning fails', async () => {
    recordings.listAllRecordings.mockRejectedValue(new Error('IndexedDB unavailable'));
    vi.stubGlobal('navigator', { locks: { request: vi.fn() } });

    await expect(indexedDbGarbageCollect()).resolves.toBe(0);
    expect(recordings.removeRecordings).not.toHaveBeenCalled();
  });
});
