// recordings.store.js — IndexedDB persistence for recorded clips ("scenes").
// Blobs are too large for localStorage, so recordings live in IndexedDB keyed
// by id with a byWorkspace index. No DOM here (service layer).
//
// Recording = { id, workspaceId, blob, kind, mimeType, duration, order,
//               trimStart?, trimEnd?, createdAt }   (duration/order/times: ms)
//
// v2 schema: WebKit fallback bytes live in a separate `recording-bytes` store
// (one row per recording: { id, bytes }). Metadata rows never carry the media
// payload, so listings and metadata updates stay cheap; records whose media is
// byte-backed are flagged `hasBytes: true` and expose `blob: null` until
// ensureRecordingBlob() loads the bytes on demand.

import { makeId } from '../utils/id.js';

const DB_NAME = 'solprompter-media';
const DB_VERSION = 2;
const STORE = 'recordings';
const BYTES_STORE = 'recording-bytes';

// v1 stored WebKit-fallback bytes inline on the record (`blobBytes`), which
// forced every listing to materialize the whole library into RAM. Move them
// into the side store. Runs inside the versionchange transaction.
function migrateToV2(db, tx) {
  if (!db.objectStoreNames.contains(BYTES_STORE)) {
    db.createObjectStore(BYTES_STORE, { keyPath: 'id' });
  }
  const store = tx.objectStore(STORE);
  const bytesStore = tx.objectStore(BYTES_STORE);
  store.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) return;
    const record = cursor.value;
    if (record.blobBytes) {
      bytesStore.put({ id: record.id, bytes: record.blobBytes });
      const { blobBytes, ...rest } = record;
      void blobBytes;
      cursor.update({ ...rest, hasBytes: true });
    }
    cursor.continue();
  };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byWorkspace', 'workspaceId', { unique: false });
      }
      migrateToV2(db, request.transaction);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// One shared connection per page instead of an open/close cycle per call.
// Released when another tab needs a version change (or on explicit close).
let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB().then((db) => {
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      return db;
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

// Drop the cached connection (tests, teardown).
export async function closeRecordingsDb() {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // already closed
  }
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction(db, names, mode, run) {
  const tx = db.transaction(names, mode);
  const result = await run(...names.map((name) => tx.objectStore(name)));
  // For write operations, wait until the transaction fully commits so that
  // a subsequent read is guaranteed to see the data. Resolving on
  // request.onsuccess alone can race with the read.
  if (mode === 'readwrite') {
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(
        tx.error || new DOMException('Transaction aborted', 'AbortError'),
      );
    });
  }
  return result;
}

async function withStores(names, mode, run) {
  for (let attempt = 0; ; attempt += 1) {
    const pending = getDB();
    const db = await pending;
    try {
      return await runTransaction(db, names, mode, run);
    } catch (err) {
      // The cached connection can be closed under us by another tab's version
      // change between getDB() resolving and transaction() running — reopen
      // once and retry. Only drop the cache if it still points at THIS
      // connection, so a concurrently reopened healthy one isn't leaked.
      if (attempt === 0 && err && err.name === 'InvalidStateError') {
        if (dbPromise === pending) dbPromise = null;
        continue;
      }
      throw err;
    }
  }
}

function buildBlob(bytes, mimeType) {
  return new Blob([bytes], mimeType ? { type: mimeType } : undefined);
}

// Listing shape: byte-backed records surface `blob: null` (+ hasBytes) so a
// library listing never drags the media payload into RAM. Legacy inline
// blobBytes should not survive the v2 migration, but rebuild defensively.
function toPublicRecord(record) {
  if (!record) return record;
  if (record.blobBytes) {
    const { blobBytes, ...rest } = record;
    return { ...rest, blob: buildBlob(blobBytes, rest.mimeType) };
  }
  if (record.hasBytes && !record.blob) return { ...record, blob: null };
  return record;
}

// Load the media for a byte-backed record on demand. Returns the Blob (or the
// record's own blob when it already has one, or null when nothing is stored).
// Does not mutate the record — callers cache the result where they need it.
export async function ensureRecordingBlob(record) {
  if (!record) return null;
  if (record.blob) return record.blob;
  if (!record.hasBytes) return null;
  const row = await withStores([BYTES_STORE], 'readonly', (bytesStore) =>
    promisify(bytesStore.get(record.id)),
  );
  if (!row || !row.bytes) return null;
  return buildBlob(row.bytes, record.mimeType);
}

