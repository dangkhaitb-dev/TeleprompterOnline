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
      {
        blob: new Blob(['audio-three'], { type: 'audio/mpeg' }),
        mimeType: 'audio/webm',
      },
    ];

    const archive = await createRecordingsZip(scenes, { onProgress });
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));

    expect(archive.type).toBe('application/zip');
    expect(strFromU8(files['solprompter-clip-01.webm'])).toBe('video-one');
    expect(strFromU8(files['solprompter-clip-02.ogg'])).toBe('audio-two');
    expect(strFromU8(files['solprompter-clip-03.mp3'])).toBe('audio-three');
    expect(onProgress).toHaveBeenLastCalledWith({ progress: 1, fileIndex: 3, fileCount: 3 });
  });

  it('rejects archives with fewer than two recordings', async () => {
    await expect(createRecordingsZip([
      { blob: new Blob(['one']), mimeType: 'video/webm' },
    ])).rejects.toThrow('At least two recordings are required');
  });
});
