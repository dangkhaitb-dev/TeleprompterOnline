// Scene-editor adapter for the shared streaming ZIP utility. This feature owns
// recording-specific validation and filenames; chunking/OPFS lives in utils.

import { fileExtension } from '../scene-editor.model.js';
import {
  createStreamingZip,
  createStreamingZipArtifact,
  garbageCollectStreamingZipArtifacts,
  MAX_IN_MEMORY_ZIP_BYTES,
  ZipAbortError,
  ZipStorageError,
} from '../../../utils/streaming-zip.js';
import { ensureWebmDuration } from '../../../utils/webm-duration.js';

export { MAX_IN_MEMORY_ZIP_BYTES };
export { ZipAbortError as ZipExportAbortError };

export class ZipExportStorageError extends ZipStorageError {
  constructor() {
    super();
    this.name = 'ZipExportStorageError';
  }
}

async function recordingEntries(scenes = []) {
  const entries = [];
  const available = scenes.filter((scene) => scene?.blob);
  for (const [index, scene] of available.entries()) {
    const blob = scene.durationMetadataFixed
      ? scene.blob
      : await ensureWebmDuration(scene.blob, scene.duration);
    entries.push({
      blob,
      name: `solprompter-clip-${String(index + 1).padStart(2, '0')}.${fileExtension(scene)}`,
    });
  }
  return entries;
}

function requireMultiple(entries) {
  if (entries.length < 2) throw new Error('At least two recordings are required');
}

export async function createRecordingsZip(scenes, options = {}) {
  const entries = await recordingEntries(scenes);
  requireMultiple(entries);
  return createStreamingZip(entries, options);
}

export async function createRecordingsZipArtifact(scenes, options = {}) {
  const entries = await recordingEntries(scenes);
  requireMultiple(entries);
  try {
    return await createStreamingZipArtifact(entries, options);
  } catch (error) {
    if (error?.name === 'ZipStorageError') throw new ZipExportStorageError();
    throw error;
  }
}

export const garbageCollectRecordingsZipArtifacts = garbageCollectStreamingZipArtifacts;
