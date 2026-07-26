// thumbnails.js — offscreen video frame extraction for the trim frame strip.
// Constructs DETACHED <video>/<canvas> (never mounted into the page), so it
// lives outside the .ui.js layer but still touches DOM. Callers guard late
// resolves with a token (see isCurrent). Single-frame thumbnails come from the
// shared components/video-thumbnail.js.

import { waitForMediaReady, seekMedia } from './media-element.js';

// Extract `frameCount` evenly spaced frames as an array of JPEG data URLs.
// `isCurrent()` is checked between frames so a teardown/scene-switch aborts.
// Resolves [] on failure.
export async function extractVideoFrames(blob, frameCount, fallbackDuration, isCurrent = () => true) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  const frames = [];
  try {
    await waitForMediaReady(video);
    const duration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : fallbackDuration;
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 102;
    const context = canvas.getContext('2d');
    for (let index = 0; index < frameCount; index += 1) {
      if (!isCurrent()) return frames;
      const sampleTime = ((index + 0.5) / frameCount) * duration;
      await seekMedia(video, Math.min(Math.max(0, duration - 0.02), sampleTime));
      if (!isCurrent()) return frames;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.72));
    }
    return frames;
  } catch {
    return frames;
  } finally {
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