export async function putRecording(recording = {}) {
  const record = {
    id: recording.id || makeId('rec'),
    workspaceId: recording.workspaceId || null,
    blob: recording.blob,
    kind: recording.kind || 'video',
    mimeType: recording.mimeType || (recording.blob && recording.blob.type) || '',
    duration: recording.duration || 0,
    order: typeof recording.order === 'number' ? recording.order : Date.now(),
    trimStart: recording.trimStart ?? null,
    trimEnd: recording.trimEnd ?? null,
    createdAt: recording.createdAt || Date.now(),
    temporary: !!recording.temporary,
  };
  try {
    await withStores([STORE], 'readwrite', (store) => promisify(store.put(record)));
  } catch (err) {
    if (!(record.blob instanceof Blob)) throw err;
    // WebKit (iOS Safari) can refuse to write any Blob/File value into
    // IndexedDB ("Error preparing Blob/File data to be stored in object
    // store"). Retry with the bytes in the side store — a single arrayBuffer()
    // copy; never wrap the bytes in another Blob (that doubles peak RAM for
    // recordings that are already hundreds of MB). arrayBuffer() must run
    // outside any transaction — IndexedDB transactions auto-commit as soon as
    // control returns to the event loop.
    let bytes;
    try {
      bytes = await record.blob.arrayBuffer();
    } catch {
      throw err;
    }
    const byteRecord = { ...record, hasBytes: true };
    delete byteRecord.blob;
    await withStores([STORE, BYTES_STORE], 'readwrite', (store, bytesStore) =>
      Promise.all([
        promisify(store.put(byteRecord)),
        promisify(bytesStore.put({ id: record.id, bytes })),
      ]),
    );
  }
  return record;
}

// Metadata-only patch (trim marks, workspace move, …). Never touches the
// bytes store, so trimming a 500 MB byte-backed take rewrites two integers,
// not the media.
export async function updateRecording(id, patch = {}) {
  const updated = await withStores([STORE], 'readwrite', async (store) => {
    const existing = await promisify(store.get(id));
    if (!existing) return null;
    const next = { ...existing, ...patch, id };
    await promisify(store.put(next));
    return next;
  });
  return toPublicRecord(updated);
}

export async function getRecording(id) {
  const record = await withStores([STORE, BYTES_STORE], 'readonly', async (store, bytesStore) => {
    const found = await promisify(store.get(id));
    if (!found || !found.hasBytes || found.blob) return found;
    const row = await promisify(bytesStore.get(id));
    if (!row || !row.bytes) return found;
    return { ...found, blob: buildBlob(row.bytes, found.mimeType) };
  });
  return toPublicRecord(record);
}

export async function listByWorkspace(workspaceId) {
  const list = await withStores([STORE], 'readonly', (store) =>
    promisify(store.index('byWorkspace').getAll(workspaceId)),
  );
  return (list || []).map(toPublicRecord).sort((a, b) => (a.order || 0) - (b.order || 0));
}

// Every recording across all workspaces, newest first (for the Recordings view).
export async function listAllRecordings() {
  const list = await withStores([STORE], 'readonly', (store) => promisify(store.getAll()));
  return (list || []).map(toPublicRecord).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function removeRecording(id) {
  await withStores([STORE, BYTES_STORE], 'readwrite', (store, bytesStore) =>
    Promise.all([promisify(store.delete(id)), promisify(bytesStore.delete(id))]),
  );
}

// Delete an explicit snapshot of recordings in one transaction. Callers that
// select temporary records must pass only those ids, so permanent recordings
// in the same workspace are never swept up by garbage collection.
export async function removeRecordings(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;
  await withStores([STORE, BYTES_STORE], 'readwrite', (store, bytesStore) =>
    Promise.all(uniqueIds.flatMap((id) => [
      promisify(store.delete(id)),
      promisify(bytesStore.delete(id)),
    ])),
  );
  return uniqueIds.length;
}

export async function removeByWorkspace(workspaceId) {
  await withStores([STORE, BYTES_STORE], 'readwrite', async (store, bytesStore) => {
    const ids = await promisify(store.index('byWorkspace').getAllKeys(workspaceId));
    await Promise.all((ids || []).flatMap((id) => [
      promisify(store.delete(id)),
      promisify(bytesStore.delete(id)),
    ]));
  });
}
