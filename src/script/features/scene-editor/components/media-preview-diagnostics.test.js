import { describe, expect, it } from 'vitest';
import {
  diagnoseMediaPreview,
  formatMediaPreviewDiagnostics,
} from './media-preview-diagnostics.js';

function mediaWith({ errorCode = null, canPlayType = 'probably' } = {}) {
  return {
    error: errorCode ? { code: errorCode } : null,
    readyState: 1,
    networkState: 2,
    currentTime: 0,
    duration: 5,
    canPlayType: () => canPlayType,
  };
}

describe('media preview diagnostics', () => {
  it('identifies an empty recording before codec-related failures', () => {
    const details = diagnoseMediaPreview({
      media: mediaWith({ errorCode: 3 }),
      blob: new Blob([], { type: 'video/mp4' }),
    });

    expect(details.code).toBe('EMPTY_BLOB');
    expect(details.blobSize).toBe(0);
  });

  it.each([
    [2, 'MEDIA_NETWORK'],
    [3, 'MEDIA_DECODE'],
    [4, 'MEDIA_SOURCE_UNSUPPORTED'],
  ])('maps MediaError code %i to %s', (errorCode, expected) => {
    const details = diagnoseMediaPreview({
      media: mediaWith({ errorCode }),
      blob: new Blob(['video'], { type: 'video/mp4' }),
    });

    expect(details.code).toBe(expected);
    expect(details.canPlayType).toBe('probably');
  });

  it('captures a rejected play request and formats copyable details', () => {
    const error = new DOMException('format unavailable', 'NotSupportedError');
    const details = diagnoseMediaPreview({
      error,
      media: mediaWith({ canPlayType: '' }),
      blob: new Blob(['video'], { type: 'video/mp4' }),
      userAgent: 'iPhone test',
      stage: 'play-promise',
    });

    expect(details).toMatchObject({
      code: 'PLAY_NOT_SUPPORTED',
      errorName: 'NotSupportedError',
      mimeType: 'video/mp4',
      stage: 'play-promise',
      userAgent: 'iPhone test',
    });
    expect(formatMediaPreviewDiagnostics(details)).toContain('"readyState": 1');
  });
});
