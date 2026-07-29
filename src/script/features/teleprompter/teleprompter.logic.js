// teleprompter.logic.js — orchestration for the record view. No DOM here.
// Wraps the workspace store and owns the MediaRecorder lifecycle (the "FSM"),
// exposing a small callback-driven API the UI layer drives.

import {
  createWorkspace as createWorkspaceRecord,
  getWorkspace,
  updateWorkspace,
  updateWorkspaceSettings,
} from '../../services/workspaces.store.js';
import {
  putRecording,
  removeRecordings,
  listAllRecordings,
} from '../../services/recordings.store.js';
import { isRecordingSaveEnabled } from '../../services/recording-prefs.store.js';
export {
  isStorageWarningEnabled,
  setStorageWarningEnabled,
} from '../../services/storage-warning-prefs.store.js';
import { getCaptureStream, stopStream } from '../../utils/media.js';
import { bitrateForDimensions } from '../../utils/camera-resolution.js';
import { getItem, setItem } from '../../utils/storage.js';
import { LS_GLOBAL_SETTING_PROMPTER } from '../../utils/storage-keys.js';
import { createOPFSWriter, isOPFSSupported } from '../../utils/opfs-writer.js';
import { makeId } from '../../utils/id.js';
import { ensureWebmDuration, isWebmMedia } from '../../utils/webm-duration.js';
import {
  recordingKind,
  recordingMimeType,
  computeDuration,
  normalizeSettings,
} from './teleprompter.model.js';

// Fetch a workspace by id. Returns the workspace or null. Kept in logic so the
// UI/entry never import the store directly (layer rule).
export function loadWorkspace(id) {
  if (!id) return null;
  return getWorkspace(id);
}

// Create a fresh, empty workspace for a scratch session — the teleprompter opened
// with no ?ws= (or a stale/deleted id). Persisted like any saved script so it
// survives a reload and appears on the home list. Kept in logic so the entry
// never imports the store directly (layer rule).
export function createScratchWorkspace() {
  return createWorkspaceRecord();
}

// Persist edited script back to the workspace: `text` (plain, for card snippets)
// and `html` (rich innerHTML, preserves inline formatting). Bumps updatedAt — a
// content edit, unlike settings. Keeps storage out of the UI.
// Tolerates a bare string (legacy caller: plain text only, no rich html).
export function saveWorkspaceScript(id, script) {
  if (!id) return;
  const { text = '', html = '' } =
    typeof script === 'string' ? { text: script } : (script || {});
  updateWorkspace(id, { scriptText: text, scriptHtml: html });
}

// The ONE global store of "last-used" studio settings. A brand-new script (no
// settings of its own yet) inherits these; existing scripts use their own.
export function loadGlobalSettings() {
  return normalizeSettings(getItem(LS_GLOBAL_SETTING_PROMPTER));
}

// Base settings for a script that has none of its own yet: the global last-used
// settings, EXCEPT text color and underline. A brand-new script always starts
// with theme-driven text color and underline off instead of inheriting either
// formatting choice from the previous script. Saved scripts keep their own
// color and underline untouched.
function newScriptSettings() {
  return { ...loadGlobalSettings(), color: '', underline: false };
}

// Settings to apply when the studio opens a workspace: the script's own if it
// has any, otherwise the global last-used defaults (with color reset to
// theme-driven and underline reset to off for a fresh script).
export function resolveInitialSettings(workspace) {
  const own = workspace && workspace.settings;
  if (own && Object.keys(own).length > 0) return normalizeSettings(own);
  return newScriptSettings();
}

// Merge a partial settings patch into the workspace's per-script settings and
// persist it (normalised, without bumping updatedAt). Also mirrors the merged
// result into the ONE global last-used store so future new scripts inherit it.
// Returns the saved settings.
export function saveWorkspaceSettings(id, patch = {}) {
  if (!id) return null;
  const own = getWorkspace(id)?.settings;
  // A brand-new workspace has an empty settings object and is rendered from
  // newScriptSettings() (global last-used, color reset to theme-driven and
  // underline reset to off). Use that SAME resolved state as the base for its
  // first change, otherwise untouched defaults shown to the user would reset.
  const current = own && Object.keys(own).length > 0 ? own : newScriptSettings();
  const next = normalizeSettings({ ...current, ...patch });
  updateWorkspaceSettings(id, next);
  setItem(LS_GLOBAL_SETTING_PROMPTER, next);
  return next;
}

