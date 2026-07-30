// scene-editor.ui.js — the post-record editor, mounted IN-PLACE into the
// teleprompter page (no navigation). The only public entry is mountSceneEditor:
// it builds the shell DOM, instantiates the trim/export/scene-list components,
// loads the workspace's recordings, wires everything through one AbortController,
// and returns a leak-free teardown().

import '../../../styles/scene-editor.css';
import '../../../styles/components/back-btn.css';
import '../../../styles/components/confirm-popup.css';
import '../../../styles/components/export-status-popup.css';
import {
  loadScenes, exportableScenes, exportButtonIntent,
} from './scene-editor.logic.js';
import { fileExtension, formatDuration } from './scene-editor.model.js';
import { createTrackedUrl, revokeTrackedUrl, revokeAll, downloadBlob } from '../../utils/download.js';
import { exitFullscreen } from '../../utils/fullscreen.js';
import { TOAST_TIMEOUT_MS } from '../../constants/media.js';
import { waveformSvg } from './components/icons.js';
import { createExportMenu } from './components/export-menu.ui.js';
import { createExportStatusPopup } from '../../components/export-status-popup.js';
import {
  createRecordingsZipArtifact,
  garbageCollectRecordingsZipArtifacts,
} from './media/zip-export.js';
import { waitForMinimumZipProcessing } from '../../utils/export-timing.js';
import { createMediaPlayer } from './components/media-player.ui.js';
import { ensureWebmDuration } from '../../utils/webm-duration.js';

function shellTemplate(copy) {
  return `
  <div class="se" data-analytics-page="scene-editor">
    <header class="se-header">
      <div class="se-header-left">
        <button class="se-logo-btn brand" type="button" data-role="logo" aria-label="${copy.logoAria || 'Logo'}" style="display: inline-flex; align-items: center; gap: 0.5rem; background: none; border: none; padding: 0; cursor: pointer; text-decoration: none;">
          <span class="shared-brand-logo" style="width: 22px; height: 22px; display: block;">
            <img src="/logo.webp" alt="SolPrompter logo" width="22" height="22">
          </span>
          <span class="shared-brand-text">SolPrompter</span>
        </button>
      </div>
      <div class="se-header-actions" data-role="header-actions"></div>
    </header>
    <main class="se-workspace">
      <div class="se-preview-stage">
        <section class="se-viewer" data-role="viewer" aria-label="${copy.preview || 'Media preview'}">
        </section>
      </div>
    </main>
    <div class="se-toast" data-role="toast" role="status" aria-live="polite"></div>
  </div>`;
}

