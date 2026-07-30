import { describe, expect, it, vi } from 'vitest';
import {
  createRecordingMediaPreflightGate,
  createRecordingStartGate,
  getMissingRecordingMedia,
  hasLiveMediaTrack,
  prepareRecordingMedia,
} from './recording-media-preflight.js';

describe('recording media preflight', () => {
  it('shares one pending media check between mode switching and Record clicks', async () => {
    let release;
    const action = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValue(true);
    const request = createRecordingMediaPreflightGate(action);

    const first = request();
    const second = request();

    expect(action).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    release(true);
    await expect(first).resolves.toBe(true);
    await expect(request()).resolves.toBe(true);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('queues a fresh media check for a newer studio-mode generation', async () => {
    let releaseFirst;
    const action = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValue(true);
    const request = createRecordingMediaPreflightGate(action);

    const first = request(1);
    const second = request(2);

    expect(action).toHaveBeenCalledTimes(1);
    releaseFirst(false);

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(action).toHaveBeenNthCalledWith(1, 1);
    expect(action).toHaveBeenNthCalledWith(2, 2);
  });

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
    expect(calls).toEqual(['probe', 'camera', 'mic', 'release']);
  });

  it('hands its verified probe to the camera and retains it when requested', async () => {
    const releaseProbe = vi.fn();
    const probe = {
      getVideoTracks: () => [{ readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    };
    let cameraReady = false;
    const enableCamera = vi.fn(async (stream) => {
      expect(stream).toBe(probe);
      cameraReady = true;
      return true;
    });

    await expect(prepareRecordingMedia({
      acquireProbe: async () => probe,
      releaseProbe,
      enableCamera,
      enableMic: async () => true,
      isCameraReady: () => cameraReady,
      retainProbe: true,
    })).resolves.toEqual({
      ready: true,
      missing: ['camera', 'mic'],
      reason: '',
    });

    expect(enableCamera).toHaveBeenCalledOnce();
    expect(releaseProbe).not.toHaveBeenCalled();
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

  it('releases the probe without enabling devices when the user leaves Record mode', async () => {
    let cancelled = false;
    let resolveProbe;
    const probe = {
      getVideoTracks: () => [{ readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    };
    const releaseProbe = vi.fn();
    const enableCamera = vi.fn();
    const enableMic = vi.fn();

    const pending = prepareRecordingMedia({
      acquireProbe: () => new Promise((resolve) => { resolveProbe = resolve; }),
      releaseProbe,
      enableCamera,
      enableMic,
      isCameraReady: () => false,
      isCancelled: () => cancelled,
    });
    cancelled = true;
    resolveProbe(probe);

    await expect(pending).resolves.toEqual({
      ready: false,
      missing: ['camera', 'mic'],
      reason: 'cancelled',
    });
    expect(releaseProbe).toHaveBeenCalledWith(probe);
    expect(enableCamera).not.toHaveBeenCalled();
    expect(enableMic).not.toHaveBeenCalled();
  });

  it('rolls back both auto-enabled inputs when mode changes while mic starts', async () => {
    let cancelled = false;
    const disableCamera = vi.fn();
    const disableMic = vi.fn();
    const probe = {
      getVideoTracks: () => [{ readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    };

    await expect(prepareRecordingMedia({
      acquireProbe: async () => probe,
      releaseProbe: vi.fn(),
      enableCamera: async () => true,
      enableMic: async () => {
        cancelled = true;
        return true;
      },
      disableCamera,
      disableMic,
      isCameraReady: () => true,
      isCancelled: () => cancelled,
    })).resolves.toEqual({
      ready: false,
      missing: ['camera', 'mic'],
      reason: 'cancelled',
    });
    expect(disableCamera).toHaveBeenCalledOnce();
    expect(disableMic).toHaveBeenCalledOnce();
  });

  it('preserves inputs that were already enabled before a cancelled preflight', async () => {
    let cancelled = false;
    const disableCamera = vi.fn();
    const disableMic = vi.fn();
    const probe = {
      getVideoTracks: () => [{ readyState: 'live' }],
      getAudioTracks: () => [{ readyState: 'live' }],
    };

    await expect(prepareRecordingMedia({
      cameraEnabled: true,
      acquireProbe: async () => probe,
      releaseProbe: vi.fn(),
      enableCamera: vi.fn(),
      enableMic: async () => {
        cancelled = true;
        return true;
      },
      disableCamera,
      disableMic,
      isCameraReady: () => true,
      isCancelled: () => cancelled,
    })).resolves.toEqual({
      ready: false,
      missing: ['mic'],
      reason: 'cancelled',
    });

    expect(disableCamera).not.toHaveBeenCalled();
    expect(disableMic).toHaveBeenCalledOnce();
  });
});
