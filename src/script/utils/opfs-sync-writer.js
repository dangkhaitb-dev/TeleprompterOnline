// opfs-sync-writer.js — OPFS streaming writer for browsers without
// createWritable() (WebKit before Safari 26, i.e. iOS 15.2–25). Same interface
// as OPFSWriter, but writes go through a dedicated worker via the synchronous
// createSyncAccessHandle() API.
//
// Split of responsibilities:
//   worker — open/write/close on the sync handle (blocking I/O off-main-thread)
//   main   — Web Lock ownership, final getFile(), file deletion; lock/GC
//            semantics stay identical to OPFSWriter.

import { acquireFileLock } from './opfs-writer.js';
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

export class SyncOPFSWriter {
  /** @type {Worker} */
  #worker = null;

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

  /** @type {Map<number, {resolve: Function, reject: Function}>} */
  #pending = new Map();

  /** @type {number} */
  #requestId = 0;

  // Private constructor — use SyncOPFSWriter.create() instead.
  constructor() {}

  /**
   * Create the worker and open a sync access handle for the given filename.
   * Throws when workers/sync handles are unavailable (caller falls back to RAM).
   * @param {string} filename
   * @returns {Promise<SyncOPFSWriter>}
   */
  static async create(filename) {
    if (typeof Worker === 'undefined') {
      throw new Error('Workers unavailable');
    }
    const instance = new SyncOPFSWriter();
    instance.#filename = filename;
    instance.#releaseLock = await acquireFileLock(filename);

    try {
      instance.#worker = new Worker(
        new URL('./opfs-sync-writer.worker.js', import.meta.url),
        { type: 'module' },
      );
      instance.#worker.addEventListener('message', (event) => instance.#onMessage(event));
      instance.#worker.addEventListener('error', () => {
        // A crashed worker never replies again — kill it so later #request
        // calls reject instead of hanging (and leaking the vp:rec: lock).
        instance.#failPending(new Error('OPFS worker crashed'));
        instance.#terminateWorker();
      });
      await instance.#request({ type: 'open', filename });
    } catch (err) {
      instance.#terminateWorker();
      if (instance.#releaseLock) instance.#releaseLock();
      throw err;
    }
    return instance;
  }

  #onMessage(event) {
    const { id, ok, bytes, name, message } = event.data || {};
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    if (ok) {
      pending.resolve({ bytes });
      return;
    }
    const err = new Error(message || 'OPFS worker error');
    // Keep the original DOMException name — the record-error toast shows it.
    if (name) err.name = name;
    pending.reject(err);
  }

  #failPending(err) {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.#pending.clear();
  }

  #request(message) {
    if (!this.#worker) return Promise.reject(new Error('OPFS worker terminated'));
    return new Promise((resolve, reject) => {
      const id = ++this.#requestId;
      const timer = setTimeout(() => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        const error = Object.assign(
          new Error(`OPFS worker request timed out: ${message.type}`),
          { name: 'TimeoutError' },
        );
        reject(error);
        this.#terminateWorker();
      }, OPFS_OPERATION_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      this.#worker.postMessage({ id, ...message });
    });
  }

  #terminateWorker() {
    this.#failPending(new Error('OPFS worker terminated'));
    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
    }
  }

  /**
   * Append a Blob/ArrayBuffer chunk to the file.
   * @param {Blob|ArrayBuffer} chunk
   */
  async write(chunk) {
    if (this.#finished || !this.#worker) return;
    const write = this.#writeChain.then(async () => {
      const { bytes } = await this.#request({ type: 'write', chunk });
      this.#bytesWritten += bytes;
    });
    this.#writeChain = write;
    return write;
  }

  /**
   * Close the handle in the worker and return the written data as a File.
   * @param {string} [mimeType]
   * @param {{ keepLock?: boolean }} [options]
   * @returns {Promise<File>}
   */
  async finish(mimeType = '', { keepLock = false } = {}) {
    if (this.#finished) throw new Error('SyncOPFSWriter already finished');
    this.#finished = true;
    let succeeded = false;
    try {
      await this.#writeChain;
      // The sync handle's exclusive lock must be released before getFile().
      await this.#request({ type: 'close' });
      const root = await withTimeout(navigator.storage.getDirectory(), 'get finished directory');
      const fileHandle = await withTimeout(root.getFileHandle(this.#filename), 'open finished file');
      const file = await withTimeout(fileHandle.getFile(), 'read finished file');
      // Return a File with the correct MIME type (OPFS files have no inherent type).
      if (mimeType && file.type !== mimeType) {
        succeeded = true;
        return new File([file], this.#filename, { type: mimeType });
      }
      succeeded = true;
      return file;
    } finally {
      this.#terminateWorker();
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
    this.#finished = true;
    if (this.#worker) {
      await this.#request({ type: 'close' }).catch(() => {});
      this.#terminateWorker();
    }
    try {
      const root = await withTimeout(navigator.storage.getDirectory(), 'abort get directory');
      await withTimeout(root.removeEntry(this.#filename), 'remove temporary file');
    } catch { /* file may not exist yet */ }
    if (this.#releaseLock) {
      this.#releaseLock();
      this.#releaseLock = null;
    }
  }

  // Release the lock without deleting a completed artifact whose persistence
  // result is unknown.
  release() {
    this.#terminateWorker();
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
