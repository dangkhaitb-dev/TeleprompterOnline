// scene-editor.logic.js — orchestration for the post-record editor. No DOM.
// Reads/writes recordings through the store, maps them to scenes via the model,
// and drives export via the media module. Lets errors bubble to the UI layer.

import {
  listByWorkspace,
  updateRecording,
  ensureRecordingBlob,
} from '../../services/recordings.store.js';
import { toScene } from './scene-editor.model.js';

// Ordered scenes for a workspace (oldest → newest = record order).
// The editor plays/exports only the latest recording take.
export async function loadScenes(workspaceId) {
  const recordings = await listByWorkspace(workspaceId);
  if (!recordings.length) return [];

  const latest = recordings[recordings.length - 1];
  const blob = latest.blob || await ensureRecordingBlob(latest);
  return [toScene(blob === latest.blob ? latest : { ...latest, blob })];
}

// Persist a trim (seconds → ms metadata). Never mutates the blob. Returns the
// updated scene (or null if the record vanished).
export async function commitTrim(id, startSec, endSec) {
  const updated = await updateRecording(id, {
    trimStart: Math.round(startSec * 1000),
    trimEnd: Math.round(endSec * 1000),
  });
  return updated ? toScene(updated) : null;
}

// Only scenes that carry a blob are exportable.
export function exportableScenes(scenes) {
  return scenes.filter((scene) => scene && scene.blob);
}

// What the export button should do given the current scene count:
// 'none' (0 clips → toast), 'direct' (1 original blob), 'archive' (≥2 ZIP).
export function exportButtonIntent(scenes) {
  const count = exportableScenes(scenes).length;
  if (!count) return 'none';
  if (count === 1) return 'direct';
  return 'archive';
}
