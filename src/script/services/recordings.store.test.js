import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeRecordingsDb,
  ensureRecordingBlob,
  getRecording,
  listAllRecordings,
  listByWorkspace,
  putRecording,
  removeByWorkspace,
  removeRecording,
  removeRecordings,
  updateRecording,
} from './recordings.store.js';

// Minimal in-memory IndexedDB fake covering what recordings.store.js touches:
// open (with versioned onupgradeneeded + upgrade transaction), multi-store
// transactions, put/get/getAll/delete, the byWorkspace index (getAll +
// getAllKeys) and openCursor (v1→v2 migration).
// `failBlobPuts` simulates WebKit's "Error preparing Blob/File data to be
// stored in object store" (DOMException name "UnknownError") whenever the
// stored value carries a Blob; `failAllPuts` rejects every put.
// `v1Records` seeds a version-1 database (records may carry inline blobBytes)
// so the migration path can be exercised. `staleFirstConnection` makes the
// first transaction() throw InvalidStateError, mimicking a cached connection
// closed by another tab's version change.
function installIndexedDB({
  failBlobPuts = false,
  failAllPuts = false,
  v1Records = null,
  staleFirstConnection = false,
} = {}) {
  const stores = new Map([['recordings', new Map()]]);
  let version = v1Records ? 1 : 0;
  if (v1Records) v1Records.forEach((record) => stores.get('recordings').set(record.id, record));

  function makeRequest(executor) {
    const request = { onsuccess: null, onerror: null, result: undefined, error: null };
    queueMicrotask(() => {
      try {
        request.result = executor();
        request.onsuccess?.({ target: request });
      } catch (err) {
        request.error = err;
        request.onerror?.({ target: request });
      }
    });
    return request;
  }

  function makeTransaction() {
    const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
    let pending = 0;
    let fired = false;
    const settle = () => {
      if (fired || pending > 0) return;
      fired = true;
      tx.oncomplete?.();
    };
    const track = (executor) => {
      pending += 1;
      return makeRequest(() => {
        try {
          return executor();
        } finally {
          pending -= 1;
          // Macrotask: real transactions complete only after their last
          // request settles and the caller has had a chance to attach handlers.
          setTimeout(settle, 0);
        }
      });
    };
    const storeApi = (name) => {
      const map = () => stores.get(name);
      return {
        put: (value) => track(() => {
          if (failAllPuts) {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
          }
          if (failBlobPuts && value.blob instanceof Blob) {
            throw new DOMException(
              'Error preparing Blob/File data to be stored in object store',
              'UnknownError',
            );
          }
          map().set(value.id, value);
          return value.id;
        }),
        get: (id) => track(() => map().get(id)),
        getAll: () => track(() => [...map().values()]),
        delete: (id) => track(() => {
          map().delete(id);
        }),
        index: () => ({
          getAll: (workspaceId) => track(
            () => [...map().values()].filter((rec) => rec.workspaceId === workspaceId),
          ),
          getAllKeys: (workspaceId) => track(
            () => [...map().values()]
              .filter((rec) => rec.workspaceId === workspaceId)
              .map((rec) => rec.id),
          ),
        }),
        openCursor: () => {
          const request = { onsuccess: null, onerror: null, result: undefined };
          const keys = [...map().keys()];
          let i = 0;
          const step = () => queueMicrotask(() => {
            if (i < keys.length) {
              const key = keys[i];
              request.result = {
                value: map().get(key),
                update: (value) => {
                  map().set(key, value);
                  return { onsuccess: null };
                },
                continue: () => {
                  i += 1;
                  step();
                },
              };
            } else {
              request.result = null;
            }
            request.onsuccess?.({ target: request });
          });
          step();
          return request;
        },
      };
    };
    tx.objectStore = (name) => storeApi(name);
    return tx;
  }

  let staleThrown = false;
  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name) => {
      stores.set(name, new Map());
      return { createIndex: () => {} };
    },
    transaction: () => {
      if (staleFirstConnection && !staleThrown) {
        staleThrown = true;
        db.onclose?.();
        throw new DOMException('The database connection is closing.', 'InvalidStateError');
      }
      return makeTransaction();
    },
    close: vi.fn(),
  };

  const open = (_name, requestedVersion) => {
    const request = {
      onupgradeneeded: null, onsuccess: null, onerror: null, result: db, transaction: null,
    };
    setTimeout(() => {
      if (requestedVersion > version) {
        request.transaction = makeTransaction();
        request.onupgradeneeded?.({ target: request });
        version = requestedVersion;
      }
      // Let the migration cursor's microtask cascade flush before success.
      setTimeout(() => request.onsuccess?.({ target: request }), 0);
    }, 0);
    return request;
  };

  vi.stubGlobal('indexedDB', { open });
  return { stores, data: stores.get('recordings') };
}

afterEach(async () => {
  // The store caches its connection per page — drop it so the next test's
  // stubbed indexedDB is actually used.
  await closeRecordingsDb();
  vi.unstubAllGlobals();
});