export async function mountSceneEditor(container, opts = {}) {
  garbageCollectRecordingsZipArtifacts().catch(() => {});
  const { workspaceId, onRecordScene, copy = {}, pendingSave } = opts;
  const ac = new AbortController();
  const { signal } = ac;
  const urls = new Set();
  let currentUrl = null;
  let toastTimer = null;
  let scenes = [];
  let activeMedia = null;
  let exporting = false;
  let archiveArtifact = null;
  let exportCancel = null;

  const discardArchive = () => {
    const artifact = archiveArtifact;
    archiveArtifact = null;
    artifact?.cleanup?.().catch((error) => {
      console.warn('Failed to remove temporary ZIP', error);
    });
  };

  container.innerHTML = shellTemplate(copy);
  const root = container.querySelector('.se');
  const q = (role) => root.querySelector(`[data-role="${role}"]`);
  const viewer = q('viewer');
  const toastEl = q('toast');

  // --- toast --------------------------------------------------------------
  const showToast = (message) => {
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), TOAST_TIMEOUT_MS);
  };

  // --- components ---------------------------------------------------------
  const exportMenu = createExportMenu({
    signal,
    labels: copy,
    getIntent: () => exportButtonIntent(scenes),
    onDirect: handleExportOriginal,
    onArchive: handleExportArchive,
    onEmpty: () => showToast(copy.noExport || 'No video to export'),
  });
  q('header-actions').append(exportMenu.el);

  const exportStatus = createExportStatusPopup({
    labels: copy,
    onDownload: () => {
      if (archiveArtifact?.blob) {
        downloadBlob(archiveArtifact.blob, 'solprompter-recordings.zip');
      }
    },
    onRetry: () => handleExportArchive(),
    onClose: discardArchive,
    onCancel: () => exportCancel?.abort(),
  });
  root.append(exportStatus.el);

  const mediaPlayer = createMediaPlayer({ signal });
  viewer.append(mediaPlayer.el);


  // --- viewer render ------------------------------------------------------
  function clearViewer() {
    if (activeMedia) {
      try {
        mediaPlayer.detachMedia();
        activeMedia.pause();
      } catch { /* detached */ }
    }
    activeMedia = null;
    revokeTrackedUrl(currentUrl, urls);
    currentUrl = null;
    viewer.querySelectorAll('.se-viewer-media, .se-audio-preview, .se-empty-preview').forEach((n) => n.remove());
  }

  function renderViewer(scene) {
    clearViewer();
    if (!scene || !scene.blob) {
      const empty = document.createElement('div');
      empty.className = 'se-empty-preview';
      empty.innerHTML = `
        ${waveformSvg()}
        <strong>${copy.noRecording || 'No recording yet'}</strong>
        <button type="button" class="se-empty-record" data-role="empty-record">
          <span class="se-record-dot"></span><span>${copy.record || 'Record'}</span>
        </button>`;
      empty.querySelector('[data-role="empty-record"]').addEventListener('click', () => {
        if (typeof onRecordScene === 'function') onRecordScene();
      }, { signal });
      viewer.prepend(empty);
      mediaPlayer.el.style.display = 'none';
      return;
    }

    mediaPlayer.el.style.display = 'flex';
    currentUrl = createTrackedUrl(scene.blob, urls);
    if (scene.kind === 'video') {
      const video = document.createElement('video');
      video.className = 'se-viewer-media';
      video.src = currentUrl;
      video.playsInline = true;
      video.preload = 'metadata';
      video.controls = false;
      viewer.prepend(video);
      activeMedia = video;
      mediaPlayer.attachMedia(video, scene.duration / 1000);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'se-audio-preview';
      wrap.innerHTML = `
        <div class="se-audio-art">
          <span class="se-audio-kicker">${copy.audioRecording || 'Audio recording'}</span>
          ${waveformSvg()}
          <strong>${copy.voiceRecording || 'Voice recording'}</strong>
          <span class="se-audio-duration">${formatDuration(scene.duration)}</span>
        </div>`;
      const audio = document.createElement('audio');
      audio.className = 'se-viewer-media se-audio-player';
      audio.src = currentUrl;
      audio.preload = 'metadata';
      audio.controls = false;
      audio.playsInline = true;
      wrap.append(audio);
      viewer.prepend(wrap);
      activeMedia = audio;
      mediaPlayer.attachMedia(audio, scene.duration / 1000);
    }
  }

  // Placeholder while a just-stopped recording is still being persisted — the
  // editor opens immediately and swaps in the real clip once the save settles.
  // The element carries .se-empty-preview so clearViewer() removes it too.
  function renderSavingViewer() {
    clearViewer();
    const saving = document.createElement('div');
    saving.className = 'se-empty-preview se-saving-preview';
    saving.innerHTML = `
      <span class="se-saving-spinner" aria-hidden="true"></span>
      <strong>${copy.saving || 'Saving recording…'}</strong>`;
    viewer.prepend(saving);
    mediaPlayer.el.style.display = 'none';
  }

  // --- selection / mutation ----------------------------------------------
  function selectScene(index) {
    if (index < 0 || index >= scenes.length) return;
    renderViewer(scenes[index]);
  }

  async function reload(preferIndex) {
    scenes = await loadScenes(workspaceId);
    if (!scenes.length) {
      renderViewer(null);
      return;
    }
    const next = Math.min(preferIndex ?? scenes.length - 1, scenes.length - 1);
    selectScene(Math.max(0, next));
  }

  // --- export -------------------------------------------------------------
  async function handleExportOriginal() {
    if (exporting) return;
    const [scene] = exportableScenes(scenes);
    if (!scene) { showToast(copy.noExport || 'No video to export'); return; }
    exporting = true;
    exportMenu.setBusy(true, copy.preparingExport || 'Preparing…');
    try {
      const blob = scene.durationMetadataFixed
        ? scene.blob
        : await ensureWebmDuration(scene.blob, scene.duration);
      downloadBlob(blob, `solprompter-recording.${fileExtension(scene)}`);
    } finally {
      exporting = false;
      exportMenu.setBusy(false);
    }
  }

  async function handleExportArchive() {
    if (exporting) return;
    const clips = exportableScenes(scenes);
    if (clips.length < 2) { handleExportOriginal(); return; }
    exporting = true;
    discardArchive();
    // Per-export controller so the popup's X cancels only this ZIP; still
    // forward the component signal so teardown aborts an in-flight export.
    exportCancel = new AbortController();
    if (signal.aborted) exportCancel.abort();
    else signal.addEventListener('abort', () => exportCancel?.abort(), { once: true });
    exportMenu.setBusy(true, copy.zipping || 'Creating ZIP…');
    exportStatus.openProcessing(clips.length);
    const processingStartedAt = Date.now();
    try {
      archiveArtifact = await createRecordingsZipArtifact(clips, {
        signal: exportCancel.signal,
        onProgress: exportStatus.updateProgress,
      });
      await waitForMinimumZipProcessing(processingStartedAt);
      exportStatus.setSuccess();
    } catch (error) {
      if (error.name !== 'AbortError') {
      await waitForMinimumZipProcessing(processingStartedAt);
        console.error('Failed to create recordings ZIP', error);
        const message = error.name === 'ZipExportStorageError'
          ? (copy.zipTooLargeForBrowser
            || 'This ZIP is too large for this browser to create safely. Use a browser with disk-backed storage support.')
          : undefined;
        exportStatus.setError(message);
      }
    } finally {
      exporting = false;
      exportMenu.setBusy(false);
    }
  }

  // --- shell events -------------------------------------------------------
  q('logo').addEventListener('click', (e) => {
    e.preventDefault();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && (fsEl === viewer || viewer.contains(fsEl))) {
      exitFullscreen().catch(() => {});
    }
    window.location.href = '/workspaces';
  }, { signal });

  if (pendingSave) {
    // The recording that just stopped is still being persisted. Open the editor
    // IMMEDIATELY — render the saving placeholder and an empty list now, without
    // awaiting anything, so the view swaps the instant the user stops. Reading
    // the whole workspace back from IndexedDB (slow on WebKit, which reloads
    // every prior take's bytes) happens in the background below.
    renderSavingViewer();
    // `settled` hands ownership of `scenes` to reload() once the save resolves,
    // so a late prior-takes load can never clobber the final list (which
    // includes the new clip).
    let settled = false;
    loadScenes(workspaceId)
      .then((loaded) => {
        if (signal.aborted || settled) return;
        scenes = loaded;
      })
      .catch(() => {});
    pendingSave
      .then((record) => !!(record && record.blob), () => false)
      .then((saved) => {
        settled = true;
        if (signal.aborted) return undefined;
        if (!saved) showToast(copy.saveError || 'Recording could not be saved');
        // reload() selects the newest scene — the clip that just saved.
        return reload();
      })
      .catch(() => {});
  } else {
    await reload();
  }

  // --- teardown -----------------------------------------------------------
  return function teardown() {
    ac.abort();
    discardArchive();
    clearTimeout(toastTimer);
    if (activeMedia) {
      try {
        mediaPlayer.detachMedia();
        activeMedia.pause();
      } catch { /* detached */ }
    }
    mediaPlayer.destroy();
    activeMedia = null;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && (fsEl === viewer || viewer.contains(fsEl))) {
      exitFullscreen().catch(() => {});
    }
    revokeAll(urls);
    currentUrl = null;
    container.replaceChildren();
  };
}
