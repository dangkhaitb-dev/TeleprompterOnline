// export-timing.js — shared timing for ZIP progress UI.

export const MIN_ZIP_PROCESSING_MS = 1000;

export function waitForMinimumZipProcessing(startedAt) {
  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, MIN_ZIP_PROCESSING_MS - elapsed);
  return new Promise((resolve) => setTimeout(resolve, remaining));
}
