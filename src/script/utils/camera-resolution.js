// camera-resolution.js — pure helper for camera recording bitrate.
// The camera runs at its own default mode (getUserMedia `video: true`), so there
// is no user-facing quality tier anymore. The only resolution-dependent step
// left is bitrate: we derive a MediaRecorder videoBitsPerSecond target from the
// dimensions the camera actually produced (read from the live track's
// getSettings()) so footage isn't left at the browser's low default (which
// mushes HD). No DOM — safe to import from logic/ui/components.

// Bitrate reference table, highest → lowest. Maps a captured resolution to a
// MediaRecorder videoBitsPerSecond target.
export const RESOLUTION_LADDER = Object.freeze([
  Object.freeze({ id: '2160p', width: 3840, height: 2160, bitrate: 40_000_000 }),
  Object.freeze({ id: '1440p', width: 2560, height: 1440, bitrate: 16_000_000 }),
  Object.freeze({ id: '1080p', width: 1920, height: 1080, bitrate: 8_000_000 }),
  Object.freeze({ id: '720p', width: 1280, height: 720, bitrate: 5_000_000 }),
  Object.freeze({ id: '480p', width: 854, height: 480, bitrate: 2_500_000 }),
]);

const LOWEST = RESOLUTION_LADDER[RESOLUTION_LADDER.length - 1];

// MediaRecorder videoBitsPerSecond for the resolution the camera actually
// produced. Picks the highest ladder rung whose height fits within the captured
// height; never below the lowest.
export function bitrateForDimensions(width, height) {
  const h = Number(height) || 0;
  const rung = RESOLUTION_LADDER.find((r) => h >= r.height) || LOWEST;
  return rung.bitrate;
}
