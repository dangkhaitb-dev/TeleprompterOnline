// workspaces.ui.js — DOM wiring for the Workspaces library (the only layer that
// touches the DOM). Reads copy from the inert #wsCopy JSON block and talks to
// the store only through workspaces.logic. Renders the folder tree + script
// grid, with create/rename/delete and macOS/Windows-style drag-into-folder.

import {
  loadLibrary,
  deleteWorkspaceCascade,
  createFolderIn,
  ensureDefaultFolder,
  renameFolder,
  folderDeleteStats,
  deleteFolderTree,
  renameScript,
  moveWorkspaceToFolder,
  createDragSession,
  moveItemInto,
  loadAllRecordings,
  deleteRecording,
  deleteRecordings,
  loadRecordingBlob,
  checkStorage,
  setStorageLimit,
  getRecordingSaveEnabled,
  setRecordingSave,
  groupRecordingsByDay,
  startFromScript,
  createBlankWorkspace,
  exportScriptJson,
  exportSelectedBackup,
  uploadWorkspaceJson,
} from './workspaces.logic.js';
import { showToast } from '../../components/toast.js';
import { showConfirm } from '../../components/confirm-popup.js';
import { showPrompt } from '../../components/prompt-popup.js';
import { showStorageSettings } from '../../components/storage-settings-popup.js';
import { showRecordingPreview } from '../../components/recording-preview.js';
import { createExportStatusPopup } from '../../components/export-status-popup.js';
import { getVideoThumbnail, evictVideoThumbnail } from '../../components/video-thumbnail.js';
import { readTextFile } from '../../utils/read-text-file.js';
import { initFileDragDrop } from '../../utils/drag-drop.js';
import { prefetchPageAssets } from '../../utils/prefetch-page.js';
import { hideCrisp, showCrisp } from '../../utils/load-crisp.js';
import { downloadBlob, safeFileName } from '../../utils/download.js';
import {
  createStreamingZipArtifact,
  garbageCollectStreamingZipArtifacts,
} from '../../utils/streaming-zip.js';
import { waitForMinimumZipProcessing } from '../../utils/export-timing.js';

const MORE_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
const FOLDER_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"/></svg>';
const BACK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const FILE_GHOST_ICON =
  '<svg viewBox="0 0 48 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2H30L44 16V52a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="currentColor"/><path d="M30 2V14a2 2 0 0 0 2 2H44" fill="none" stroke="#fff" stroke-width="1.5"/></svg>';
const VIDEO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 9 6-3v12l-6-3"/></svg>';
const AUDIO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>';

const MOBILE_BREAKPOINT = 768;
const MENU_EDGE_GAP = 8;
const MENU_MIN_WIDTH = 150;
const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE_TOLERANCE = 10;
const TOUCH_DRAG_ARM_MS = 260;
const TOUCH_DRAG_START_DISTANCE = 6;
const TOUCH_DRAG_EDGE_SCROLL = 64;
const ACCEPTED_EXT = ['txt', 'md', 'markdown', 'fountain', 'text', 'json'];
const MAX_JSON_UPLOAD_BYTES = 10 * 1024 * 1024;
function readCopy() {
  const el = document.getElementById('wsCopy');
  if (!el) return {};
  try {
    return JSON.parse(el.textContent) || {};
  } catch {
    return {};
  }
}

