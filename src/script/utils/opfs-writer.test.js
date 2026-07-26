import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPFSWriter, createOPFSWriter } from './opfs-writer.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installOpfs({ writable = {}, getFile } = {}) {
  const stream = {
    write: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...writable,
  };
  const fileHandle = {
    createWritable: vi.fn(async () => stream),
    getFile: getFile || vi.fn(async () => ({ name: 'recording.webm' })),
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
  return {
    stream,
    fileHandle,
    root,
    locks,
    get lockRequestCompletion() { return lockRequestCompletion; },
    get lockReleased() { return lockReleased; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OPFSWriter lock lifecycle', () => {
  it('serializes concurrent MediaRecorder chunks in arrival order', async () => {
    const firstWrite = deferred();
    const fixture = installOpfs({
      writable: {
        write: vi.fn((chunk) => chunk === 'first' ? firstWrite.promise : Promise.resolve()),
      },
    });
    const writer = await OPFSWriter.create('rec-order.webm');

    const first = writer.write('first');
    const second = writer.write('second');
    await vi.waitFor(() => expect(fixture.stream.write).toHaveBeenCalledTimes(1));
    expect(fixture.stream.write).toHaveBeenNthCalledWith(1, 'first');

    firstWrite.resolve();
    await Promise.all([first, second]);
    expect(fixture.stream.write).toHaveBeenNthCalledWith(2, 'second');
  });

  it('holds the file lock until close and getFile have completed', async () => {
    const fileReady = deferred();
    const fixture = installOpfs({ getFile: vi.fn(() => fileReady.promise) });
    const writer = await OPFSWriter.create('rec-finish.webm');

    const finishing = writer.finish();
    await vi.waitFor(() => expect(fixture.fileHandle.getFile).toHaveBeenCalledOnce());
    expect(fixture.lockReleased).toBe(false);

    const file = { name: 'rec-finish.webm' };
    fileReady.resolve(file);
    await expect(finishing).resolves.toBe(file);
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('can retain the lock after finish until the artifact is deleted', async () => {
    const fixture = installOpfs();
    const writer = await OPFSWriter.create('zip-retained.tmp');

    await writer.finish('', { keepLock: true });
    expect(fixture.lockReleased).toBe(false);

    await writer.abort();
    expect(fixture.root.removeEntry).toHaveBeenCalledWith('zip-retained.tmp');
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('deletes an aborted file before releasing its lock', async () => {
    const fixture = installOpfs();
    fixture.root.removeEntry.mockImplementation(async () => {
      expect(fixture.lockReleased).toBe(false);
    });
    const writer = await OPFSWriter.create('rec-abort.webm');

    await writer.abort();
    expect(fixture.root.removeEntry).toHaveBeenCalledWith('rec-abort.webm');
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('releases the lock even when finalizing the file fails', async () => {
    const fixture = installOpfs({
      writable: { close: vi.fn(async () => { throw new Error('disk failure'); }) },
    });
    const writer = await OPFSWriter.create('rec-fail.webm');

    await expect(writer.finish()).rejects.toThrow('disk failure');
    await fixture.lockRequestCompletion;
    expect(fixture.lockReleased).toBe(true);
  });

  it('rejects promptly when Web Locks rejects instead of hanging', async () => {
    const getDirectory = vi.fn();
    vi.stubGlobal('navigator', {
      storage: { getDirectory },
      locks: { request: vi.fn(() => Promise.reject(new Error('lock unavailable'))) },
    });

    await expect(OPFSWriter.create('rec-rejected.webm')).rejects.toThrow('lock unavailable');
    expect(getDirectory).not.toHaveBeenCalled();
  });
});

// Minimal worker stand-in: acks every message so SyncOPFSWriter.create resolves.
class StubWorker {
  static created = 0;

  constructor() {
    StubWorker.created += 1;
    this.listeners = [];
  }

  addEventListener(type, callback) {
    if (type === 'message') this.listeners.push(callback);
  }

  postMessage(message) {
    queueMicrotask(() => {
      this.listeners.forEach((callback) => callback({ data: { id: message.id, ok: true } }));
    });
  }

  terminate() {}
}

describe('createOPFSWriter path selection', () => {
  it('uses the main-thread writer when createWritable exists', async () => {
    const fixture = installOpfs();
    vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
    vi.stubGlobal('Worker', StubWorker);
    StubWorker.created = 0;

    const writer = await createOPFSWriter('rec-main.webm');

    expect(fixture.fileHandle.createWritable).toHaveBeenCalledOnce();
    expect(StubWorker.created).toBe(0);
    await writer.abort();
  });

  it('falls back to the worker writer when createWritable is missing', async () => {
    const fixture = installOpfs();
    // No FileSystemFileHandle global (WebKit 15.2–25 shape in this env).
    vi.stubGlobal('Worker', StubWorker);
    StubWorker.created = 0;

    const writer = await createOPFSWriter('rec-sync.webm');

    expect(StubWorker.created).toBe(1);
    expect(fixture.fileHandle.createWritable).not.toHaveBeenCalled();
    expect(writer.filename).toBe('rec-sync.webm');
    await writer.abort();
  });
});
