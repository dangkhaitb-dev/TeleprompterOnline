// video-thumbnail.js — grab one representative frame from a video blob as a
// JPEG data URL, using a detached (never-mounted) <video>/<canvas>. Resolves
// null on any failure (unsupported codec, decode error, timeout). Shared by
// the Recordings view and the scene editor — single source of truth.

import {
  THUMB_SEEK_OFFSET,
  THUMB_TIMEOUT_MS,
  THUMB_JPEG_QUALITY,
  THUMB_MAX_WIDTH,
  THUMB_MAX_CONCURRENT,
} from '../constants/media.js';

export function extractVideoThumbnail(blob) {
  return new Promise((resolve) => {
    if (!blob) {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    let settled = false;

    const finish = (dataUrl) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };

    const capture = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null);
        return;
      }
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, THUMB_MAX_WIDTH / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      try {
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', THUMB_JPEG_QUALITY));
      } catch {
        finish(null);
      }
    };

    const timer = setTimeout(() => finish(null), THUMB_TIMEOUT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('error', () => finish(null), { once: true });
    video.addEventListener('seeked', capture, { once: true });
    video.addEventListener('loadeddata', () => {
      // MediaRecorder blobs can report Infinity duration; use a safe fixed offset.
      const target =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(THUMB_SEEK_OFFSET, video.duration / 2)
          : THUMB_SEEK_OFFSET;
      if (target > 0) video.currentTime = target;
      else capture();
    }, { once: true });
    video.src = url;
  });
}

// ---- Cached, concurrency-capped extraction ---------------------------------
// Recording blobs are immutable, so one extraction per recording id is enough
// for the whole session. The queue keeps at most THUMB_MAX_CONCURRENT detached
// <video> decoders alive at a time — a grid of 50 cards otherwise spins up 50
// decoders at once and most of them stall past THUMB_TIMEOUT_MS.
const thumbnailCache = new Map();
let activeExtracts = 0;
const waitingExtracts = [];

function runQueued(job, resolve) {
  activeExtracts += 1;
  // A rejecting (or synchronously throwing) job must still release its slot,
  // or the queue drains to a standstill after a few failures. Failures
  // resolve to null — the same contract extractVideoThumbnail already has.
  Promise.resolve()
    .then(job)
    .then((result) => result, () => null)
    .then((result) => {
      activeExtracts -= 1;
      const next = waitingExtracts.shift();
      if (next) next();
      resolve(result);
    });
}

function enqueueExtract(job) {
  return new Promise((resolve) => {
    if (activeExtracts < THUMB_MAX_CONCURRENT) runQueued(job, resolve);
    else waitingExtracts.push(() => runQueued(job, resolve));
  });
}

// Resolve a thumbnail data URL for a recording, memoized by id. Failures
// (null) are not cached so a later attempt can retry.
export function getVideoThumbnail(id, blob) {
  if (!id) return enqueueExtract(() => extractVideoThumbnail(blob));
  const cached = thumbnailCache.get(id);
  if (cached) return cached;
  const promise = enqueueExtract(() => extractVideoThumbnail(blob));
  thumbnailCache.set(id, promise);
  promise.then((dataUrl) => {
    if (!dataUrl) thumbnailCache.delete(id);
  });
  return promise;
}

// Drop the cached thumbnail for a deleted recording.
export function evictVideoThumbnail(id) {
  if (id) thumbnailCache.delete(id);
}