export function initWorkspacesUI() {
  const copy = readCopy();
  const grid = document.getElementById('videoGrid');
  const emptyEl = document.getElementById('wsScriptsEmpty');
  const folderGrid = document.getElementById('wsFolderGrid');
  const breadcrumb = document.getElementById('wsBreadcrumb');
  const addFolderBtn = document.getElementById('wsAddFolderBtn');
  const sidebar = document.getElementById('wsSidebar');
  const overlay = document.getElementById('wsSidebarOverlay');
  const menuBtn = document.getElementById('wsMobileMenuBtn');
  const newBtn = document.getElementById('wsNewScriptBtn');
  const uploadBtn = document.getElementById('wsUploadBtn');
  const exportSelectedBtn = document.getElementById('wsExportSelectedBtn');
  const fileInput = document.getElementById('wsFileInput');
  const dragOverlay = document.getElementById('wsDragOverlay');
  const scriptsView = document.getElementById('wsScriptsView');
  const recordingsView = document.getElementById('wsRecordingsView');
  const recordingGrid = document.getElementById('wsRecordingGrid');
  const recordingsEmpty = document.getElementById('wsRecordingsEmpty');
  const navButtons = Array.from(document.querySelectorAll('.ws-sidebar-nav [data-view], .ws-switch-btn[data-view]'));
  const storageEl = document.getElementById('wsStorage');

  // Warm everything the in-page teleprompter overlay needs — markup (shared
  // HTML cache), plus the overlay JS+CSS chunks — so opening a workspace is
  // instant. Low-priority and idle-gated, so it never competes with this
  // page's own load.
  let teleprompterWarmed = false;
  const warmTeleprompter = () => {
    if (teleprompterWarmed) return;
    teleprompterWarmed = true;
    prefetchPageAssets('/teleprompter');
    import('../teleprompter/teleprompter-overlay.ui.js')
      .then((overlay) => overlay.preloadTeleprompterOverlay())
      .catch(() => {});
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warmTeleprompter, { timeout: 2500 });
  } else {
    window.setTimeout(warmTeleprompter, 1200);
  }
  grid?.addEventListener('pointerenter', warmTeleprompter, { once: true });
  newBtn?.addEventListener('pointerenter', warmTeleprompter, { once: true });
  const storageValue = document.getElementById('wsStorageValue');
  const storageFill = document.getElementById('wsStorageFill');
  const storageNote = document.getElementById('wsStorageNote');
  const storageEditBtn = document.getElementById('wsStorageEdit');
  const selectionToolbar = document.getElementById('wsSelectionToolbar');
  const selectAllBtn = document.getElementById('wsSelectAllBtn');
  const selectAllLabel = selectAllBtn?.querySelector('.ws-select-all-label');
  const downloadSelectedBtn = document.getElementById('wsDownloadSelectedBtn');
  const downloadSelectedLabel = downloadSelectedBtn?.querySelector('.ws-download-selected-label');
  const deleteSelectedBtn = document.getElementById('wsDeleteSelectedBtn');

  if (!grid) return;

  // Reposition content actions responsive layout (Desktop: appbar, Mobile: content header)
  const actionsContainer = document.querySelector('.ws-content-actions');
  const appbar = document.querySelector('.ws-appbar');
  const contentHeader = document.querySelector('.ws-content-header');

  if (actionsContainer && appbar && contentHeader) {
    const handleActionsPosition = (e) => {
      if (e.matches) {
        // Mobile: inside content header
        contentHeader.appendChild(actionsContainer);
      } else {
        // Desktop: inside top appbar
        appbar.appendChild(actionsContainer);
      }
    };

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    handleActionsPosition(mediaQuery);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleActionsPosition);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleActionsPosition);
    }
  }

  const scriptMap = new Map();
  const folderMap = new Map();
  let currentFolderId = null;
  let currentPath = [];
  let dragItem = null;
  // Snapshot of the folder/workspace lists taken at drag start — dragover and
  // touchmove fire at pointer rate and must not re-read localStorage per event.
  let dragSession = null;
  const canDropInto = (targetFolderId) =>
    Boolean(dragItem && dragSession && dragSession.canMoveInto(targetFolderId));
  let closeMenu = () => {};
  let selectionView = null;
  const selectedIds = new Set();
  let suppressClick = null;
  let suppressTouchClickUntil = 0;
  let touchDragSession = null;
  let cancelTouchCardDrag = () => {};
  let downloadingSelection = false;
  let selectionArchiveArtifact = null;
  let backupArchiveArtifact = null;
  let exportingScripts = false;
  let downloadCancel = null;
  let backupCancel = null;

  garbageCollectStreamingZipArtifacts().catch(() => {});

  const t = (key, fallback) => copy[key] || fallback;

  const discardSelectionArchive = () => {
    const artifact = selectionArchiveArtifact;
    selectionArchiveArtifact = null;
    artifact?.cleanup?.().catch((error) => {
      console.warn('Failed to remove temporary ZIP', error);
    });
  };

  const exportStatus = createExportStatusPopup({
    labels: copy,
    onDownload: () => {
      if (!selectionArchiveArtifact?.blob) return;
      downloadBlob(selectionArchiveArtifact.blob, 'vteleprompter-recordings.zip');
      clearSelection();
    },
    onRetry: () => handleDownloadSelected(),
    onClose: discardSelectionArchive,
    onCancel: () => downloadCancel?.abort(),
  });
  document.body.append(exportStatus.el);

  const discardBackupArchive = () => {
    const artifact = backupArchiveArtifact;
    backupArchiveArtifact = null;
    artifact?.cleanup?.().catch((error) => {
      console.warn('Failed to remove temporary backup ZIP', error);
    });
  };
  const backupStatus = createExportStatusPopup({
    labels: {
      ...copy,
      zipPreparingMessage: t(
        'backupPreparingMessage',
        'Packaging the selected script JSON files. Keep this page open.',
      ),
      zipReadyMessage: t('backupReadyMessage', 'Your selected scripts are ready.'),
      zipFailedMessage: t('backupFailedMessage', 'Could not export the selected scripts.'),
    },
    onDownload: () => {
      if (!backupArchiveArtifact?.blob) return;
      downloadBlob(backupArchiveArtifact.blob, backupArchiveArtifact.filename);
    },
    onRetry: () => handleExportSelected(),
    onClose: discardBackupArchive,
    onCancel: () => backupCancel?.abort(),
  });
  document.body.append(backupStatus.el);

  const selectionCardSelector = (view) =>
    view === 'recordings' ? '.ws-recording-card' : '.ws-video-card';

  function idsForSelectionView() {
    return [...(selectionView === 'recordings' ? recordingMap.keys() : scriptMap.keys())];
  }

  const escapeCss = (value) =>
    (window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'));

  // With `changedId`, only that card's DOM is touched (a checkbox toggle in a
  // 300-card grid must not rewrite 300 cards); the toolbar state below always
  // refreshes. Full sweeps happen on selection-mode enter/exit and re-renders.
  function updateSelectionUI(changedId = null) {
    const ids = idsForSelectionView();
    const validIds = new Set(ids);
    [...selectedIds].forEach((id) => {
      if (!validIds.has(id)) selectedIds.delete(id);
    });

    if (selectionView) document.body.dataset.wsSelectionView = selectionView;
    else delete document.body.dataset.wsSelectionView;
    const cardSelector = changedId != null
      ? `.ws-video-card[data-id="${escapeCss(String(changedId))}"], .ws-recording-card[data-id="${escapeCss(String(changedId))}"]`
      : '.ws-video-card, .ws-recording-card';
    document.querySelectorAll(cardSelector).forEach((cardEl) => {
      const belongsToView = cardEl.matches(selectionCardSelector(selectionView));
      const selected = belongsToView && selectedIds.has(String(cardEl.dataset.id));
      cardEl.classList.toggle('is-selected', selected);
      cardEl.setAttribute('aria-selected', String(selected));
      if (cardEl.matches('.ws-video-card')) {
        cardEl.setAttribute('draggable', String(!selectionView));
      }
      const checkbox = cardEl.querySelector('[data-select-item]');
      if (checkbox) checkbox.setAttribute('aria-checked', String(selected));
    });

    if (selectionToolbar) selectionToolbar.hidden = !selectionView;
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    if (selectAllLabel) {
      selectAllLabel.textContent = allSelected
        ? t('selectionUnselectAll', 'Unselect All')
        : t('selectionSelectAll', 'Select All');
    }
    selectAllBtn?.setAttribute('aria-pressed', String(allSelected));
    const selectionBusy = downloadingSelection || exportingScripts;
    if (selectAllBtn) selectAllBtn.disabled = selectionBusy;
    if (exportSelectedBtn) {
      exportSelectedBtn.hidden = selectionView !== 'scripts';
      exportSelectedBtn.disabled = selectedIds.size === 0 || selectionBusy;
    }
    if (downloadSelectedBtn) {
      downloadSelectedBtn.hidden = selectionView !== 'recordings';
      downloadSelectedBtn.disabled = selectedIds.size === 0 || selectionBusy;
    }
    if (downloadSelectedLabel) {
      downloadSelectedLabel.textContent = downloadingSelection
        ? t('selectionPreparingDownload', 'Creating ZIP…')
        : t('selectionDownload', 'Download');
    }
    if (deleteSelectedBtn) {
      deleteSelectedBtn.disabled = selectedIds.size === 0 || selectionBusy;
    }
  }

  function startSelection(view, id) {
    closeMenu();
    if (selectionView !== view) selectedIds.clear();
    selectionView = view;
    if (id != null) selectedIds.add(String(id));
    updateSelectionUI();
  }

  function toggleSelection(view, id) {
    const key = String(id);
    if (selectionView !== view) {
      startSelection(view, key);
      return;
    }
    if (selectedIds.has(key)) selectedIds.delete(key);
    else selectedIds.add(key);
    if (selectedIds.size === 0) {
      clearSelection();
      return;
    }
    updateSelectionUI(key);
  }

  function clearSelection() {
    selectionView = null;
    selectedIds.clear();
    updateSelectionUI();
  }

  function shouldSuppressCardClick(view, id) {
    if (!suppressClick) return false;
    const matches =
      suppressClick.view === view &&
      suppressClick.id === String(id) &&
      performance.now() - suppressClick.at < 900;
    if (matches) suppressClick = null;
    return matches;
  }

  function bindLongPress(container, view, selector) {
    if (!container) return;
    let pending = null;
    const cancel = () => {
      if (pending?.timer) window.clearTimeout(pending.timer);
      pending = null;
    };
    container.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' || event.button !== 0 || selectionView) return;
      if (event.target.closest('[data-select-item], [data-more], [data-more-recording]')) return;
      const cardEl = event.target.closest(selector);
      if (!cardEl) return;
      const id = String(cardEl.dataset.id);
      pending = { id, x: event.clientX, y: event.clientY, timer: 0 };
      pending.timer = window.setTimeout(() => {
        cancelTouchCardDrag();
        startSelection(view, id);
        suppressClick = { view, id, at: performance.now() };
        if (navigator.vibrate) navigator.vibrate(18);
        pending = null;
      }, LONG_PRESS_MS);
    });
    container.addEventListener('pointermove', (event) => {
      if (!pending) return;
      if (
        Math.abs(event.clientX - pending.x) > LONG_PRESS_MOVE_TOLERANCE ||
        Math.abs(event.clientY - pending.y) > LONG_PRESS_MOVE_TOLERANCE
      ) {
        cancel();
      }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) =>
      container.addEventListener(name, cancel),
    );
  }

  // ---- Mobile sidebar drawer -----------------------------------------------
  const openSidebar = () => {
    sidebar?.classList.add('open');
    overlay?.classList.add('visible');
  };
  const closeSidebar = () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('visible');
  };
  menuBtn?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);
  sidebar?.addEventListener('click', (event) => {
    if (event.target.closest('.ws-nav-item') && window.innerWidth <= MOBILE_BREAKPOINT) {
      closeSidebar();
    }
  });

  // ---- Section collapse (chevron) ------------------------------------------
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-section-toggle]');
    if (toggle) toggle.closest('section')?.classList.toggle('is-collapsed');
  });

  // Open a workspace as an in-page overlay — the workspaces list stays put
  // beneath and re-renders on close (title/updated/recording badges may have
  // changed during the studio session). `trigger` is the button that started
  // the open; it shows a loading state for the cold-cache case where the
  // overlay chunk/markup still has to load.
  let openingWorkspace = false;
  const openWorkspace = async (id, trigger = null) => {
    if (openingWorkspace) return;
    openingWorkspace = true;
    if (trigger) {
      trigger.disabled = true;
      trigger.classList.add('is-loading');
    }
    // The overlay is the teleprompter: keep the support bubble off the recorder.
    hideCrisp();
    try {
      const { openTeleprompterOverlay } = await import(
        '../teleprompter/teleprompter-overlay.ui.js'
      );
      await openTeleprompterOverlay(id, {
        onClosed: () => {
          showCrisp();
          render();
        },
      });
    } catch {
      // Overlay unavailable (chunk failed to load): fall back to navigation.
      window.location.href = `/teleprompter?ws=${encodeURIComponent(id)}`;
    } finally {
      openingWorkspace = false;
      if (trigger) {
        trigger.disabled = false;
        trigger.classList.remove('is-loading');
      }
    }
  };

  // ---- Context menu ---------------------------------------------------------
  function openMenu(anchor, items) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'ws-ctx-menu';
    menu.setAttribute('role', 'menu');
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ws-ctx-item${item.danger ? ' ws-ctx-item--danger' : ''}`;
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMenu();
        item.onSelect();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const x = Math.min(anchor.x, window.innerWidth - rect.width - MENU_EDGE_GAP);
    const y = Math.min(anchor.y, window.innerHeight - rect.height - MENU_EDGE_GAP);
    menu.style.left = `${Math.max(MENU_EDGE_GAP, x)}px`;
    menu.style.top = `${Math.max(MENU_EDGE_GAP, y)}px`;

    const onDocClick = () => closeMenu();
    const onKey = (event) => {
      if (event.key === 'Escape') closeMenu();
    };
    closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      closeMenu = () => {};
    };
    setTimeout(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKey);
    }, 0);
  }

  const anchorFromButton = (btn) => {
    const rect = btn.getBoundingClientRect();
    return { x: rect.right - MENU_MIN_WIDTH, y: rect.bottom + 4 };
  };

  // ---- Rendering ------------------------------------------------------------
  const itemLabel = (count) =>
    `${count} ${count === 1 ? t('itemOne', 'item') : t('itemMany', 'items')}`;

  function buildScriptCard(card) {
    const el = document.createElement('article');
    el.className = 'ws-video-card';
    el.dataset.id = card.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('draggable', 'true');
    el.innerHTML = `
      <div class="ws-video-thumb ws-script-thumb">
        <button class="ws-item-checkbox" type="button" role="checkbox" aria-checked="false" data-select-item></button>
        <div class="ws-script-preview"></div>
        <button class="ws-card-more ws-card-more--onthumb" type="button" data-more>${MORE_ICON}</button>
      </div>
      <div class="ws-video-info">
        <h3 class="ws-video-title"></h3>
        <div class="ws-script-meta">
          <span class="ws-local-badge"><span class="ws-local-dot"></span><span class="ws-local-text"></span></span>
          <span class="ws-video-updated"></span>
        </div>
      </div>`;
    el.querySelector('.ws-card-more').setAttribute('aria-label', t('moreAria', 'More actions'));
    el
      .querySelector('.ws-item-checkbox')
      .setAttribute('aria-label', t('selectionSelectScriptAria', 'Select script'));
    const preview = el.querySelector('.ws-script-preview');
    preview.setAttribute('data-empty', t('emptyScript', 'Empty script'));
    if (card.previewHtml) {
      preview.innerHTML = card.previewHtml;
    } else {
      preview.textContent = card.snippet;
    }

    if (card.settings) {
      if (card.settings.align) {
        preview.style.textAlign = card.settings.align;
      }
      preview.style.fontWeight = card.settings.bold ? 'bold' : 'normal';
      preview.style.fontStyle = card.settings.italic ? 'italic' : 'normal';
      preview.style.textDecoration = card.settings.underline ? 'underline' : 'none';

      const isLight = card.settings.pageTheme === 'light';
      const thumb = el.querySelector('.ws-script-thumb');
      if (thumb) {
        thumb.style.background = isLight ? '#ffffff' : 'var(--ws-thumb-bg)';
      }
      if (card.settings.color) {
        preview.style.color = card.settings.color;
      } else {
        preview.style.color = isLight ? 'var(--ws-text)' : 'var(--ws-thumb-preview)';
      }
    }

    el.querySelector('.ws-local-text').textContent = t('localBadge', 'Local');
    el.querySelector('.ws-video-title').textContent = card.title || t('untitled', 'Untitled script');
    el.querySelector('.ws-video-updated').textContent = card.updatedDate
      ? `${t('updatedPrefix', 'Updated')} ${card.updatedDate}`
      : '';
    return el;
  }

  function buildFolderCard(folder) {
    const el = document.createElement('div');
    el.className = 'ws-folder-card';
    el.dataset.folderId = folder.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('draggable', 'true');
    el.innerHTML = `
      <span class="ws-folder-icon">${FOLDER_ICON}</span>
      <span class="ws-folder-body">
        <span class="ws-folder-name"></span>
        <span class="ws-folder-sub"></span>
      </span>
      <button class="ws-card-more" type="button" data-more-folder>${MORE_ICON}</button>`;
    el.querySelector('.ws-folder-name').textContent = folder.name;
    el.querySelector('.ws-folder-sub').textContent = itemLabel(folder.itemCount);
    el.querySelector('.ws-card-more').setAttribute('aria-label', t('moreAria', 'More actions'));
    return el;
  }

  function crumbButton(folderId, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ws-crumb';
    btn.dataset.folder = folderId;
    btn.textContent = label;
    return btn;
  }
  function crumbSep(text) {
    const span = document.createElement('span');
    span.className = 'ws-crumb-sep';
    span.textContent = text;
    return span;
  }

  function renderBreadcrumb(path) {
    breadcrumb.innerHTML = '';
    if (!path.length) {
      breadcrumb.hidden = true;
      return;
    }
    breadcrumb.hidden = false;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ws-back-btn';
    back.dataset.back = '';
    back.setAttribute('aria-label', t('backAria', 'Back'));
    back.innerHTML = `${BACK_ICON}<span></span>`;
    back.querySelector('span').textContent = t('backLabel', 'Back');
    breadcrumb.appendChild(back);
    breadcrumb.appendChild(crumbSep('·'));
    breadcrumb.appendChild(crumbButton('root', t('allLabel', 'All')));
    path.forEach((folder) => {
      breadcrumb.appendChild(crumbSep('/'));
      breadcrumb.appendChild(crumbButton(folder.id, folder.name));
    });
  }

  function renderFolders(folders) {
    folderMap.clear();
    folderGrid.innerHTML = '';
    const fragment = document.createDocumentFragment();
    folders.forEach((folder) => {
      folderMap.set(String(folder.id), folder);
      fragment.appendChild(buildFolderCard(folder));
    });
    folderGrid.appendChild(fragment);
  }

  function renderScripts(scripts) {
    scriptMap.clear();
    grid.innerHTML = '';
    if (emptyEl) emptyEl.hidden = scripts.length !== 0;
    const fragment = document.createDocumentFragment();
    scripts.forEach((card) => {
      scriptMap.set(String(card.id), card);
      fragment.appendChild(buildScriptCard(card));
    });
    grid.appendChild(fragment);
    if (selectionView === 'scripts') updateSelectionUI();
  }

  async function render() {
    const { path, folders, scripts } = await loadLibrary(currentFolderId);
    closeMenu();
    currentPath = path;
    renderBreadcrumb(path);
    renderFolders(folders);
    renderScripts(scripts);
  }

  // ---- Script actions -------------------------------------------------------
  const scriptMenuItems = (card) => [
    { label: t('openLabel', 'Open'), onSelect: () => openWorkspace(card.id) },
    { label: t('exportJsonLabel', 'Export'), onSelect: () => exportScriptFlow(card) },
    { label: t('renameLabel', 'Rename'), onSelect: () => renameScriptFlow(card) },
    { label: t('deleteLabel', 'Delete'), danger: true, onSelect: () => deleteScriptFlow(card) },
  ];

  function exportScriptFlow(card) {
    try {
      const exported = exportScriptJson(card.id);
      const filename = `${safeFileName(exported.workspace.title, 'untitled-script')}.json`;
      downloadBlob(exported.blob, filename);
      showToast(t('toastExportedJson', 'Script exported as JSON'));
    } catch {
      showToast(t('toastExportError', 'Could not export that script'), { variant: 'error' });
    }
  }

  async function renameScriptFlow(card) {
    const name = await showPrompt({
      title: t('renameScriptTitle', 'Rename script'),
      value: card.title || '',
      confirmLabel: t('folderSaveLabel', 'Save'),
      cancelLabel: t('cancelLabel', 'Cancel'),
    });
    if (name == null) return;
    renameScript(card.id, name);
    render();
  }

  async function deleteScriptFlow(card) {
    const title = card.title || t('untitled', 'Untitled script');
    const message = t('confirmDeleteMessage', 'Delete “{title}”?').replace('{title}', title);
    const confirmed = await showConfirm({
      title: t('confirmDeleteTitle', 'Delete script'),
      message,
      confirmLabel: t('confirmLabel', 'Delete'),
      cancelLabel: t('cancelLabel', 'Cancel'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteWorkspaceCascade(card.id);
      showToast(t('toastDeleted', 'Script deleted'));
    } catch {
      showToast(t('toastDeleteError', 'Could not delete that script'));
    }
    render();
  }

  // ---- Folder actions -------------------------------------------------------
  const folderMenuItems = (folder) => [
    { label: t('renameLabel', 'Rename'), onSelect: () => renameFolderFlow(folder) },
    { label: t('deleteLabel', 'Delete'), danger: true, onSelect: () => deleteFolderFlow(folder) },
  ];

  async function renameFolderFlow(folder) {
    const name = await showPrompt({
      title: t('folderRenameTitle', 'Rename folder'),
      value: folder.name || '',
      placeholder: t('folderNamePlaceholder', ''),
      confirmLabel: t('folderSaveLabel', 'Save'),
      cancelLabel: t('cancelLabel', 'Cancel'),
    });
    if (name == null) return;
    renameFolder(folder.id, name);
    render();
  }

  function folderDeleteMessage(folder) {
    const stats = folderDeleteStats(folder.id);
    if (!stats.subFolderCount && !stats.scriptCount) {
      return t('folderDeleteMessage', 'Delete this folder? This cannot be undone.');
    }
    const folderWord = stats.subFolderCount === 1 ? t('folderOne', 'folder') : t('folderMany', 'folders');
    const scriptWord = stats.scriptCount === 1 ? t('scriptOne', 'script') : t('scriptMany', 'scripts');
    const counts = `${stats.subFolderCount} ${folderWord}, ${stats.scriptCount} ${scriptWord}`;
    return t('folderDeleteMessageWithCounts', 'Delete this folder and everything inside ({counts})?').replace(
      '{counts}',
      counts,
    );
  }

  async function deleteFolderFlow(folder) {
    const confirmed = await showConfirm({
      title: t('folderDeleteTitle', 'Delete folder'),
      message: folderDeleteMessage(folder),
      confirmLabel: t('confirmLabel', 'Delete'),
      cancelLabel: t('cancelLabel', 'Cancel'),
      danger: true,
    });
    if (!confirmed) return;
    await deleteFolderTree(folder.id);
    showToast(t('toastFolderDeleted', 'Folder deleted'));
    render();
  }

  addFolderBtn?.addEventListener('click', async () => {
    const name = await showPrompt({
      title: t('folderNewTitle', 'New folder'),
      value: t('folderNewDefault', 'New Folder'),
      placeholder: t('folderNamePlaceholder', ''),
      confirmLabel: t('folderCreateLabel', 'Create'),
      cancelLabel: t('cancelLabel', 'Cancel'),
    });
    if (name == null) return;
    createFolderIn(name, currentFolderId);
    render();
  });

  // ---- Grid interactions ----------------------------------------------------
  grid.addEventListener('click', (event) => {
    const cardEl = event.target.closest('.ws-video-card');
    if (!cardEl) return;
    const card = scriptMap.get(cardEl.dataset.id);
    if (!card) return;
    if (performance.now() < suppressTouchClickUntil) {
      event.preventDefault();
      return;
    }
    if (shouldSuppressCardClick('scripts', card.id)) {
      event.preventDefault();
      return;
    }
    if (event.target.closest('[data-select-item]')) {
      event.preventDefault();
      event.stopPropagation();
      toggleSelection('scripts', card.id);
      return;
    }
    const moreBtn = event.target.closest('[data-more]');
    if (moreBtn) {
      event.stopPropagation();
      openMenu(anchorFromButton(moreBtn), scriptMenuItems(card));
      return;
    }
    openWorkspace(card.id);
  });
  grid.addEventListener('contextmenu', (event) => {
    const cardEl = event.target.closest('.ws-video-card');
    if (!cardEl) return;
    const card = scriptMap.get(cardEl.dataset.id);
    if (!card) return;
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY }, scriptMenuItems(card));
  });
  grid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const cardEl = event.target.closest('.ws-video-card');
    if (!cardEl || event.target.closest('[data-more]')) return;
    event.preventDefault();
    const card = scriptMap.get(cardEl.dataset.id);
    if (card) openWorkspace(card.id);
  });

  bindLongPress(grid, 'scripts', '.ws-video-card');

  folderGrid.addEventListener('click', (event) => {
    const cardEl = event.target.closest('.ws-folder-card');
    if (!cardEl) return;
    const folder = folderMap.get(cardEl.dataset.folderId);
    if (!folder) return;
    if (performance.now() < suppressTouchClickUntil) {
      event.preventDefault();
      return;
    }
    if (selectionView) clearSelection();
    const moreBtn = event.target.closest('[data-more-folder]');
    if (moreBtn) {
      event.stopPropagation();
      openMenu(anchorFromButton(moreBtn), folderMenuItems(folder));
      return;
    }
    currentFolderId = folder.id;
    render();
  });
  folderGrid.addEventListener('contextmenu', (event) => {
    const cardEl = event.target.closest('.ws-folder-card');
    if (!cardEl) return;
    const folder = folderMap.get(cardEl.dataset.folderId);
    if (!folder) return;
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY }, folderMenuItems(folder));
  });
  folderGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const cardEl = event.target.closest('.ws-folder-card');
    if (!cardEl || event.target.closest('[data-more-folder]')) return;
    event.preventDefault();
    const folder = folderMap.get(cardEl.dataset.folderId);
    if (folder) {
      currentFolderId = folder.id;
      render();
    }
  });

  // ---- Breadcrumb navigation ------------------------------------------------
  breadcrumb.addEventListener('click', (event) => {
    if (selectionView) clearSelection();
    if (event.target.closest('[data-back]')) {
      currentFolderId = currentPath.length > 1 ? currentPath[currentPath.length - 2].id : null;
      render();
      return;
    }
    const crumb = event.target.closest('[data-folder]');
    if (!crumb) return;
    currentFolderId = crumb.dataset.folder === 'root' ? null : crumb.dataset.folder;
    render();
  });

  // ---- Drag & drop: move scripts / folders into folders --------------------
  function onCardDragStart(event) {
    const folderEl = event.target.closest('.ws-folder-card');
    const scriptEl = event.target.closest('.ws-video-card');
    let label;
    let kind = 'script';
    if (folderEl) {
      dragItem = { type: 'folder', id: folderEl.dataset.folderId };
      label = folderEl.querySelector('.ws-folder-name')?.textContent || 'Folder';
      kind = 'folder';
      folderEl.classList.add('ws-dragging');
    } else if (scriptEl) {
      dragItem = { type: 'script', id: scriptEl.dataset.id };
      label = scriptEl.querySelector('.ws-video-title')?.textContent || 'Script';
      scriptEl.classList.add('ws-dragging');
    } else {
      return;
    }
    dragSession = createDragSession(dragItem);
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', `${dragItem.type}:${dragItem.id}`);
    } catch {
      // some browsers restrict setData outside a user gesture — non-fatal
    }
    const ghost = document.createElement('div');
    ghost.className = 'ws-drag-ghost';
    ghost.innerHTML = `<span class="ws-drag-ghost-icon ws-drag-ghost-icon--${kind}">${
      kind === 'folder' ? FOLDER_ICON : FILE_GHOST_ICON
    }</span><span class="ws-drag-ghost-label"></span>`;
    ghost.querySelector('.ws-drag-ghost-label').textContent = label;
    document.body.appendChild(ghost);
    try {
      event.dataTransfer.setDragImage(ghost, 52, 20);
    } catch {
      // setDragImage unsupported — fall back to the default drag image
    }
    setTimeout(() => ghost.remove(), 0);
  }

  function onCardDragEnd() {
    dragItem = null;
    dragSession = null;
    document.querySelectorAll('.ws-drop-target').forEach((el) => el.classList.remove('ws-drop-target'));
    document.querySelectorAll('.ws-dragging').forEach((el) => el.classList.remove('ws-dragging'));
  }

  function dropInto(targetFolderId) {
    if (moveItemInto(dragItem, targetFolderId)) {
      showToast(t('toastMoved', 'Moved'));
      render();
    }
  }

  // Native HTML drag events are mouse-first and are not emitted reliably by
  // iOS/Android browsers. Arm a touch drag after a short hold, then begin only
  // once the finger moves. A stationary long press remains available for the
  // existing multi-select gesture.
  function touchDropTargetAt(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const folderEl = hit?.closest('.ws-folder-card');
    if (folderEl && canDropInto(folderEl.dataset.folderId)) {
      return { el: folderEl, folderId: folderEl.dataset.folderId };
    }
    const crumb = hit?.closest('.ws-crumb[data-folder]');
    if (crumb) {
      const folderId = crumb.dataset.folder === 'root' ? null : crumb.dataset.folder;
      if (canDropInto(folderId)) return { el: crumb, folderId };
    }
    return null;
  }

  function setTouchDropTarget(target) {
    if (touchDragSession?.dropTarget?.el === target?.el) return;
    touchDragSession?.dropTarget?.el.classList.remove('ws-drop-target');
    if (touchDragSession) touchDragSession.dropTarget = target;
    target?.el.classList.add('ws-drop-target');
  }

  function moveTouchGhost(clientX, clientY) {
    const ghost = touchDragSession?.ghost;
    if (!ghost) return;
    ghost.style.transform = `translate3d(${clientX + 14}px, ${clientY + 14}px, 0)`;
  }

  function startTouchCardDrag(event) {
    const session = touchDragSession;
    if (!session || session.active) return;
    session.active = true;
    dragItem = session.item;
    dragSession = createDragSession(dragItem);
    // Hand off from the "lifted" state to the "dragging" state: the ghost now
    // follows the finger, so the source card just dims instead of scaling.
    session.cardEl.classList.remove('ws-armed');
    session.cardEl.classList.add('ws-dragging');
    document.body.classList.add('ws-touch-drag-active');

    const ghost = document.createElement('div');
    ghost.className = 'ws-drag-ghost ws-drag-ghost--touch';
    ghost.innerHTML = `<span class="ws-drag-ghost-icon ws-drag-ghost-icon--${session.kind}">${
      session.kind === 'folder' ? FOLDER_ICON : FILE_GHOST_ICON
    }</span><span class="ws-drag-ghost-label"></span>`;
    ghost.querySelector('.ws-drag-ghost-label').textContent = session.label;
    document.body.appendChild(ghost);
    session.ghost = ghost;
    moveTouchGhost(event.clientX, event.clientY);
    if (navigator.vibrate) navigator.vibrate(12);
  }

  cancelTouchCardDrag = ({ drop = false } = {}) => {
    const session = touchDragSession;
    if (!session) return;
    window.clearTimeout(session.armTimer);
    session.dropTarget?.el.classList.remove('ws-drop-target');
    session.cardEl.classList.remove('ws-dragging', 'ws-armed');
    session.ghost?.remove();
    document.body.classList.remove('ws-touch-drag-active');
    touchDragSession = null;
    dragSession = null;

    if (session.active) {
      suppressTouchClickUntil = performance.now() + 900;
      const targetFolderId = session.dropTarget?.folderId;
      const shouldDrop = drop && session.dropTarget;
      dragItem = null;
      if (shouldDrop && moveItemInto(session.item, targetFolderId)) {
        showToast(t('toastMoved', 'Moved'));
        render();
      }
    }
  };

  function bindTouchCardDrag(container, selector, type) {
    container.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1 || selectionView) return;
      if (event.target.closest('[data-select-item], [data-more], [data-more-folder]')) return;
      const cardEl = event.target.closest(selector);
      if (!cardEl) return;
      const touch = event.changedTouches[0];
      cancelTouchCardDrag();
      const id = type === 'folder' ? cardEl.dataset.folderId : cardEl.dataset.id;
      const labelSelector = type === 'folder' ? '.ws-folder-name' : '.ws-video-title';
      touchDragSession = {
        pointerId: touch.identifier,
        cardEl,
        item: { type, id },
        kind: type,
        label: cardEl.querySelector(labelSelector)?.textContent || (type === 'folder' ? 'Folder' : 'Script'),
        startX: touch.clientX,
        startY: touch.clientY,
        armed: false,
        active: false,
        dropTarget: null,
        ghost: null,
        armTimer: 0,
      };
      touchDragSession.armTimer = window.setTimeout(() => {
        if (touchDragSession?.pointerId !== touch.identifier) return;
        touchDragSession.armed = true;
        // Confirm the "pick up" the instant the hold registers — before any
        // move — so the gesture is discoverable: lift the card + a haptic tick.
        cardEl.classList.add('ws-armed');
        if (navigator.vibrate) navigator.vibrate(14);
      }, TOUCH_DRAG_ARM_MS);
    }, { passive: true });

    container.addEventListener('touchmove', (event) => {
      const session = touchDragSession;
      if (!session) return;
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === session.pointerId);
      if (!touch) return;
      const distance = Math.hypot(touch.clientX - session.startX, touch.clientY - session.startY);
      if (!session.armed) {
        // Not picked up yet — a swipe here is a scroll, so let it through.
        if (distance > LONG_PRESS_MOVE_TOLERANCE) cancelTouchCardDrag();
        return;
      }
      // Armed = the card is picked up. Own the gesture so the browser can't
      // reclaim it as a scroll (which would fire touchcancel mid-drag).
      event.preventDefault();
      if (!session.active) {
        if (distance < TOUCH_DRAG_START_DISTANCE) return;
        startTouchCardDrag(touch);
      }
      moveTouchGhost(touch.clientX, touch.clientY);
      setTouchDropTarget(touchDropTargetAt(touch.clientX, touch.clientY));
      if (touch.clientY < TOUCH_DRAG_EDGE_SCROLL) window.scrollBy(0, -12);
      else if (touch.clientY > window.innerHeight - TOUCH_DRAG_EDGE_SCROLL) window.scrollBy(0, 12);
    }, { passive: false });

    container.addEventListener('touchend', (event) => {
      if (!touchDragSession) return;
      const ended = Array.from(event.changedTouches).some(
        (item) => item.identifier === touchDragSession.pointerId,
      );
      if (!ended) return;
      cancelTouchCardDrag({ drop: touchDragSession.active });
    });
    container.addEventListener('touchcancel', (event) => {
      if (!touchDragSession) return;
      const cancelled = Array.from(event.changedTouches).some(
        (item) => item.identifier === touchDragSession.pointerId,
      );
      if (cancelled) cancelTouchCardDrag();
    });
  }

  bindTouchCardDrag(grid, '.ws-video-card', 'script');
  bindTouchCardDrag(folderGrid, '.ws-folder-card', 'folder');

  [folderGrid, grid].forEach((zone) => {
    zone.addEventListener('dragstart', onCardDragStart);
    zone.addEventListener('dragend', onCardDragEnd);
  });

  folderGrid.addEventListener('dragover', (event) => {
    const cardEl = event.target.closest('.ws-folder-card');
    if (!cardEl || !canDropInto(cardEl.dataset.folderId)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    cardEl.classList.add('ws-drop-target');
  });
  folderGrid.addEventListener('dragleave', (event) => {
    const cardEl = event.target.closest('.ws-folder-card');
    if (cardEl && !cardEl.contains(event.relatedTarget)) cardEl.classList.remove('ws-drop-target');
  });
  folderGrid.addEventListener('drop', (event) => {
    const cardEl = event.target.closest('.ws-folder-card');
    if (!cardEl || !dragItem) return;
    event.preventDefault();
    cardEl.classList.remove('ws-drop-target');
    dropInto(cardEl.dataset.folderId);
  });

  breadcrumb.addEventListener('dragover', (event) => {
    const crumb = event.target.closest('[data-folder]');
    if (!crumb) return;
    const targetId = crumb.dataset.folder === 'root' ? null : crumb.dataset.folder;
    if (!canDropInto(targetId)) return;
    event.preventDefault();
    crumb.classList.add('ws-drop-target');
  });
  breadcrumb.addEventListener('dragleave', (event) => {
    const crumb = event.target.closest('[data-folder]');
    if (crumb) crumb.classList.remove('ws-drop-target');
  });
  breadcrumb.addEventListener('drop', (event) => {
    const crumb = event.target.closest('[data-folder]');
    if (!crumb || !dragItem) return;
    event.preventDefault();
    crumb.classList.remove('ws-drop-target');
    dropInto(crumb.dataset.folder === 'root' ? null : crumb.dataset.folder);
  });

  // ---- New script + Upload (both land in the current folder) ----------------
  newBtn?.addEventListener('click', () => {
    const workspace = createBlankWorkspace();
    moveWorkspaceToFolder(workspace.id, currentFolderId);
    openWorkspace(workspace.id, newBtn);
  });

  const ingestFile = async (file, trigger = null) => {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ACCEPTED_EXT.includes(ext)) {
      showToast(t('toastUploadUnsupported', 'Unsupported format. Choose a .txt, .md, or .json file.'), {
        variant: 'error',
      });
      return;
    }
    if (ext === 'json' && file.size > MAX_JSON_UPLOAD_BYTES) {
      showToast(t('toastJsonTooLarge', 'That JSON file is too large.'), { variant: 'error' });
      return;
    }
    let text;
    try {
      text = await readTextFile(file);
    } catch {
      showToast(t('toastReadError', 'Could not read that file.'), { variant: 'error' });
      return;
    }
    if (ext === 'json') {
      try {
        const workspace = uploadWorkspaceJson(text, currentFolderId);
        showToast(t('toastJsonImported', 'Workspace imported'));
        openWorkspace(workspace.id, trigger);
      } catch {
        showToast(t('toastJsonInvalid', 'That workspace JSON is invalid or unsupported.'), {
          variant: 'error',
        });
      }
      return;
    }
    const result = startFromScript(text);
    if (!result.ok) {
      showToast(t('toastUploadEmpty', 'That file looks empty.'), { variant: 'error' });
      return;
    }
    moveWorkspaceToFolder(result.workspace.id, currentFolderId);
    openWorkspace(result.workspace.id, trigger);
  };

  uploadBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) ingestFile(file, uploadBtn);
    fileInput.value = '';
  });

  async function handleExportSelected() {
    if (selectionView !== 'scripts' || selectedIds.size === 0 || exportingScripts) return;
    exportingScripts = true;
    updateSelectionUI();
    discardBackupArchive();
    backupCancel = new AbortController();
    backupStatus.openProcessing(1);
    const processingStartedAt = Date.now();
    try {
      backupArchiveArtifact = await exportSelectedBackup([...selectedIds], {
        signal: backupCancel.signal,
        onEntriesReady: (count) => backupStatus.openProcessing(count),
        onProgress: backupStatus.updateProgress,
      });
      await waitForMinimumZipProcessing(processingStartedAt);
      backupStatus.setSuccess();
    } catch (error) {
      discardBackupArchive();
      // The popup's X aborted this export — it already dismissed itself.
      if (error?.name === 'AbortError') return;
      await waitForMinimumZipProcessing(processingStartedAt);
      const message = error?.name === 'ZipStorageError'
        ? t('selectionDownloadTooLarge', 'This ZIP is too large for this browser to create safely.')
        : t('backupFailedMessage', 'Could not export the selected scripts.');
      backupStatus.setError(message);
    } finally {
      exportingScripts = false;
      updateSelectionUI();
    }
  }

  exportSelectedBtn?.addEventListener('click', handleExportSelected);

  // The overlay ships with the `hidden` attribute so it never flashes before
  // the JS-injected CSS applies. Styles are loaded by now, so hand visibility
  // over to the CSS opacity state (the `.hidden` class, toggled per-drag).
  if (dragOverlay) dragOverlay.hidden = false;

  // OS-file drag import (distinct from the internal card drag above). The util
  // ignores in-page drags, and isSuppressed() force-hides the overlay while a
  // card/folder drag is in progress so the two never conflict.
  initFileDragDrop({
    isSuppressed: () => dragItem != null,
    onToggle: (active) => {
      if (!dragOverlay) return;
      dragOverlay.classList.toggle('hidden', !active);
      dragOverlay.setAttribute('aria-hidden', String(!active));
    },
    onFile: ingestFile,
  });

  // ---- Recordings view (separate from the script library) ------------------
  const recordingMap = new Map();

  async function loadCardThumbnail(el) {
    const card = recordingMap.get(String(el.dataset.id));
    const thumb = el.querySelector('.ws-recording-thumb');
    if (!card || !thumb) return;
    const blob = await resolveCardBlob(card);
    if (!blob) return;
    getVideoThumbnail(card.id, blob).then((dataUrl) => {
      if (!dataUrl || !thumb.isConnected) return;
      thumb.style.backgroundImage = `url("${dataUrl}")`;
      thumb.classList.add('has-thumb');
    });
  }

  // Extract posters only for cards near the viewport; getVideoThumbnail caps
  // decoder concurrency and memoizes per recording id.
  const thumbObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          thumbObserver.unobserve(entry.target);
          loadCardThumbnail(entry.target);
        });
      }, { rootMargin: '200px' })
    : null;

  function buildRecordingCard(card) {
    const el = document.createElement('article');
    el.className = 'ws-recording-card';
    el.dataset.id = card.id;
    const icon = card.kind === 'audio' ? AUDIO_ICON : VIDEO_ICON;
    el.innerHTML = `
      <div class="ws-recording-thumb ${card.kind === 'audio' ? 'is-audio' : ''}">
        <button class="ws-item-checkbox" type="button" role="checkbox" aria-checked="false" data-select-item></button>
        <span class="ws-recording-kind">${icon}</span>
        <span class="ws-recording-duration"></span>
      </div>
      <div class="ws-recording-info">
        <h3 class="ws-recording-title"></h3>
        <div class="ws-recording-meta">
          <span class="ws-local-badge"><span class="ws-local-dot"></span><span class="ws-local-text"></span></span>
          <span class="ws-recording-date"></span>
        </div>
      </div>
      <button class="ws-card-more ws-recording-more" type="button" data-more-recording>${MORE_ICON}</button>`;
    el.querySelector('.ws-recording-duration').textContent = card.durationLabel;
    el.querySelector('.ws-recording-title').textContent =
      card.workspaceTitle || t('recUnknownScript', 'Untitled script');
    el.querySelector('.ws-local-text').textContent = t('localBadge', 'Local');
    el.querySelector('.ws-recording-date').textContent = card.createdDate;
    el.querySelector('.ws-card-more').setAttribute('aria-label', t('recMoreAria', 'More actions'));
    el
      .querySelector('.ws-item-checkbox')
      .setAttribute('aria-label', t('selectionSelectRecordingAria', 'Select recording'));
    // Real poster frame pulled from the video blob (falls back to the icon).
    // Extraction is deferred until the card scrolls into view — decoding every
    // video in the library on render stalls the page and floods the decoder.
    if (card.kind === 'video' && (card.blob || card.hasBytes)) {
      if (thumbObserver) thumbObserver.observe(el);
      else loadCardThumbnail(el);
    }
    return el;
  }

  // Byte-backed records (WebKit fallback) list without a blob — load the media
  // only when the user actually acts on the card, and cache it on the card.
  async function resolveCardBlob(card) {
    if (!card) return null;
    if (!card.blob && card.hasBytes) {
      const blob = await loadRecordingBlob(card);
      if (blob) card.blob = blob;
    }
    return card.blob || null;
  }

  // Play the recorded take back in-place (a preview modal) instead of jumping to
  // the teleprompter — a recording is a finished artifact, not a script to edit.
  async function openRecordingPreview(card) {
    const blob = await resolveCardBlob(card);
    if (!blob) {
      showToast(t('recPreviewMissing', 'This recording is unavailable.'), { variant: 'error' });
      return;
    }
    showRecordingPreview({
      title: card.workspaceTitle || t('recUnknownScript', 'Untitled script'),
      badge: card.kind === 'audio' ? t('recAudioBadge', 'Audio') : t('recVideoBadge', 'Video'),
      dateLabel: card.createdDate,
      durationLabel: card.durationLabel,
      kind: card.kind,
      blob,
      closeAria: t('recPreviewCloseAria', 'Close preview'),
    });
  }

  // Save the take to disk (a real backup — client storage is never permanent).
  async function downloadRecording(card) {
    const blob = await resolveCardBlob(card);
    if (!blob) {
      showToast(t('recPreviewMissing', 'This recording is unavailable.'), { variant: 'error' });
      return;
    }
    const subtype = ((blob.type || card.mimeType || '').split('/')[1] || 'webm').split(';')[0].trim();
    const base = safeFileName(card.workspaceTitle || t('recUnknownScript', 'Untitled script'));
    downloadBlob(blob, `${base}.${subtype || 'webm'}`);
  }

  const recordingMenuItems = (card) => [
    { label: t('recPreviewLabel', 'Preview'), onSelect: () => openRecordingPreview(card) },
    { label: t('recDownloadLabel', 'Download'), onSelect: () => downloadRecording(card) },
    { label: t('recDeleteLabel', 'Delete'), danger: true, onSelect: () => deleteRecordingFlow(card) },
  ];

  async function recordingArchiveEntries(cards) {
    const entries = [];
    for (const [index, card] of cards.entries()) {
      const blob = await resolveCardBlob(card);
      if (!blob) continue;
      const subtype = ((blob.type || card.mimeType || '').split('/')[1] || 'webm').split(';')[0].trim();
      const base = safeFileName(card.workspaceTitle || t('recUnknownScript', 'Untitled script'));
      entries.push({
        blob,
        name: `${String(index + 1).padStart(2, '0')}-${base}.${subtype || 'webm'}`,
      });
    }
    return entries;
  }

  async function deleteRecordingFlow(card) {
    const confirmed = await showConfirm({
      title: t('recDeleteTitle', 'Delete recording'),
      message: t('recDeleteMessage', 'Delete this recording? This cannot be undone.'),
      confirmLabel: t('confirmLabel', 'Delete'),
      cancelLabel: t('cancelLabel', 'Cancel'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteRecording(card.id);
    } catch {
      showToast(t('recDeleteError', 'Could not delete that recording'));
      return;
    }
    showToast(t('recDeleted', 'Recording deleted'));
    evictVideoThumbnail(card.id);
    removeRecordingCard(card.id);
    renderStorage({ fresh: true });
  }

  // Deleting one card must not re-run the whole load-blobs-and-decode render
  // pipeline — surgically remove the card (and its day group when emptied).
  function removeRecordingCard(id) {
    recordingMap.delete(String(id));
    const cardEl = [...recordingGrid.querySelectorAll('.ws-recording-card')]
      .find((el) => el.dataset.id === String(id));
    if (cardEl) {
      const group = cardEl.closest('.ws-recording-daygroup');
      cardEl.remove();
      if (group && !group.querySelector('.ws-recording-card')) group.remove();
    }
    if (recordingsEmpty) recordingsEmpty.hidden = recordingMap.size !== 0;
    if (selectionView === 'recordings') updateSelectionUI();
  }

  async function renderRecordings() {
    const cards = await loadAllRecordings();
    closeMenu();
    recordingMap.clear();
    recordingGrid.innerHTML = '';
    if (recordingsEmpty) recordingsEmpty.hidden = cards.length !== 0;
    // Group into day sections (Today / Yesterday / date), like a media library.
    const groups = groupRecordingsByDay(cards, {
      todayLabel: t('recToday', 'Today'),
      yesterdayLabel: t('recYesterday', 'Yesterday'),
    });
    const fragment = document.createDocumentFragment();
    groups.forEach((group) => {
      const section = document.createElement('section');
      section.className = 'ws-recording-daygroup';
      const head = document.createElement('h3');
      head.className = 'ws-recording-dayhead';
      head.textContent = group.label;
      const grid = document.createElement('div');
      grid.className = 'ws-recording-grid';
      group.items.forEach((card) => {
        recordingMap.set(String(card.id), card);
        grid.appendChild(buildRecordingCard(card));
      });
      section.append(head, grid);
      fragment.appendChild(section);
    });
    recordingGrid.appendChild(fragment);
    if (selectionView === 'recordings') updateSelectionUI();
  }

  if (recordingGrid) {
    recordingGrid.addEventListener('click', (event) => {
      const cardEl = event.target.closest('.ws-recording-card');
      if (!cardEl) return;
      const card = recordingMap.get(cardEl.dataset.id);
      if (!card) return;
      if (shouldSuppressCardClick('recordings', card.id)) {
        event.preventDefault();
        return;
      }
      if (event.target.closest('[data-select-item]')) {
        event.preventDefault();
        event.stopPropagation();
        toggleSelection('recordings', card.id);
        return;
      }
      const moreBtn = event.target.closest('[data-more-recording]');
      if (moreBtn) {
        event.stopPropagation();
        openMenu(anchorFromButton(moreBtn), recordingMenuItems(card));
        return;
      }
      openRecordingPreview(card);
    });
    bindLongPress(recordingGrid, 'recordings', '.ws-recording-card');
  }

  // ---- Multi-select toolbar ------------------------------------------------
  selectAllBtn?.addEventListener('click', () => {
    if (!selectionView) return;
    const ids = idsForSelectionView();
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    if (allSelected) {
      clearSelection();
      return;
    }
    selectedIds.clear();
    ids.forEach((id) => selectedIds.add(id));
    updateSelectionUI();
  });

  async function handleDownloadSelected() {
    if (selectionView !== 'recordings' || selectedIds.size === 0 || downloadingSelection) return;
    const cards = [...selectedIds].map((id) => recordingMap.get(String(id)));
    if (cards.some((card) => !card?.blob && !card?.hasBytes)) {
      showToast(t('recPreviewMissing', 'This recording is unavailable.'), { variant: 'error' });
      return;
    }
    if (cards.length === 1) {
      downloadRecording(cards[0]);
      clearSelection();
      return;
    }

    downloadingSelection = true;
    updateSelectionUI();
    discardSelectionArchive();
    downloadCancel = new AbortController();
    exportStatus.openProcessing(cards.length);
    const processingStartedAt = Date.now();
    try {
      selectionArchiveArtifact = await createStreamingZipArtifact(await recordingArchiveEntries(cards), {
        signal: downloadCancel.signal,
        onProgress: exportStatus.updateProgress,
      });
      await waitForMinimumZipProcessing(processingStartedAt);
      exportStatus.setSuccess();
    } catch (error) {
      discardSelectionArchive();
      // The popup's X aborted this export — it already dismissed itself.
      if (error?.name === 'AbortError') return;
      await waitForMinimumZipProcessing(processingStartedAt);
      const message = error?.name === 'ZipStorageError'
        ? t(
            'selectionDownloadTooLarge',
            'This ZIP is too large for this browser to create safely.',
          )
        : t('selectionDownloadError', 'Could not download selected recordings');
      exportStatus.setError(message);
    } finally {
      downloadingSelection = false;
      updateSelectionUI();
    }
  }

  downloadSelectedBtn?.addEventListener('click', handleDownloadSelected);

  deleteSelectedBtn?.addEventListener('click', async () => {
    if (!selectionView || selectedIds.size === 0) return;
    const view = selectionView;
    const ids = [...selectedIds];
    const isRecordings = view === 'recordings';
    const confirmed = await showConfirm({
      title: isRecordings
        ? t('selectionDeleteRecordingsTitle', 'Delete selected recordings')
        : t('selectionDeleteScriptsTitle', 'Delete selected scripts'),
      message: (isRecordings
        ? t(
            'selectionDeleteRecordingsMessage',
            'Delete {count} selected recordings? This cannot be undone.',
          )
        : t(
            'selectionDeleteScriptsMessage',
            'Delete {count} selected scripts? Their recordings will also be removed. This cannot be undone.',
          )
      ).replace('{count}', String(ids.length)),
      confirmLabel: t('confirmLabel', 'Delete'),
      cancelLabel: t('cancelLabel', 'Cancel'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      // One IndexedDB transaction for the whole batch instead of N parallel
      // open/transaction/close cycles.
      if (isRecordings) await deleteRecordings(ids);
      else await Promise.all(ids.map((id) => deleteWorkspaceCascade(id)));
      showToast(
        isRecordings
          ? t('selectionRecordingsDeleted', 'Selected recordings deleted')
          : t('selectionScriptsDeleted', 'Selected scripts deleted'),
      );
    } catch {
      showToast(t('selectionDeleteError', 'Some selected items could not be deleted'), {
        variant: 'error',
      });
    }

    clearSelection();
    if (isRecordings) {
      ids.forEach((id) => evictVideoThumbnail(id));
      await renderRecordings();
      renderStorage({ fresh: true });
    } else {
      await render();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectionView) clearSelection();
  });

  // ---- Sidebar view switch (Scripts / Recordings) --------------------------
  function switchView(view) {
    if (selectionView) clearSelection();
    const isRecordings = view === 'recordings';
    navButtons.forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (scriptsView) scriptsView.hidden = isRecordings;
    if (recordingsView) recordingsView.hidden = !isRecordings;
    closeMenu();
    if (isRecordings) {
      renderRecordings();
      // Storage budget (and its limit) is scoped to the record page only.
      renderStorage();
    } else {
      render();
    }
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      if (window.innerWidth <= MOBILE_BREAKPOINT) closeSidebar();
    });
  });

  // Latest storage snapshot for the settings dialog (device ceiling + budget).
  let storageMaxGB = 0;
  let storageBudgetGB = 2;

  async function renderStorage({ fresh = false } = {}) {
    if (!storageEl) return;
    const state = await checkStorage({ fresh });
    storageMaxGB = state.maxGB;
    storageBudgetGB = state.budgetGB;
    storageEl.hidden = false;
    storageEl.classList.toggle('is-warn', state.level === 'warn');
    storageEl.classList.toggle('is-full', state.level === 'full');
    if (storageValue) {
      storageValue.textContent = t('storageUsage', '{used} / {limit} GB')
        .replace('{used}', state.usedGB)
        .replace('{limit}', state.limitGB);
    }
    if (storageFill) storageFill.style.width = `${state.percent}%`;
    if (storageNote) {
      let note = '';
      if (state.level === 'full') note = t('storageFull', 'Storage is full — delete recordings to record more.');
      else if (state.level === 'warn') note = t('storageWarn', 'Almost full — delete old recordings to free space.');
      storageNote.textContent = note;
      storageNote.hidden = !note;
    }
  }

  // Local storage settings: master save on/off + max GB kept on this device.
  // The device quota is the hard ceiling (setStorageLimit clamps to it).
  async function openStorageSettings() {
    const maxHint = storageMaxGB ? String(storageMaxGB) : '—';
    // No Save/Cancel — the dialog auto-applies each change (toggle + limit).
    await showStorageSettings({
      title: t('storageSettingsTitle', 'Local storage'),
      intro: t('storageSettingsIntro', 'Recordings are saved on this device only.'),
      toggleLabel: t('storageSaveToggle', 'Save recordings on this device'),
      toggleHint: t('storageSaveToggleHint', 'Turn off to record without keeping the take.'),
      limitLabel: t('storageLimitLabel', 'Max local storage'),
      limitHint: t('storageEditHint', 'Max {max} GB on this device').replace('{max}', maxHint),
      unit: 'GB',
      value: storageBudgetGB || 2,
      min: 0.5,
      max: storageMaxGB || storageBudgetGB || 2,
      step: 0.5,
      saveEnabled: getRecordingSaveEnabled(),
      onChange: async ({ saveEnabled, limitGB }) => {
        setRecordingSave(saveEnabled);
        await setStorageLimit(limitGB);
        await renderStorage();
      },
    });
  }

  storageEditBtn?.addEventListener('click', openStorageSettings);

  // Every new user starts with one empty folder to organize into (one-shot).
  ensureDefaultFolder(t('folderNewDefault', 'New Folder'));
  render();
}
