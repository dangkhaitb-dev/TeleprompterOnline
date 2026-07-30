// OPFS streaming path of createRecordingController: lock lifetime around the
// IndexedDB hand-off, discard-on-write-failure semantics, and the RAM fallback.
// (teleprompter.logic.test.js mocks OPFS as unsupported, so the path lives here.)
import { afterEach, describe, expect, it, vi } from 'vitest';

const recordings = vi.hoisted(() => ({
  putRecording: vi.fn(),
  listAllRecordings: vi.fn(),
  removeRecordings: vi.fn(),
}));
const prefs = vi.hoisted(() => ({
  isRecordingSaveEnabled: vi.fn(() => true),
}));
const media = vi.hoisted(() => ({
  getCaptureStream: vi.fn(),
  stopStream: vi.fn(),
  validateRecordedMediaBlob: vi.fn(async () => ({ valid: true })),
}));
const opfs = vi.hoisted(() => ({
  writer: null,
  createError: null,
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
  pickRecorderMimeType: ({ video }) => (video ? 'video/webm' : 'audio/webm'),
  recorderTimesliceForMimeType: () => 250,
  validateRecordedMediaBlob: media.validateRecordedMediaBlob,
}));
vi.mock('../../utils/opfs-writer.js', () => ({
  isOPFSSupported: () => true,
  createOPFSWriter: vi.fn(async (filename) => {
    if (opfs.createError) throw opfs.createError;
    opfs.writer = {
      filename,
      write: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue(new Blob(['opfs bytes'], { type: 'audio/webm' })),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    return opfs.writer;
  }),
}));

import { createRecordingController } from './teleprompter.logic.js';

class FakeMediaRecorder {
  static instance;

  static isTypeSupported() {
    return true;
  }

  constructor(_stream, options = {}) {
    this.state = 'inactive';
    this.mimeType = options.mimeType || 'audio/webm';
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
  opfs.writer = null;
  opfs.createError = null;
  media.validateRecordedMediaBlob.mockResolvedValue({ valid: true });
});

async function startRecording(onError) {
  media.getCaptureStream.mockResolvedValue({ getVideoTracks: () => [] });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  const controller = createRecordingController(onError ? { onError } : undefined);
  await controller.start({ wantsVideo: false, wantsAudio: true });
  return controller;
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createRecordingController OPFS streaming path', () => {
  it('keeps the OPFS temp file locked until IndexedDB owns the bytes', async () => {
    const controller = await startRecording();
    recordings.putRecording.mockImplementation(async (record) => {
      // The vp:rec: lock (and its file) must survive while bytes are copied —
      // startup GC in another tab would otherwise delete the file mid-copy.
      expect(opfs.writer.abort).not.toHaveBeenCalled();
      return { ...record, id: 'stored' };
    });
    FakeMediaRecorder.instance.emit('dataavailable', {
      data: new Blob(['chunk'], { type: 'audio/webm' }),
    });

    const saved = await controller.stop({ workspaceId: 'ws-1' });

    expect(saved.id).toBe('stored');
    expect(opfs.writer.finish).toHaveBeenCalledWith('audio/webm', { keepLock: true });
    // After the save, abort() deletes the temp file and releases the lock.
    expect(opfs.writer.abort).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe('idle');
  });

  it('still deletes the OPFS temp file when IndexedDB persistence fails', async () => {
    const onError = vi.fn();
    const controller = await startRecording(onError);
    recordings.putRecording.mockRejectedValue(new Error('quota exceeded'));

    const saved = await controller.stop({ workspaceId: 'ws-1' });

    expect(saved).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'quota exceeded' }));
    expect(opfs.writer.abort).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe('idle');
  });

  it('discards the recording when the OPFS file cannot be finalized', async () => {
    const onError = vi.fn();
    const controller = await startRecording(onError);
    opfs.writer.finish.mockRejectedValue(new Error('disk full'));

    const saved = await controller.stop({ workspaceId: 'ws-1' });

    expect(saved).toBeNull();
    expect(recordings.putRecording).not.toHaveBeenCalled();
    expect(opfs.writer.abort).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
    expect(controller.getState()).toBe('idle');
  });

  it('surfaces a mid-recording write failure immediately and stops writing', async () => {
    const onError = vi.fn();
    const controller = await startRecording(onError);
    opfs.writer.write.mockRejectedValue(new Error('disk full'));

    FakeMediaRecorder.instance.emit('dataavailable', { data: new Blob(['x']) });
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
    // Later chunks are neither written nor buffered — a suffix without the
    // stream header is unplayable, so collecting it would be pointless.
    FakeMediaRecorder.instance.emit('dataavailable', { data: new Blob(['y']) });
    expect(opfs.writer.write).toHaveBeenCalledTimes(1);
    controller.cancel();
    expect(opfs.writer.abort).toHaveBeenCalled();
  });

  it('falls back to in-RAM chunks when the OPFS writer cannot be created', async () => {
    opfs.createError = new Error('opfs unavailable');
    const controller = await startRecording();
    recordings.putRecording.mockImplementation(async (record) => ({ ...record, id: 'ram' }));

    FakeMediaRecorder.instance.emit('dataavailable', {
      data: new Blob(['ram bytes'], { type: 'audio/webm' }),
    });
    const saved = await controller.stop({ workspaceId: 'ws-1' });

    expect(saved.id).toBe('ram');
    expect(recordings.putRecording).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      temporary: false,
    }));
  });
});
