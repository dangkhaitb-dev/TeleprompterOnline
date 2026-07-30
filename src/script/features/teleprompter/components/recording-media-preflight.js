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
  isCameraReady,
  isCancelled = () => false,
} = {}) {
  const missing = getMissingRecordingMedia({ cameraEnabled, micEnabled });
  let probe = null;
  try {
    probe = await acquireProbe();
    if (isCancelled()) return { ready: false, missing, reason: 'cancelled' };
    if (!hasLiveMediaTrack(probe, 'video') || !hasLiveMediaTrack(probe, 'audio')) {
      return { ready: false, missing, reason: 'inactive' };
    }
  } finally {
    if (probe) releaseProbe(probe);
  }

  if (isCancelled()) return { ready: false, missing, reason: 'cancelled' };
  let cameraOn = cameraEnabled;
  if (!cameraOn || !isCameraReady()) cameraOn = Boolean(await enableCamera());
  if (isCancelled()) return { ready: false, missing, reason: 'cancelled' };
  let micOn = micEnabled;
  if (!micOn) micOn = Boolean(await enableMic());

  const ready = !isCancelled() && cameraOn && micOn && isCameraReady();
  return { ready, missing, reason: ready ? '' : 'inactive' };
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
