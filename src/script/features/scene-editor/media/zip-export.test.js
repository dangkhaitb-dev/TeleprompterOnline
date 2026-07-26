import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createRecordingsZip } from './zip-export.js';

describe('createRecordingsZip', () => {
  it('packages original recording bytes and reports completion', async () => {
    const onProgress = vi.fn();
    const scenes = [
      {
        blob: new Blob(['video-one'], { type: 'video/webm' }),
        mimeType: 'video/webm;codecs=vp9,opus',
      },
      {
        blob: new Blob(['audio-two'], { type: 'audio/ogg' }),
        mimeType: 'audio/ogg;codecs=opus',
      },
    ];

    const archive = await createRecordingsZip(scenes, { onProgress });
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));

    expect(archive.type).toBe('application/zip');
    expect(strFromU8(files['vteleprompter-clip-01.webm'])).toBe('video-one');
    expect(strFromU8(files['vteleprompter-clip-02.ogg'])).toBe('audio-two');
    expect(onProgress).toHaveBeenLastCalledWith({ progress: 1, fileIndex: 2, fileCount: 2 });
  });

  it('rejects archives with fewer than two recordings', async () => {
    await expect(createRecordingsZip([
      { blob: new Blob(['one']), mimeType: 'video/webm' },
    ])).rejects.toThrow('At least two recordings are required');
  });
});