const TIMESLICE_MS = 250;

// States: 'idle' → 'recording' ⇄ 'paused' → 'saving' → 'idle'
export function createRecordingController({ onError } = {}) {
  let state = 'idle';
  let mediaRecorder = null;
  let stream = null;
  // Fallback: keep chunks in RAM when OPFS is unavailable.
  let chunks = [];
  // OPFS streaming writer — used when isOPFSSupported() is true.
  let opfsWriter = null;
  let opfsWriteFailed = false;
  let hasVideo = false;
  let mimeType = '';

  let accumulatedMs = 0;
  let startedAt = 0;

  const notifyError = (err) => {
    if (typeof onError === 'function') onError(err);
  };

  const releaseStream = () => {
    stopStream(stream);
    stream = null;
  };

  // Begin capture + recording. `wantsVideo`/`wantsAudio` come from the toolbar
  // toggles. Rejects (and rolls nothing forward) if capture is denied so the UI
  // can restore its pre-record state. Returns { hasVideo, stream }.
  async function start({
    wantsVideo = false,
    wantsAudio = true,
    videoDeviceId = '',
    audioDeviceId = '',
  } = {}) {
    if (state !== 'idle') return null;

    // Cam-off with mic-off would capture nothing — force audio on in that case.
    const audioEnabled = wantsVideo ? wantsAudio : true;
    // Record at the camera's own default mode (like a normal video app): no
    // resolution/aspect constraints, just the selected device. Bitrate is tuned
    // below from the dimensions the camera actually produced.
    let video = wantsVideo;
    if (wantsVideo) {
      video = videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true;
    }
    const audio = audioEnabled && audioDeviceId
      ? { deviceId: { exact: audioDeviceId } }
      : audioEnabled;
    stream = await getCaptureStream({ video, audio });

    hasVideo = stream.getVideoTracks().length > 0;
    mimeType = recordingMimeType(hasVideo);
    chunks = [];
    opfsWriter = null;
    opfsWriteFailed = false;

    // Try to open an OPFS writer for zero-RAM streaming. Fall back silently.
    if (isOPFSSupported()) {
      try {
        const filename = `${makeId('rec')}.webm`;
        opfsWriter = await createOPFSWriter(filename);
      } catch {
        opfsWriter = null; // OPFS failed — use RAM fallback
      }
    }

    try {
      // Raise the bitrate to match the resolution the camera actually produced
      // (not the requested tier — `ideal` may have downshifted). The MediaRecorder
      // default is low and re-compresses HD footage into mush.
      const recorderOptions = {};
      if (mimeType) recorderOptions.mimeType = mimeType;
      if (hasVideo) {
        const { width, height } = stream.getVideoTracks()[0].getSettings();
        recorderOptions.videoBitsPerSecond = bitrateForDimensions(width, height);
      }
      mediaRecorder = Object.keys(recorderOptions).length
        ? new MediaRecorder(stream, recorderOptions)
        : new MediaRecorder(stream);
    } catch (err) {
      releaseStream();
      if (opfsWriter) { opfsWriter.abort().catch(() => {}); opfsWriter = null; }
      throw err;
    }

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (!event.data || !event.data.size) return;
      if (opfsWriter && !opfsWriteFailed) {
        // Stream chunk to disk — fire-and-forget (errors also surface at finish()).
        opfsWriter.write(event.data).catch((err) => {
          // OPFS writables only commit on close(), so after a failed write the
          // already-written prefix is unrecoverable — and later chunks alone
          // are a headerless, unplayable suffix. Stop collecting and surface
          // the failure now so the UI can end the doomed session immediately.
          opfsWriteFailed = true;
          notifyError(err);
        });
      } else if (!opfsWriteFailed) {
        chunks.push(event.data);
      }
    });

    mediaRecorder.start(TIMESLICE_MS);
    state = 'recording';
    accumulatedMs = 0;
    startedAt = Date.now();
    return { hasVideo, stream };
  }

  function pause() {
    if (state !== 'recording') return;
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause();
    accumulatedMs += Math.max(0, Date.now() - startedAt);
    startedAt = 0;
    state = 'paused';
  }

  function resume() {
    if (state !== 'paused') return;
    if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume();
    startedAt = Date.now();
    state = 'recording';
  }

  // Stop + persist. Resolves with the saved record (or null on failure). The UI
  // then swaps to the review panel using record.blob.
  function stop({ workspaceId } = {}) {
    if (state !== 'recording' && state !== 'paused') return Promise.resolve(null);
    const wasPaused = state === 'paused';
    state = 'saving';

    return new Promise((resolve) => {
      const finalize = async () => {
        const duration = computeDuration({
          accumulatedMs,
          startedAt,
          now: Date.now(),
          paused: wasPaused,
        });
        const type = (mediaRecorder && mediaRecorder.mimeType) || mimeType || '';

        // Build the final Blob — from OPFS file (zero RAM) or from the in-RAM
        // chunks[] fallback, depending on what was available when recording started.
        let blob;
        // Hand the writer off to this finalize pass before any await.
        const writer = opfsWriter;
        opfsWriter = null;
        if (writer) {
          try {
            // keepLock: the returned File is backed by the OPFS temp file until
            // its bytes are committed to IndexedDB below. Holding the vp:rec:
            // lock through that copy keeps startup GC in another tab from
            // deleting the file mid-copy.
            blob = await writer.finish(type, { keepLock: true });
          } catch (err) {
            // A failed OPFS write chain cannot guarantee that its already-written
            // prefix is readable (OPFS commits only on close()). Never silently
            // save a valid-looking but truncated recording.
            await writer.abort().catch(() => {});
            chunks = [];
            releaseStream();
            state = 'idle';
            notifyError(err);
            resolve(null);
            return;
          }
        } else {
          blob = new Blob(chunks, type ? { type } : undefined);
        }
        chunks = [];

        releaseStream();
        // Chrome MediaRecorder produces a streaming WebM with no EBML Duration
        // field. The packets are complete, but downloaded files otherwise show
        // Infinity/a truncated seek bar. Repair the container before IndexedDB
        // owns it so preview, direct download and ZIP export all share the same
        // seekable artifact.
        const recordedBlob = blob;
        blob = await ensureWebmDuration(blob, duration);
        const recordFields = {
          workspaceId: workspaceId || null,
          kind: recordingKind(hasVideo),
          mimeType: blob.type || type,
          duration,
          durationMetadataFixed: !isWebmMedia(recordedBlob) || blob !== recordedBlob,
          temporary: !isRecordingSaveEnabled(),
        };
        let record = null;
        try {
          // WebKit can fail to structured-clone a file-backed File (the OPFS
          // path on iOS 26+) into IndexedDB; putRecording handles that with a
          // single-copy bytes fallback internally — it must run before
          // writer.abort() below deletes the OPFS backing file.
          record = await putRecording({ ...recordFields, blob });
        } catch (err) {
          notifyError(err);
        }
        // IndexedDB now owns all the bytes (or the save failed and nothing
        // references them). abort() deletes the OPFS temp file AND releases its
        // lock, so any rec-* file that survives without a lock is always a
        // crash orphan for startup GC.
        if (writer) await writer.abort().catch(() => {});
        state = 'idle';
        resolve(record);
      };

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.addEventListener('stop', finalize, { once: true });
        mediaRecorder.stop();
      } else {
        finalize();
      }
    });
  }

  // Abort without saving (used when capture never started, e.g. permission
  // denied mid-countdown, or on teardown).
  function cancel() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch {}
    }
    mediaRecorder = null;
    chunks = [];
    // Discard any OPFS temp file.
    if (opfsWriter) {
      opfsWriter.abort().catch(() => {});
      opfsWriter = null;
    }
    releaseStream();
    accumulatedMs = 0;
    startedAt = 0;
    state = 'idle';
  }

  return {
    start,
    pause,
    resume,
    stop,
    cancel,
    getState: () => state,
    getElapsed: () =>
      computeDuration({ accumulatedMs, startedAt, now: Date.now(), paused: state === 'paused' }),
    isRecording: () => state === 'recording',
    isPaused: () => state === 'paused',
  };
}

