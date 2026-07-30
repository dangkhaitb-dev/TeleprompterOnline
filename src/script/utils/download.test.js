/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './download.js';

describe('downloadBlob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test-download'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports the download lifecycle without exposing the blob URL', () => {
    const entries = [];
    downloadBlob(new Blob(['audio'], { type: 'audio/mp4' }), 'take.mp4', {
      onDebug: (event, details) => entries.push({ event, details }),
    });

    expect(entries.map(({ event }) => event)).toEqual([
      'download:start',
      'download:url-created',
      'download:clicked',
    ]);
    expect(entries[1].details).toEqual({ scheme: 'blob:' });

    vi.advanceTimersByTime(1000);
    expect(entries.at(-1).event).toBe('download:revoked');
  });

  it('reports and rethrows object URL failures', () => {
    URL.createObjectURL.mockImplementation(() => {
      throw new Error('blob URL unavailable');
    });
    const onDebug = vi.fn();

    expect(() => downloadBlob(new Blob(['zip']), 'takes.zip', { onDebug }))
      .toThrow('blob URL unavailable');
    expect(onDebug).toHaveBeenLastCalledWith('download:throw', {
      name: 'Error',
      message: 'blob URL unavailable',
    });
  });

  it('uses the native file share path on iOS when the MIME type is shareable', () => {
    const share = vi.fn(() => Promise.resolve());
    const canShare = vi.fn(() => true);
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/140',
      canShare,
      share,
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    downloadBlob(new Blob(['video'], { type: 'video/mp4' }), 'take.mp4');

    expect(canShare).toHaveBeenCalledOnce();
    const shareData = share.mock.calls[0][0];
    expect(shareData.files).toHaveLength(1);
    expect(shareData.files[0]).toMatchObject({ name: 'take.mp4', type: 'video/mp4' });
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a blob tab on iOS when file sharing is unsupported', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/140',
      canShare: vi.fn(() => false),
      share: vi.fn(),
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    downloadBlob(new Blob(['zip'], { type: 'application/zip' }), 'takes.zip');

    expect(open).toHaveBeenCalledWith('blob:test-download', '_blank', 'noopener');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
  });
});
