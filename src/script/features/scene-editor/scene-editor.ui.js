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
import {
  PREVIEW_FRAME_OFFSET_SECONDS,
  PREVIEW_LOAD_TIMEOUT_MS,
  SAVE_STATUS_TIMEOUT_MS,
  TOAST_TIMEOUT_MS,
} from '../../constants/media.js';
import { waveformSvg } from './components/icons.js';
import { createExportMenu } from './components/export-menu.ui.js';
import { createExportStatusPopup } from '../../components/export-status-popup.js';
import {
  createRecordingsZipArtifact,
  garbageCollectRecordingsZipArtifacts,
} from './media/zip-export.js';
import { waitForMinimumZipProcessing } from '../../utils/export-timing.js';
import { createMediaPlayer } from './components/media-player.ui.js';
import {
  diagnoseMediaPreview,
  formatMediaPreviewDiagnostics,
} from './components/media-preview-diagnostics.js';
import { ensureWebmDuration } from '../../utils/webm-duration.js';
import { createFirstVisitTour } from '../teleprompter/components/first-visit-tour.ui.js';
import { getItem, setItem } from '../../utils/storage.js';
import { LS_SE_FIRST_VISIT_TOUR } from '../../utils/storage-keys.js';

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
      <button class="se-menu-btn" type="button" data-role="menu-toggle" aria-label="Open menu">
        <span class="se-menu-btn-bar"></span>
        <span class="se-menu-btn-bar"></span>
        <span class="se-menu-btn-bar"></span>
      </button>
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
  let tour = null;
  let activeScene = null;
  let previewLoadTimer = null;
  let pendingSaveTimer = null;

  function startTour() {
    if (getItem(LS_SE_FIRST_VISIT_TOUR) === true) return;
    const tourCopy = copy.tour || {
      label: 'Editor quick tour',
      skip: 'Skip',
      exportButton: 'Click Export here to download your recorded video.',
    };
    const exportBtn = exportMenu.el.querySelector('[data-role="export"]');
    if (!exportBtn) return;

    tour = createFirstVisitTour({
      root: root.ownerDocument || document,
      ariaLabel: tourCopy.label,
      skipLabel: tourCopy.skip,
      steps: [
        {
          target: exportBtn,
          text: tourCopy.exportButton,
        },
      ],
      onComplete: () => {
        setItem(LS_SE_FIRST_VISIT_TOUR, true);
      },
    });
    tour.start();
  }

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

  const mediaPlayer = createMediaPlayer({
    signal,
    onPlaybackError: (error, media, stage) => {
      if (media === activeMedia && activeScene) {
        renderPreviewError(activeScene, { error, media, stage });
      }
    },
  });
  viewer.append(mediaPlayer.el);


  // --- viewer render ------------------------------------------------------
  function clearViewer() {
    clearTimeout(previewLoadTimer);
    previewLoadTimer = null;
    if (activeMedia) {
      try {
        mediaPlayer.detachMedia();
        activeMedia.pause();
      } catch { /* detached */ }
    }
    activeMedia = null;
    activeScene = null;
    viewer.classList.remove('has-media-error');
    revokeTrackedUrl(currentUrl, urls);
    currentUrl = null;
    viewer
      .querySelectorAll(
        '.se-viewer-media, .se-audio-preview, .se-empty-preview, .se-media-status',
      )
      .forEach((node) => node.remove());
  }

  function removePreviewStatus() {
    clearTimeout(previewLoadTimer);
    previewLoadTimer = null;
    viewer.classList.remove('has-media-error');
    viewer.querySelector('.se-media-status')?.remove();
  }

  function renderPreviewLoading() {
    removePreviewStatus();
    const status = document.createElement('div');
    status.className = 'se-media-status is-loading';
    status.setAttribute('role', 'status');
    status.innerHTML = `
      <span class="se-saving-spinner" aria-hidden="true"></span>
      <strong>${copy.loadingPreview || 'Preparing preview…'}</strong>`;
    viewer.append(status);
  }

  function renderPreviewError(
    scene,
    { error = null, media = activeMedia, stage = 'unknown' } = {},
  ) {
    if (!scene || scene !== activeScene) return;
    removePreviewStatus();
    try {
      activeMedia?.pause();
    } catch { /* media may not have reached a playable state */ }
    const diagnostics = diagnoseMediaPreview({
      error,
      media,
      blob: scene.blob,
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      stage,
    });
    console.warn('[SceneEditorPreview] playback-failed', diagnostics);
    const status = document.createElement('div');
    status.className = 'se-media-status is-error';
    status.setAttribute('role', 'alert');
    viewer.classList.add('has-media-error');
    status.innerHTML = `
      <strong>${copy.previewErrorTitle || 'Preview could not start'}</strong>
      <p class="se-media-status-message"></p>
      <code class="se-media-status-code"></code>
      <div class="se-media-status-actions">
        <button type="button" class="se-media-status-primary" data-role="preview-retry">
          ${copy.previewRetry || 'Try again'}
        </button>
        <button type="button" class="se-media-status-secondary" data-role="preview-download">
          ${copy.downloadOriginal || 'Download original'}
        </button>
        <button type="button" class="se-media-status-secondary" data-role="preview-copy">
          ${copy.copyDiagnostics || 'Copy diagnostics'}
        </button>
      </div>`;
    status.querySelector('.se-media-status-message').textContent =
      diagnostics.message
      || copy.previewErrorBody
      || 'Try loading it again, or download the original recording.';
    status.querySelector('.se-media-status-code').textContent = diagnostics.code;
    status.querySelector('[data-role="preview-retry"]').addEventListener('click', () => {
      renderViewer(scene);
    }, { signal });
    status.querySelector('[data-role="preview-download"]').addEventListener('click', () => {
      downloadBlob(scene.blob, `solprompter-recording.${fileExtension(scene)}`);
    }, { signal });
    status.querySelector('[data-role="preview-copy"]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(formatMediaPreviewDiagnostics(diagnostics));
        showToast(copy.diagnosticsCopied || 'Preview diagnostics copied');
      } catch {
        showToast(copy.diagnosticsCopyFailed || `Preview error: ${diagnostics.code}`);
      }
    }, { signal });
    viewer.append(status);
  }

  function prepareVideoPreview(video, scene) {
    renderPreviewLoading();
    let primed = false;

    const markReady = () => {
      if (video !== activeMedia) return;
      removePreviewStatus();
    };
    const markFailed = () => {
      if (video !== activeMedia) return;
      const error = new Error('Video preview timed out');
      error.name = 'TimeoutError';
      renderPreviewError(scene, { error, media: video, stage: 'load-timeout' });
    };
    video.addEventListener('loadedmetadata', () => {
      if (video !== activeMedia || primed) return;
      primed = true;
      const duration = Number(video.duration);
      const target = Number.isFinite(duration) && duration > 0
        ? Math.min(PREVIEW_FRAME_OFFSET_SECONDS, duration / 2)
        : PREVIEW_FRAME_OFFSET_SECONDS;
      try {
        video.currentTime = target;
      } catch {
        // loadeddata/canplay may still provide a frame without the small seek.
      }
    }, { once: true, signal });
    video.addEventListener('loadeddata', markReady, { once: true, signal });
    video.addEventListener('canplay', markReady, { once: true, signal });
    previewLoadTimer = setTimeout(markFailed, PREVIEW_LOAD_TIMEOUT_MS);
    try {
      video.load();
    } catch (error) {
      renderPreviewError(scene, { error, media: video, stage: 'load-call' });
    }
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
    activeScene = scene;
    currentUrl = createTrackedUrl(scene.blob, urls);
    if (scene.kind === 'video') {
      const video = document.createElement('video');
      video.className = 'se-viewer-media';
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'auto';
      video.controls = false;
      video.src = currentUrl;
      viewer.prepend(video);
      activeMedia = video;
      mediaPlayer.attachMedia(video, scene.duration / 1000);
      prepareVideoPreview(video, scene);
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

  function renderSaveFailure(message, onRetry) {
    clearViewer();
    mediaPlayer.el.style.display = 'none';
    const status = document.createElement('div');
    status.className = 'se-media-status is-error';
    status.setAttribute('role', 'alert');
    const title = document.createElement('strong');
    title.textContent = copy.loadError || 'The recording could not be loaded.';
    const body = document.createElement('p');
    body.textContent = message || copy.saveError || 'The recording may still be saving. Try again.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'se-media-status-primary';
    retry.textContent = copy.retry || 'Try again';
    retry.addEventListener('click', () => onRetry?.(), { signal });
    status.append(title, body, retry);
    viewer.append(status);
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

  // --- mobile drawer ------------------------------------------------------
  const menuToggle = q('menu-toggle');

  if (menuToggle) {
    const mobileSidebar = document.getElementById('mobileSidebar');
    const mobileSidebarOverlay = document.getElementById('mobileSidebarOverlay');
    if (mobileSidebar && mobileSidebarOverlay) {
      const openDrawer = () => {
        mobileSidebar.removeAttribute('hidden');
        requestAnimationFrame(() => {
          mobileSidebar.classList.add('is-open');
        });
        mobileSidebarOverlay.removeAttribute('hidden');
        requestAnimationFrame(() => {
          mobileSidebarOverlay.classList.add('is-open');
        });
      };
      menuToggle.addEventListener('click', openDrawer, { signal });
    }
  }

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
    pendingSaveTimer = setTimeout(() => {
      if (signal.aborted || settled) return;
      renderSaveFailure(
        copy.savingDelayed || 'Saving is taking longer than expected. Your recording is still being finalized.',
        () => renderSavingViewer(),
      );
    }, SAVE_STATUS_TIMEOUT_MS);
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
        clearTimeout(pendingSaveTimer);
        pendingSaveTimer = null;
        if (signal.aborted) return undefined;
        if (!saved) showToast(copy.saveError || 'Recording could not be saved');
        // reload() selects the newest scene — the clip that just saved.
        return reload();
      })
      .then(() => {
        if (!signal.aborted && scenes.length > 0) {
          startTour();
        }
      })
      .catch((error) => {
        clearTimeout(pendingSaveTimer);
        pendingSaveTimer = null;
        if (signal.aborted) return;
        renderSaveFailure(
          error?.message || copy.saveError || 'The recording may have been saved, but it could not be loaded yet.',
          function retryLoad() {
            renderSavingViewer();
            loadScenes(workspaceId)
              .then((loaded) => {
                if (signal.aborted) return;
                scenes = loaded;
                if (scenes.length) selectScene(scenes.length - 1);
                else renderViewer(null);
              })
              .catch((retryError) => {
                if (!signal.aborted) renderSaveFailure(retryError?.message, retryLoad);
              });
          },
        );
      });
  } else {
    await reload();
    if (scenes.length > 0) {
      startTour();
    }
  }

  // --- teardown -----------------------------------------------------------
  return function teardown() {
    ac.abort();
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
    if (tour) {
      tour.destroy();
      tour = null;
    }
    discardArchive();
    clearTimeout(toastTimer);
    clearTimeout(previewLoadTimer);
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
