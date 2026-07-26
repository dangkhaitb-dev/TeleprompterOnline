// streaming-zip.js — create ZIP archives without buffering source files in RAM.
// Already-compressed media is stored verbatim and read one stream chunk at a
// time. When OPFS is available, ZIP output is also written to disk chunk by
// chunk so memory use stays bounded by browser stream buffers.

import { makeId } from './id.js';
import { createOPFSWriter, isOPFSSupported } from './opfs-writer.js';

// The in-memory fallback needs roughly the final ZIP size in JS-managed memory.
// Refuse oversized fallbacks instead of letting the browser kill the tab.
export const MAX_IN_MEMORY_ZIP_BYTES = 256 * 1024 * 1024;
const ZIP_TEMP_PREFIX = 'zip-';
const ZIP_TEMP_SUFFIX = '.tmp';
const ZIP_ORPHAN_MAX_AGE_WITHOUT_LOCKS_MS = 24 * 60 * 60 * 1000;

export class ZipAbortError extends Error {
  constructor() {
    super('ZIP creation cancelled');
    this.name = 'AbortError';
  }
}

export class ZipStorageError extends Error {
  constructor() {
    super('This ZIP is too large to create safely without disk-backed browser storage');
    this.name = 'ZipStorageError';
  }
}

function validEntries(entries = []) {
  return entries.filter((entry) => entry?.blob && entry?.name);
}

function archiveSize(entries) {
  return entries.reduce((sum, entry) => sum + entry.blob.size, 0);
}

async function writeZip(entries, { signal, onProgress, writeChunk }) {
  if (entries.length === 0) throw new Error('At least one file is required');
  if (signal?.aborted) throw new ZipAbortError();
  // fflate is only needed once an export actually runs — load it on demand so
  // pages that merely import this module keep it out of their initial bundle.
  const { Zip, ZipPassThrough } = await import('fflate');

  const totalBytes = archiveSize(entries);
  let processedBytes = 0;
  let zip;
  let pendingWrite = Promise.resolve();

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { zip?.terminate(); } catch { /* already finalized */ }
      reject(error);
    };
    const onAbort = () => fail(new ZipAbortError());

    signal?.addEventListener('abort', onAbort, { once: true });
    zip = new Zip((error, chunk, final) => {
      if (error) { fail(error); return; }
      pendingWrite = pendingWrite.then(() => writeChunk(chunk));
      if (!final || settled) return;
      pendingWrite.then(() => {
        if (settled) return;
        settled = true;
        cleanup();
        onProgress?.({ progress: 1, fileIndex: entries.length, fileCount: entries.length });
        resolve();
      }, fail);
    });

    (async () => {
      try {
        for (let index = 0; index < entries.length; index += 1) {
          if (signal?.aborted) throw new ZipAbortError();
          const entry = entries[index];
          const file = new ZipPassThrough(entry.name);
          zip.add(file);
          await pendingWrite;
          const reader = entry.blob.stream().getReader();

          try {
            while (true) {
              if (signal?.aborted) throw new ZipAbortError();
              const { done, value } = await reader.read();
              if (done) break;
              file.push(value);
              // Do not let fflate queue the whole archive ahead of disk writes.
              await pendingWrite;
              processedBytes += value.byteLength;
              onProgress?.({
                progress: totalBytes ? Math.min(0.99, processedBytes / totalBytes) : 0.99,
                fileIndex: index + 1,
                fileCount: entries.length,
              });
            }
            file.push(new Uint8Array(0), true);
            await pendingWrite;
          } finally {
            reader.releaseLock();
          }
        }
        zip.end();
      } catch (error) {
        fail(error);
      }
    })();
  });
}

export async function createStreamingZip(entries, { signal, onProgress } = {}) {
  const files = validEntries(entries);
  const outputChunks = [];
  await writeZip(files, {
    signal,
    onProgress,
    writeChunk: (chunk) => { outputChunks.push(chunk); },
  });
  return new Blob(outputChunks, { type: 'application/zip' });
}

// Prefer an OPFS-backed File so ZIP bytes are streamed to disk. Call cleanup()
// after the browser has finished taking ownership of the download.
export async function createStreamingZipArtifact(entries, { signal, onProgress } = {}) {
  const files = validEntries(entries);
  if (files.length === 0) throw new Error('At least one file is required');

  let writer = null;
  if (isOPFSSupported()) {
    try {
      writer = await createOPFSWriter(`${makeId('zip')}${ZIP_TEMP_SUFFIX}`);
    } catch {
      writer = null;
    }
  }

  if (!writer) {
    if (archiveSize(files) > MAX_IN_MEMORY_ZIP_BYTES) throw new ZipStorageError();
    const blob = await createStreamingZip(files, { signal, onProgress });
    return { blob, storage: 'memory', cleanup: async () => {} };
  }

  try {
    await writeZip(files, {
      signal,
      onProgress,
      writeChunk: (chunk) => writer.write(chunk),
    });
    const blob = await writer.finish('', { keepLock: true });
    let cleaned = false;
    return {
      blob,
      storage: 'opfs',
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await writer.abort();
      },
    };
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

// Browser termination cannot reliably run cleanup. On a later visit, remove
// temp ZIPs whose Web Lock is no longer held. Without Web Locks, only old files
// are removed to avoid racing another live tab.
export async function garbageCollectStreamingZipArtifacts() {
  if (!isOPFSSupported()) return 0;
  try {
    const root = await navigator.storage.getDirectory();
    let deleted = 0;
    for await (const [name, handle] of root.entries()) {
      if (typeof name !== 'string'
        || !name.startsWith(ZIP_TEMP_PREFIX)
        || !name.endsWith(ZIP_TEMP_SUFFIX)) continue;

      let cleaned = false;
      if (navigator.locks) {
        cleaned = await navigator.locks.request(
          `vp:rec:${name}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return false;
            try {
              await root.removeEntry(name);
              return true;
            } catch {
              return false;
            }
          },
        ).catch(() => false);
      } else {
        try {
          const file = await handle.getFile();
          if (Date.now() - file.lastModified >= ZIP_ORPHAN_MAX_AGE_WITHOUT_LOCKS_MS) {
            await root.removeEntry(name);
            cleaned = true;
          }
        } catch { /* disappeared concurrently */ }
      }
      if (cleaned) deleted += 1;
    }
    return deleted;
  } catch {
    return 0;
  }
}