describe('putRecording', () => {
  it('stores the blob as-is when IndexedDB accepts it', async () => {
    const { data, stores } = installIndexedDB();
    const blob = new Blob(['abc'], { type: 'video/mp4' });

    const record = await putRecording({ workspaceId: 'w1', blob });

    const stored = data.get(record.id);
    expect(stored.blob).toBe(blob);
    expect(stored.blobBytes).toBeUndefined();
    expect(stored.hasBytes).toBeUndefined();
    expect(stores.get('recording-bytes').size).toBe(0);
    expect(record.blob).toBe(blob);
  });

  it('falls back to side-store bytes when IndexedDB rejects the blob (iOS WebKit)', async () => {
    const { data, stores } = installIndexedDB({ failBlobPuts: true });
    const blob = new Blob(['abc'], { type: 'video/mp4' });

    const record = await putRecording({ workspaceId: 'w1', blob });

    const stored = data.get(record.id);
    expect(stored.blob).toBeUndefined();
    expect(stored.blobBytes).toBeUndefined();
    expect(stored.hasBytes).toBe(true);
    expect(stored.mimeType).toBe('video/mp4');
    const bytesRow = stores.get('recording-bytes').get(record.id);
    expect(bytesRow.bytes).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(bytesRow.bytes)).toBe('abc');
    // Caller still gets a usable blob for the review panel.
    expect(record.blob).toBe(blob);
  });

  it('rejects with the original error when every put fails', async () => {
    installIndexedDB({ failAllPuts: true });
    const blob = new Blob(['abc'], { type: 'video/mp4' });

    await expect(putRecording({ workspaceId: 'w1', blob })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });

  it('reopens and retries once when the cached connection was closed by another tab', async () => {
    const { data } = installIndexedDB({ staleFirstConnection: true });
    const blob = new Blob(['abc'], { type: 'video/mp4' });

    const record = await putRecording({ workspaceId: 'w1', blob });

    expect(data.get(record.id).blob).toBe(blob);
  });
});

describe('byte-backed records', () => {
  async function seedByteRecord() {
    const fixture = installIndexedDB({ failBlobPuts: true });
    const blob = new Blob(['abc'], { type: 'video/mp4' });
    const record = await putRecording({ workspaceId: 'w1', blob, duration: 1200 });
    return { ...fixture, record };
  }

  it('getRecording returns a Blob rebuilt from stored bytes', async () => {
    const { record } = await seedByteRecord();

    const loaded = await getRecording(record.id);

    expect(loaded.blob).toBeInstanceOf(Blob);
    expect(loaded.blob.type).toBe('video/mp4');
    expect(await loaded.blob.text()).toBe('abc');
    expect(loaded.blobBytes).toBeUndefined();
  });

  it('listings stay metadata-only: blob null + hasBytes flag', async () => {
    const { record } = await seedByteRecord();

    const [byWorkspace] = await listByWorkspace('w1');
    const [all] = await listAllRecordings();

    expect(byWorkspace.id).toBe(record.id);
    expect(byWorkspace.blob).toBeNull();
    expect(byWorkspace.hasBytes).toBe(true);
    expect(all.blob).toBeNull();
    expect(all.hasBytes).toBe(true);
  });

  it('ensureRecordingBlob loads the bytes on demand', async () => {
    const { record } = await seedByteRecord();
    const [listed] = await listAllRecordings();

    const blob = await ensureRecordingBlob(listed);

    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe('abc');
    expect(await ensureRecordingBlob({ id: 'missing', hasBytes: true })).toBeNull();
    expect(await ensureRecordingBlob({ id: record.id })).toBeNull();
  });

  it('updateRecording patches metadata without touching the bytes store', async () => {
    const { data, stores, record } = await seedByteRecord();

    const updated = await updateRecording(record.id, { trimStart: 500 });

    expect(updated.trimStart).toBe(500);
    expect(updated.hasBytes).toBe(true);
    expect(updated.blob).toBeNull();
    const stored = data.get(record.id);
    expect(stored.blob).toBeUndefined();
    const bytesRow = stores.get('recording-bytes').get(record.id);
    expect(new TextDecoder().decode(bytesRow.bytes)).toBe('abc');
  });

  it('deletes remove both the metadata and the bytes rows', async () => {
    const { data, stores, record } = await seedByteRecord();
    const other = await putRecording({
      workspaceId: 'w1',
      blob: new Blob(['def'], { type: 'video/mp4' }),
    });

    await removeRecording(record.id);
    expect(data.has(record.id)).toBe(false);
    expect(stores.get('recording-bytes').has(record.id)).toBe(false);

    await removeRecordings([other.id]);
    expect(data.has(other.id)).toBe(false);
  });

  it('removeByWorkspace clears both stores via index keys', async () => {
    const { data, stores, record } = await seedByteRecord();
    await putRecording({ workspaceId: 'w2', blob: new Blob(['zzz'], { type: 'video/mp4' }) });

    await removeByWorkspace('w1');

    expect(data.has(record.id)).toBe(false);
    expect(stores.get('recording-bytes').has(record.id)).toBe(false);
    expect(data.size).toBe(1);
  });
});

describe('v1 → v2 migration', () => {
  it('moves inline blobBytes into the side store and flags the record', async () => {
    const bytes = new TextEncoder().encode('abc').buffer;
    const { data, stores } = installIndexedDB({
      v1Records: [
        { id: 'rec-old', workspaceId: 'w1', mimeType: 'video/mp4', blobBytes: bytes },
        { id: 'rec-plain', workspaceId: 'w1', blob: new Blob(['x'], { type: 'video/mp4' }) },
      ],
    });

    const all = await listAllRecordings();

    const migrated = data.get('rec-old');
    expect(migrated.blobBytes).toBeUndefined();
    expect(migrated.hasBytes).toBe(true);
    expect(new TextDecoder().decode(stores.get('recording-bytes').get('rec-old').bytes)).toBe('abc');
    const publicOld = all.find((rec) => rec.id === 'rec-old');
    expect(publicOld.blob).toBeNull();
    expect(publicOld.hasBytes).toBe(true);
    // Blob-form records pass through the migration untouched.
    const publicPlain = all.find((rec) => rec.id === 'rec-plain');
    expect(publicPlain.blob).toBeInstanceOf(Blob);

    const loaded = await getRecording('rec-old');
    expect(await loaded.blob.text()).toBe('abc');
  });
});
