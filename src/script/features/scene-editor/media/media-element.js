// media-element.js — shared readiness/seek helpers for detached <video>/<audio>
// elements, used by both thumbnails.js and media-export.js. Touches media
// elements (not the page DOM), so it lives outside the .ui.js layer.

import { SEEK_TIMEOUT_MS } from '../../../constants/media.js';

// Wait for a media element to reach seek-capable state.
export function waitForMediaReady(media) {
  return new Promise((resolve, reject) => {
    if (media.readyState >= 1) return resolve();
    media.addEventListener('loadedmetadata', resolve, { once: true });
    media.addEventListener('error', () => reject(new Error('Cannot read clip')), { once: true });
  });
}

// Seek with a safety timeout — resolve even if "seeked" never fires.
export function seekMedia(media, time) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    media.addEventListener('seeked', done, { once: true });
    media.currentTime = time;
    const timer = setTimeout(done, SEEK_TIMEOUT_MS);
  });
}
