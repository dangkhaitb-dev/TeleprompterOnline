import { describe, expect, it } from 'vitest';
import { createRecordingDebugLog } from './recording-debug-log.js';

describe('recording debug log', () => {
  it('keeps only allowlisted diagnostic fields', () => {
    const log = createRecordingDebugLog({ now: () => '2026-07-30T00:00:00.000Z' });

    log.add('recorder-started', {
      cameraEnabled: true,
      previewVideo: 'live',
      errorName: 'NotReadableError',
      asrMode: 'browser-service',
      asrFailureCount: 2,
      asrEmptyAbortCount: 1,
      deviceId: 'private-camera-id',
      script: 'private script text',
      stream: { id: 'private-stream-id' },
    });

    expect(log.getEntries()).toEqual([{
      at: '2026-07-30T00:00:00.000Z',
      event: 'recorder-started',
      cameraEnabled: true,
      previewVideo: 'live',
      errorName: 'NotReadableError',
      asrMode: 'browser-service',
      asrFailureCount: 2,
      asrEmptyAbortCount: 1,
    }]);
    expect(log.toText()).not.toContain('private');
  });

  it('normalizes untrusted strings to an inert value', () => {
    const log = createRecordingDebugLog({ now: () => 'now' });

    log.add('asr-error', { reason: 'an untrusted browser message', errorName: 'CustomError' });

    expect(log.getEntries()[0]).toMatchObject({ reason: 'other', errorName: 'other' });
  });

  it('keeps the newest bounded set of events', () => {
    let tick = 0;
    const log = createRecordingDebugLog({ now: () => `t-${tick++}` });
    for (let index = 0; index < 82; index++) log.add(`event-${index}`);

    expect(log.getEntries()).toHaveLength(80);
    expect(log.getEntries()[0].event).toBe('event-2');
    expect(log.getEntries().at(-1).event).toBe('event-81');
  });
});
