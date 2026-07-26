// opfs-sync-writer.worker.js — dedicated worker owning one OPFS
// FileSystemSyncAccessHandle (the only OPFS write path WebKit shipped before
// Safari 26). Sync writes block the thread, which is why this cannot run on
// the main thread. Protocol: { id, type: 'open'|'write'|'close' } in,
// { id, ok, bytes? } | { id, ok: false, name, message } out.

let handle = null;
let offset = 0;

// Early WebKit shipped flush/truncate/close as async — await is harmless when
// they are sync (current spec) and required when they are not.
async function open(filename) {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(filename, { create: true });
  handle = await fileHandle.createSyncAccessHandle();
  // Parity with createWritable's keepExistingData: false — start empty.
  await handle.truncate(0);
  offset = 0;
}

async function toBytes(chunk) {
  if (chunk instanceof Blob) return new Uint8Array(await chunk.arrayBuffer());
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

async function write(chunk) {
  const bytes = await toBytes(chunk);
  const written = handle.write(bytes, { at: offset });
  if (written !== bytes.byteLength) {
    throw new Error(`Partial OPFS write (${written}/${bytes.byteLength} bytes)`);
  }
  offset += written;
  return written;
}

async function close() {
  if (!handle) return;
  await handle.flush();
  await handle.close();
  handle = null;
}

self.onmessage = async (event) => {
  const { id, type, filename, chunk } = event.data || {};
  try {
    let bytes;
    if (type === 'open') await open(filename);
    else if (type === 'write') bytes = await write(chunk);
    else if (type === 'close') await close();
    else throw new Error(`Unknown message type: ${type}`);
    self.postMessage({ id, ok: true, bytes });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      // DOMException doesn't structured-clone everywhere — send name/message
      // so the main thread can rebuild an identifiable error (iOS toast).
      name: (err && err.name) || '',
      message: (err && err.message) || String(err),
    });
  }
};
