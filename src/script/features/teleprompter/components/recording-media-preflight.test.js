import { describe, expect, it, vi } from 'vitest';
import {
  createRecordingStartGate,
  getMissingRecordingMedia,
  hasLiveMediaTrack,
  prepareRecordingMedia,
} from './recording-media-preflight.js';

describe('recording media preflight', () => {
  it.each([
    [{ cameraEnabled: false, micEnabled: false }, ['camera', 'mic']],
    [{ cameraEnabled: false, micEnabled: true }, ['camera']],
    [{ cameraEnabled: true, micEnabled: false }, ['mic']],
    [{ cameraEnabled: true, micEnabled: true }, []],
  ])('reports the disabled recording inputs for %o', (state, expected) => {
    expect(getMissingRecordingMedia(state)).toEqual(expected);
  });

  it('only accepts a live track of the requested kind', () => {
    const stream = {
      getVideoTracks: () => [{ readyState: 'ended' }, { readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'ended' }],
    };

    expect(hasLiveMediaTrack(stream, 'video')).toBe(true);
    expect(hasLiveMediaTrack(stream, 'audio')).toBe(false);
    expect(hasLiveMediaTrack(null, 'video')).toBe(false);
  });

  it('ignores a second Record action while the first preflight is pending', async () => {
    let finishFirst;
    const gate = createRecordingStartGate();
    const firstAction = vi.fn(() => new Promise((resolve) => {
      finishFirst = resolve;
    }));
    const secondAction = vi.fn();

    const first = gate.run(firstAction);
    const second = gate.run(secondAction);

    await expect(second).resolves.toBe(false);
    expect(secondAction).not.toHaveBeenCalled();
    expect(gate.isPending()).toBe(true);

    finishFirst();
    await expect(first).resolves.toBe(true);
    expect(gate.isPending()).toBe(false);
  });

  it('probes both live inputs before auto-enabling camera and microphone', async () => {
    const calls = [];
    let cameraReady = false;
    const probe = {
      getVideoTracks: () => [{ readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    };

    const result = await prepareRecordingMedia({
      acquireProbe: async () => {
        calls.push('probe');
        return probe;
      },
      releaseProbe: (stream) => {
        expect(stream).toBe(probe);
        calls.push('release');
      },
      enableCamera: async () => {
        calls.push('camera');
        cameraReady = true;
        return true;
      },
      enableMic: async () => {
        calls.push('mic');
        return true;
      },
      isCameraReady: () => cameraReady,
    });

    expect(result).toEqual({
      ready: true,
      missing: ['camera', 'mic'],
      reason: '',
    });
    expect(calls).toEqual(['probe', 'release', 'camera', 'mic']);
  });

  it('releases an inactive probe and does not enable either device', async () => {
    const releaseProbe = vi.fn();
    const enableCamera = vi.fn();
    const enableMic = vi.fn();
    const probe = {
      getVideoTracks: () => [{ readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'ended' }],
    };

    await expect(prepareRecordingMedia({
      acquireProbe: async () => probe,
      releaseProbe,
      enableCamera,
      enableMic,
      isCameraReady: () => false,
    })).resolves.toEqual({
      ready: false,
      missing: ['camera', 'mic'],
      reason: 'inactive',
    });
    expect(releaseProbe).toHaveBeenCalledWith(probe);
    expect(enableCamera).not.toHaveBeenCalled();
    expect(enableMic).not.toHaveBeenCalled();
  });
});
