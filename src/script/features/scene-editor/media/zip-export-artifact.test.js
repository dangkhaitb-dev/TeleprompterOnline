import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

const opfs = vi.hoisted(() => ({
  supported: true,
  chunks: [],
  abort: vi.fn(async () => {}),
}));

vi.mock('../../../utils/opfs-writer.js', () => ({
  isOPFSSupported: () => opfs.supported,
  createOPFSWriter: vi.fn(async () => ({
    write: async (chunk) => { opfs.chunks.push(chunk); },
    finish: async () => new Blob(opfs.chunks, { type: 'application/zip' }),
    abort: opfs.abort,
  })),
}));

import {
  createRecordingsZipArtifact,
  garbageCollectRecordingsZipArtifacts,
} from './zip-export.js';

afterEach(() => {
  opfs.supported = true;
  opfs.chunks = [];
  opfs.abort.mockClear();
  vi.unstubAllGlobals();
});

describe('createRecordingsZipArtifact', () => {
  it('streams an archive to OPFS and removes it on cleanup', async () => {
    const artifact = await createRecordingsZipArtifact([
      { blob: new Blob(['one']), mimeType: 'video/webm' },
      { blob: new Blob(['two']), mimeType: 'audio/ogg' },
    ]);
    const files = unzipSync(new Uint8Array(await artifact.blob.arrayBuffer()));

    expect(artifact.storage).toBe('opfs');
    expect(strFromU8(files['solprompter-clip-01.webm'])).toBe('one');
    expect(strFromU8(files['solprompter-clip-02.ogg'])).toBe('two');

    await artifact.cleanup();
    await artifact.cleanup();
    expect(opfs.abort).toHaveBeenCalledOnce();
  });

  it('removes crash-orphaned ZIP files but preserves locked active files', async () => {
    const removeEntry = vi.fn(async () => {});
    const root = {
      entries: async function* entries() {
        yield ['zip-orphan.tmp', {}];
        yield ['zip-active.tmp', {}];
        yield ['rec-unrelated.webm', {}];
      },
      removeEntry,
    };
    const locks = {
      request: vi.fn(async (name, _options, callback) => (
        callback(name.includes('active') ? null : {})
      )),
    };
    vi.stubGlobal('navigator', {
      storage: { getDirectory: vi.fn(async () => root) },
      locks,
    });

    await expect(garbageCollectRecordingsZipArtifacts()).resolves.toBe(1);
    expect(removeEntry).toHaveBeenCalledOnce();
    expect(removeEntry).toHaveBeenCalledWith('zip-orphan.tmp');
  });
});
