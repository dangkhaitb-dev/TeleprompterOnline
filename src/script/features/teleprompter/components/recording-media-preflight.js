export function getMissingRecordingMedia({ cameraEnabled = false, micEnabled = false } = {}) {
  const missing = [];
  if (!cameraEnabled) missing.push('camera');
  if (!micEnabled) missing.push('mic');
  return missing;
}

export function hasLiveMediaTrack(stream, kind) {
  if (!stream) return false;
  const tracks = kind === 'video' ? stream.getVideoTracks?.() : stream.getAudioTracks?.();
  return Array.isArray(tracks) && tracks.some((track) => track.readyState === 'live');
}

export async function prepareRecordingMedia({
  cameraEnabled = false,
  micEnabled = false,
  acquireProbe,
  releaseProbe,
  enableCamera,
  enableMic,
  disableCamera = async () => {},
  disableMic = async () => {},
  isCameraReady,
  isCancelled = () => false,
} = {}) {
  const missing = getMissingRecordingMedia({ cameraEnabled, micEnabled });
  async function cancel({ cameraOn = cameraEnabled, micOn = micEnabled } = {}) {
    const rollbacks = [];
    if (cameraOn && !cameraEnabled) rollbacks.push(Promise.resolve().then(disableCamera));
    if (micOn && !micEnabled) rollbacks.push(Promise.resolve().then(disableMic));
    await Promise.allSettled(rollbacks);
    return { ready: false, missing, reason: 'cancelled' };
  }

  let probe = null;
  try {
    probe = await acquireProbe();
    if (isCancelled()) return cancel();
    if (!hasLiveMediaTrack(probe, 'video') || !hasLiveMediaTrack(probe, 'audio')) {
      return { ready: false, missing, reason: 'inactive' };
    }
  } finally {
    if (probe) releaseProbe(probe);
  }

  if (isCancelled()) return cancel();
  let cameraOn = cameraEnabled;
  let micOn = micEnabled;
  try {
    if (!cameraOn || !isCameraReady()) cameraOn = Boolean(await enableCamera());
    if (isCancelled()) return cancel({ cameraOn, micOn });
    if (!micOn) micOn = Boolean(await enableMic());
    if (isCancelled()) return cancel({ cameraOn, micOn });
  } catch (error) {
    if (isCancelled()) return cancel({ cameraOn, micOn });
    throw error;
  }

  const ready = cameraOn && micOn && isCameraReady();
  return { ready, missing, reason: ready ? '' : 'inactive' };
}

export function createRecordingMediaPreflightGate(action) {
  let pending = null;
  let pendingKey = null;

  function start(key) {
    let current;
    try {
      current = Promise.resolve(action(key));
    } catch (error) {
      current = Promise.reject(error);
    }
    const tracked = current.finally(() => {
      if (pending === tracked) {
        pendingKey = null;
        pending = null;
      }
    });
    pendingKey = key;
    pending = tracked;
    return tracked;
  }

  return function requestRecordingMediaPreflight(key = 'default') {
    if (!pending) return start(key);
    if (pendingKey === key) return pending;

    // A different studio-mode generation must wait for the stale request to
    // finish its rollback, then perform a fresh device check for the new mode.
    return pending.then(
      () => requestRecordingMediaPreflight(key),
      () => requestRecordingMediaPreflight(key),
    );
  };
}

export function createRecordingStartGate() {
  let pending = false;
  return {
    isPending: () => pending,
    async run(action) {
      if (pending) return false;
      pending = true;
      try {
        await action();
        return true;
      } finally {
        pending = false;
      }
    },
  };
}