// ── OPFS Garbage Collector ────────────────────────────────────────────────────
//
// OPFS temp files (rec-*.webm) are created when recording starts.
// Under the normal flow, each file is deleted immediately after its bytes are
// successfully written to IndexedDB (or immediately if save is disabled).
//
// Therefore, any rec-* file found in OPFS at startup time is by definition an
// orphan from a crashed / force-killed session and is safe to delete.
//
// Multi-Tab Safety (Critical Concurrency Control):
// To prevent Tab B from deleting an active recording from Tab A (since Tab A
// won't have saved it to IndexedDB yet), we try to acquire the exclusive lock 
// `vp:rec:${name}` using `{ ifAvailable: true }`. If the lock is held by another
// tab, we skip the file entirely.
//
// Returns the number of orphan files deleted.
export async function opfsGarbageCollect() {
  if (!isOPFSSupported()) return 0;
  try {
    const root = await navigator.storage.getDirectory();
    let deleted = 0;
    for await (const [name] of root.entries()) {
      if (typeof name === 'string' && name.startsWith('rec-')) {
        // Try to acquire the lock for this specific file.
        // If it's already locked by another tab that is actively recording,
        // request will immediately return null and we skip deletion.
        const cleaned = await new Promise((resolve) => {
          if (typeof navigator === 'undefined' || !navigator.locks) {
            // Fallback if locks API is unavailable (very rare on modern browsers supporting OPFS)
            resolve(false); 
            return;
          }
          navigator.locks.request(`vp:rec:${name}`, { ifAvailable: true }, async (lock) => {
            if (!lock) {
              resolve(false); // Held by another tab, skip
              return;
            }
            try {
              await root.removeEntry(name);
              resolve(true);
            } catch {
              resolve(false);
            }
          }).catch(() => resolve(false));
        });

        if (cleaned) {
          deleted += 1;
        }
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}

// ── IndexedDB Garbage Collector ──────────────────────────────────────────────
//
// Finds all recordings tagged with `temporary: true` across ALL workspaces in
// IndexedDB. For each unique workspace, it tries to obtain the Web Lock
// `vp:ws:${workspaceId}`. If the lock is acquired, it means no tabs are currently
// editing that workspace (the session has ended or crashed), and it deletes those
// temporary recordings from IndexedDB.
//
// Returns the number of temporary recordings deleted.
export async function indexedDbGarbageCollect() {
  try {
    const records = await listAllRecordings();
    const tempRecords = records.filter((r) => !!r.temporary);
    if (tempRecords.length === 0) return 0;

    // Group temporary records by workspaceId. A Map also safely handles any
    // externally-imported id that happens to match an Object prototype key.
    const groups = new Map();
    for (const r of tempRecords) {
      if (r.workspaceId) {
        if (!groups.has(r.workspaceId)) groups.set(r.workspaceId, []);
        groups.get(r.workspaceId).push(r);
      }
    }

    let deleted = 0;
    for (const [workspaceId, workspaceRecords] of groups) {
      // Try to acquire the workspace lock. If it's locked, an active session exists.
      const cleaned = await new Promise((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.locks) {
          resolve(false);
          return;
        }
        navigator.locks.request(`vp:ws:${workspaceId}`, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false); // Active tab open on this workspace, skip
            return;
          }
          try {
            await removeRecordings(workspaceRecords.map((record) => record.id));
            resolve(true);
          } catch {
            resolve(false);
          }
        }).catch(() => resolve(false));
      });

      if (cleaned) {
        deleted += workspaceRecords.length;
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}
