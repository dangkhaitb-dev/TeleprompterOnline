// media-export.js — real (canvas + MediaRecorder / AudioContext) re-encode for
// trimmed clips and merged video. Constructs DETACHED media/canvas elements, so
// it touches DOM but is not a .ui.js file. Every op accepts an AbortSignal so
// teardown mid-export stops the recorder and closes the AudioContext.
//
// Honest limits: export is REAL but slow + lossy — each clip is played through
// in real time (a 2-min merge takes ~2 min). No fast/stream-copy path.

import { mediaExportBounds } from '../scene-editor.model.js';
import { waitForMediaReady, seekMedia } from './media-element.js';
import {
  MIN_TRIM_SECONDS,
  EXPORT_CANVAS_WIDTH,
  EXPORT_CANVAS_HEIGHT,
  EXPORT_FPS,
  RECORDER_TIMESLICE_MS,
  AUDIO_RECORDER_TIMESLICE_MS,
  VIDEO_MIME_CANDIDATES,
  AUDIO_MIME_CANDIDATES,
  AUDIO_GRADIENT_STOPS,
  EXPORT_VIDEO_LETTERBOX,
} from '../../../constants/media.js';

class AbortError extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'AbortError';
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new AbortError();
}

// Feature detection surfaced to callers so Safari/iOS gaps toast gracefully.
export function canExportVideo() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  return Boolean(
    typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && HTMLCanvasElement.prototype.captureStream
    && AC,
  );
}

export function canExportAudio() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  return Boolean(typeof MediaRecorder !== 'undefined' && AC);
}

function pickMime(preferred, candidates) {
  return [preferred, ...candidates]
    .find((type) => type && MediaRecorder.isTypeSupported(type)) || '';
}

// Play [start,end] in real time, resolving when the range is done. Rejects on
// abort so the caller's finally cleans up.
function playRange(media, start, end, signal) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let frameId;
    const onAbort = () => finish(true);
    const finish = (aborted) => {
      if (finished) return;
      finished = true;
      media.pause();
      cancelAnimationFrame(frameId);
      signal?.removeEventListener('abort', onAbort);
      if (aborted) reject(new AbortError());
      else resolve();
    };
    const check = () => {
      if (signal?.aborted) return finish(true);
      if (media.currentTime >= end - 0.015 || media.ended) return finish(false);
      frameId = requestAnimationFrame(check);
    };
    media.addEventListener('ended', () => finish(false), { once: true });
    media.addEventListener('error', () => reject(new Error('Cannot play a clip')), { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    (async () => {
      try {
        await seekMedia(media, start);
        throwIfAborted(signal);
        await media.play();
        frameId = requestAnimationFrame(check);
      } catch (error) {
        cancelAnimationFrame(frameId);
        reject(error);
      }
    })();
  });
}

