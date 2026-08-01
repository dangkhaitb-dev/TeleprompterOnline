// opfs-writer.js — Origin Private File System streaming writer.
//
// Instead of accumulating MediaRecorder chunks in a JS array (RAM), each chunk
// is written directly to an OPFS file as it arrives. On stop(), the file handle
// is returned so the caller can read it back as a File/Blob for IndexedDB.
//
// Browser support (no permission prompt required):
//   createWritable (this class): Chrome ≥ 86, Firefox ≥ 111, Safari ≥ 26.
//   WebKit 15.2–25 exposes OPFS without createWritable — createOPFSWriter()
//   routes those to the worker-backed SyncOPFSWriter (same interface).
//
import { OPFS_OPERATION_TIMEOUT_MS } from '../constants/media.js';

function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(
      new Error(`OPFS operation timed out: ${label}`),
      { name: 'TimeoutError' },
    )), OPFS_OPERATION_TIMEOUT_MS);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

// Usage:
//   const writer = await createOPFSWriter('rec-abc123.part');
//   // writer.write(blob) for each dataavailable chunk
//   const file = await writer.finish();   // returns a File object
//   await writer.abort();                 // discard without saving

export function isOPFSSupported() {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage !== 'undefined' &&
      typeof navigator.storage.getDirectory === 'function'
    );
  } catch {
    return false;
  }
}

// Cross-tab Web Lock for an OPFS temp file — while held, startup GC in another
// tab must not delete it. Resolves to a release function (null without Locks API).
export async function acquireFileLock(filename) {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;
  let release = null;
  let timedOut = false;
  let releaseHeldLock = null;
  const pending = new Promise((resolve, reject) => {
    navigator.locks.request(`vp:rec:${filename}`, async (_lock) => {
      if (timedOut) return;
      resolve();
      return new Promise((resolveRelease) => {
        release = resolveRelease;
        releaseHeldLock = resolveRelease;
      });
    }).catch(reject);
  });
  try {
    await withTimeout(pending, 'acquire file lock');
  } catch (error) {
    timedOut = true;
    releaseHeldLock?.();
    throw error;
  }
  return release;
}

export class OPFSWriter {
  /** @type {FileSystemFileHandle} */
  #fileHandle = null;

  /** @type {FileSystemWritableFileStream} */
  #writable = null;

  /** @type {string} */
  #filename = '';

  /** @type {number} */
  #bytesWritten = 0;

  /** @type {boolean} */
  #finished = false;

  /** @type {Function} */
  #releaseLock = null;

  /** @type {Promise<void>} */
  #writeChain = Promise.resolve();

  // Private constructor — use OPFSWriter.create() instead.
  constructor() {}

  /**
   * Create and open an OPFS writer for the given filename.
   * Throws if OPFS is not supported or the file can't be opened.
   * @param {string} filename
   * @returns {Promise<OPFSWriter>}
   */
  static async create(filename) {
    if (!isOPFSSupported()) {
      throw new Error('OPFS not supported in this browser');
    }
    const instance = new OPFSWriter();
    instance.#filename = filename;

    // Acquire lock across tabs to prevent other tabs running GC from deleting this active file.
    instance.#releaseLock = await acquireFileLock(filename);

    try {
      const root = await withTimeout(navigator.storage.getDirectory(), 'get directory');
      instance.#fileHandle = await withTimeout(
        root.getFileHandle(filename, { create: true }),
        'open file',
      );
      instance.#writable = await withTimeout(instance.#fileHandle.createWritable(), 'create writable');
    } catch (err) {
      if (instance.#releaseLock) instance.#releaseLock();
      throw err;
    }
    return instance;
  }

  /**
   * Append a Blob/ArrayBuffer chunk to the file.
   * Should be called from the MediaRecorder `dataavailable` handler.
   * @param {Blob|ArrayBuffer} chunk
   */
  async write(chunk) {
    if (this.#finished || !this.#writable) return;
    const write = this.#writeChain.then(async () => {
      await withTimeout(this.#writable.write(chunk), 'write chunk');
      this.#bytesWritten += chunk instanceof Blob ? chunk.size : chunk.byteLength;
    });
    this.#writeChain = write;
    return write;
  }

  /**
   * Close the stream and return the written data as a File object.
   * After calling this, the writer is no longer usable.
   * @param {string} [mimeType]
   * @param {{ keepLock?: boolean }} [options]
   * @returns {Promise<File>}
   */
  async finish(mimeType = '', { keepLock = false } = {}) {
    if (this.#finished) throw new Error('OPFSWriter already finished');
    this.#finished = true;
    let succeeded = false;
    try {
      await withTimeout(this.#writeChain, 'write queue');
      if (this.#writable) {
        await withTimeout(this.#writable.close(), 'close writable');
        this.#writable = null;
      }
      const file = await withTimeout(this.#fileHandle.getFile(), 'read finished file');
      // Return a File with the correct MIME type (OPFS files have no inherent type).
      if (mimeType && file.type !== mimeType) {
        succeeded = true;
        return new File([file], this.#filename, { type: mimeType });
      }
      succeeded = true;
      return file;
    } finally {
      // ZIP artifacts retain their lock until popup cleanup. This lets startup
      // garbage collection distinguish an active file from a crash orphan.
      if ((!keepLock || !succeeded) && this.#releaseLock) {
        this.#releaseLock();
        this.#releaseLock = null;
      }
    }
  }

  /**
   * Discard the in-progress recording and delete the temporary file.
   * Safe to call multiple times.
   */
  async abort() {
    await withTimeout(this.#writeChain.catch(() => {}), 'abort write queue').catch(() => {});
    if (this.#writable) {
      try { await withTimeout(this.#writable.close(), 'abort close writable'); } catch { /* ignore */ }
      this.#writable = null;
    }
    this.#finished = true;
    try {
      const root = await withTimeout(navigator.storage.getDirectory(), 'abort get directory');
      await withTimeout(root.removeEntry(this.#filename), 'remove temporary file');
    } catch { /* file may not exist yet */ }
    if (this.#releaseLock) {
      this.#releaseLock();
      this.#releaseLock = null;
    }
  }

  // Release the cross-tab lock without deleting the file. Used when a storage
  // operation times out after the OPFS file has already been finalized; the
  // bytes remain available for a future recovery flow.
  release() {
    if (this.#releaseLock) {
      this.#releaseLock();
      this.#releaseLock = null;
    }
  }

  /** Total bytes written so far (useful for progress / size estimates). */
  get bytesWritten() { return this.#bytesWritten; }

  /** The filename in OPFS (not user-visible). */
  get filename() { return this.#filename; }
}

// True when the async main-thread writable API exists (Chrome/Edge/Firefox,
// Safari 26+). WebKit 15.2–25 only ships worker-side sync writes.
function hasCreateWritable() {
  return typeof FileSystemFileHandle !== 'undefined'
    && typeof FileSystemFileHandle.prototype.createWritable === 'function';
}

// Open the best OPFS streaming writer for this browser: main-thread
// createWritable when available, otherwise the worker-backed sync writer.
// Dynamic import keeps worker code out of bundles that never need it.
// Throws when no path works — callers already treat that as "fall back to RAM".
export async function createOPFSWriter(filename) {
  if (!isOPFSSupported()) {
    throw new Error('OPFS not supported in this browser');
  }
  if (hasCreateWritable()) return OPFSWriter.create(filename);
  const { SyncOPFSWriter } = await import('./opfs-sync-writer.js');
  return SyncOPFSWriter.create(filename);
}
