import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncOPFSWriter } from './opfs-sync-writer.js';

// Scripted stand-in for the OPFS worker: replies to the writer protocol on a
// microtask, like a real worker would. `respond` overrides individual replies.
class FakeWorker {
  static instance = null;
  static respond = null;

  constructor() {
    this.listeners = new Map();
    this.posted = [];
    this.terminated = false;
    FakeWorker.instance = this;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  postMessage(message) {
    this.posted.push(message);
    queueMicrotask(() => {
      if (this.terminated) return;
      const scripted = FakeWorker.respond?.(message);
      if (scripted === false) return;
      const reply = scripted || { id: message.id, ok: true, bytes: message.chunk?.size ?? 0 };
      this.emit('message', reply);
    });
  }

  emit(type, data) {
    for (const callback of this.listeners.get(type) || []) callback({ data });
  }

  terminate() { this.terminated = true; }
}

function installEnv({ getFile } = {}) {
  const fileHandle = {
    getFile: getFile || vi.fn(async () => ({ name: 'rec.webm', type: '' })),
  };
  const root = {
    getFileHandle: vi.fn(async () => fileHandle),
    removeEntry: vi.fn(async () => {}),
  };
  let lockRequestCompletion;
  let lockReleased = false;
  const locks = {
    request: vi.fn((_name, callback) => {
      lockRequestCompletion = Promise.resolve(callback({ mode: 'exclusive' }))
        .then(() => { lockReleased = true; });
      return lockRequestCompletion;
    }),
  };
  vi.stubGlobal('navigator', {
    locks,
    storage: { getDirectory: vi.fn(async () => root) },
  });
  vi.stubGlobal('Worker', FakeWorker);
  return {
    fileHandle,
    root,
    get lockRequestCompletion() { return lockRequestCompletion; },
    get lockReleased() { return lockReleased; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instance = null;
  FakeWorker.respond = null;
});

describe('SyncOPFSWriter worker protocol', () => {
  it('opens the file in the worker and streams chunks in arrival order', async () => {
    installEnv();
    const writer = await SyncOPFSWriter.create('rec-sync.webm');

    await Promise.all([
      writer.write(new Blob(['abc'])),
      writer.write(new Blob(['de'])),
    ]);

    const types = FakeWorker.instance.posted.map((message) => message.type);
    expect(types).toEqual(['open', 'write', 'write']);
    expect(FakeWorker.instance.posted[0].filename).toBe('rec-sync.webm');
    expect(writer.bytesWritten).toBe(5);
  });

  it('closes the sync handle before reading the finished file', async () => {
    const fixture = installEnv();
    const writer = await SyncOPFSWriter.create('rec-finish.webm');

    fixture.root.getFileHandle.mockImplementation(async () => {
      // getFile() must not race the worker's exclusive sync-handle lock.
      expect(FakeWorker.instance.posted.some((m) => m.type === 'close')).toBe(true);
      return fixture.fileHandle;
    });
    const file = await writer.finish();

    expect(file.name).toBe('rec.webm');
    expect(FakeWorker.instance.terminated).toBe(true);
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('can retain the lock after finish until the artifact is deleted', async () => {
    const fixture = installEnv();
    const writer = await SyncOPFSWriter.create('zip-retained.tmp');

    await writer.finish('', { keepLock: true });
    expect(fixture.lockReleased).toBe(false);

    await writer.abort();
    expect(fixture.root.removeEntry).toHaveBeenCalledWith('zip-retained.tmp');
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('deletes the temp file and releases the lock on abort', async () => {
    const fixture = installEnv();
    const writer = await SyncOPFSWriter.create('rec-abort.webm');

    await writer.abort();

    expect(FakeWorker.instance.posted.map((m) => m.type)).toEqual(['open', 'close']);
    expect(fixture.root.removeEntry).toHaveBeenCalledWith('rec-abort.webm');
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('releases the lock and terminates the worker when open fails', async () => {
    const fixture = installEnv();
    FakeWorker.respond = (message) => message.type === 'open'
      && { id: message.id, ok: false, name: 'NotSupportedError', message: 'no sync handle' };

    await expect(SyncOPFSWriter.create('rec-old-ios.webm'))
      .rejects.toMatchObject({ name: 'NotSupportedError' });
    expect(FakeWorker.instance.terminated).toBe(true);
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('rejects finish instead of hanging after the worker crashes', async () => {
    const fixture = installEnv();
    const writer = await SyncOPFSWriter.create('rec-crash.webm');

    FakeWorker.instance.emit('error', new Error('worker blew up'));

    await expect(writer.finish()).rejects.toThrow('OPFS worker terminated');
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('propagates a write failure with its DOMException name', async () => {
    installEnv();
    const writer = await SyncOPFSWriter.create('rec-full.webm');
    FakeWorker.respond = (message) => message.type === 'write'
      && { id: message.id, ok: false, name: 'QuotaExceededError', message: 'disk full' };

    await expect(writer.write(new Blob(['x'])))
      .rejects.toMatchObject({ name: 'QuotaExceededError', message: 'disk full' });
  });

  it('rejects instead of hanging when the iOS worker stays silent', async () => {
    vi.useFakeTimers();
    try {
      installEnv();
      const writer = await SyncOPFSWriter.create('rec-silent.webm');
      FakeWorker.respond = (message) => message.type === 'write' ? false : null;

      const write = writer.write(new Blob(['x']));
      const rejection = expect(write).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(60_000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