function drawAudioBackground(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  AUDIO_GRADIENT_STOPS.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawMediaFrame(context, canvas, media, kind) {
  if (kind !== 'video') {
    drawAudioBackground(context, canvas.width, canvas.height);
    return;
  }
  context.fillStyle = EXPORT_VIDEO_LETTERBOX;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (media.readyState < 2 || !media.videoWidth) return;
  const scale = Math.min(canvas.width / media.videoWidth, canvas.height / media.videoHeight);
  const width = media.videoWidth * scale;
  const height = media.videoHeight * scale;
  context.drawImage(media, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

// Re-record a single audio clip's trimmed range to a fresh audio/webm blob.
async function renderTrimmedAudio(recording, signal) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!canExportAudio()) throw new Error('This browser cannot trim audio');
  const media = document.createElement('audio');
  const url = URL.createObjectURL(recording.blob);
  media.src = url;
  media.preload = 'auto';
  const audioContext = new AudioContextClass();
  const destination = audioContext.createMediaStreamDestination();
  const source = audioContext.createMediaElementSource(media);
  source.connect(destination);
  const mimeType = pickMime(recording.mimeType, AUDIO_MIME_CANDIDATES);
  const chunks = [];
  const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  try {
    throwIfAborted(signal);
    await waitForMediaReady(media);
    const bounds = mediaExportBounds(recording, media.duration);
    await audioContext.resume();
    recorder.start(AUDIO_RECORDER_TIMESLICE_MS);
    await playRange(media, bounds.start, bounds.end, signal);
    const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
    recorder.stop();
    await stopped;
    return new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    source.disconnect();
    destination.stream.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(url);
    await audioContext.close().catch(() => {});
  }
}

// Merge clips (or re-encode a single video clip) into one video/webm via
// canvas.captureStream + AudioContext, playing each trimmed range in sequence.
// `onProgress(index, total)` reports each clip as it starts.
export async function mergeRecordings(clips, { signal, onProgress } = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!canExportVideo()) throw new Error('This browser cannot merge video');

  const sources = clips.map((recording) => {
    const media = document.createElement(recording.kind === 'video' ? 'video' : 'audio');
    const url = URL.createObjectURL(recording.blob);
    media.src = url;
    media.preload = 'auto';
    media.playsInline = true;
    return { recording, media, url };
  });

  const audioContext = new AudioContextClass();
  const audioDestination = audioContext.createMediaStreamDestination();
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_CANVAS_WIDTH;
  canvas.height = EXPORT_CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  const canvasStream = canvas.captureStream(EXPORT_FPS);
  const outputStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);
  const mimeType = pickMime(undefined, VIDEO_MIME_CANDIDATES);
  const chunks = [];
  const recorder = new MediaRecorder(outputStream, mimeType ? { mimeType } : undefined);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  try {
    throwIfAborted(signal);
    await Promise.all(sources.map(({ media }) => waitForMediaReady(media)));
    const firstVideo = sources.find(({ media, recording }) => recording.kind === 'video' && media.videoWidth);
    if (firstVideo) {
      canvas.width = firstVideo.media.videoWidth;
      canvas.height = firstVideo.media.videoHeight;
    }
    await audioContext.resume();
    recorder.start(RECORDER_TIMESLICE_MS);

    for (let index = 0; index < sources.length; index += 1) {
      throwIfAborted(signal);
      const { recording, media } = sources[index];
      onProgress?.(index, sources.length);
      const audioSource = audioContext.createMediaElementSource(media);
      audioSource.connect(audioDestination);
      let drawing = true;
      // captureStream(EXPORT_FPS) samples at 30 fps — drawing at display
      // refresh (up to 120 Hz) burns CPU/GPU on frames the recorder discards.
      const frameInterval = 1000 / EXPORT_FPS;
      let lastDraw = 0;
      const draw = (timestamp = 0) => {
        if (!drawing) return;
        if (!lastDraw || timestamp - lastDraw >= frameInterval - 1) {
          drawMediaFrame(context, canvas, media, recording.kind);
          lastDraw = timestamp;
        }
        requestAnimationFrame(draw);
      };
      draw();
      const bounds = mediaExportBounds(recording, media.duration);
      try {
        await playRange(media, bounds.start, bounds.end, signal);
      } finally {
        drawing = false;
        audioSource.disconnect();
      }
    }

    const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
    recorder.stop();
    await stopped;
    return new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    sources.forEach(({ media, url }) => {
      media.pause();
      media.removeAttribute('src');
      URL.revokeObjectURL(url);
    });
    outputStream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => {});
  }
}

// Produce a trimmed blob for one clip (video → re-encoded via mergeRecordings,
// audio → re-recorded range). Used by "Separate clips" when a trim is applied.
export function renderTrimmedRecording(recording, { signal } = {}) {
  if (recording.kind === 'video') return mergeRecordings([recording], { signal });
  return renderTrimmedAudio(recording, signal);
}

export { AbortError, MIN_TRIM_SECONDS };
