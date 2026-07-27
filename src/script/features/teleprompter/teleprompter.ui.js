// teleprompter.ui.js — DOM root for the teleprompter studio. The only layer
// (besides components/) that touches the DOM. Loads the workspace script into
// the three prompt surfaces, wires the record FSM + auto-scroll + all studio
// widgets, and reflects state as classes on #app. Behavior ported from the demo
// recorder.js; heavy widgets delegate to components/.

import {
  createRecordingController,
  loadWorkspace,
  saveWorkspaceScript,
  saveWorkspaceSettings,
  resolveInitialSettings,
  isStorageWarningEnabled,
  setStorageWarningEnabled,
} from './teleprompter.logic.js';
import {
  clampWpm,
  clampScrollDuration,
  formatDuration,
  rangeFillPercent,
  WPM_DEFAULT,
  BAR_SPEED_STEP,
  SCROLL_STEP,
} from './teleprompter.model.js';
import '../../../styles/components/permission-popup.css';
import '../../../styles/components/toast.css';
import '../../../styles/features/voice-scroll.css';
import {
  getCaptureStream,
  stopStream,
  queryPermissionState,
  classifyMediaError,
} from '../../utils/media.js';
import { detectPlatform } from '../../utils/platform.js';
import { showPermissionPopup } from '../../components/permission-popup.js';
import { showToast } from '../../components/toast.js';
import { debounce } from '../../utils/debounce.js';
import { handlePlainTextPaste } from '../../utils/plain-paste.js';
import { isFullscreen, onFullscreenChange } from '../../utils/fullscreen.js';
import { createScrollController } from './components/scroll-controller.js';
import { createReadingSessionController } from './components/reading-session-controller.js';
import { createColorPicker } from './components/color-picker.ui.js';
import { initFormatToolbar } from './components/format-toolbar.ui.js';
import { initSettingsTheme } from './components/settings-theme.ui.js';
import { initNotch } from './components/notch.ui.js';
import { initLayoutGuides } from './components/layout-guides.ui.js';
import { createSharedEditHistory } from './components/shared-edit-history.js';
import { createStorageMonitor, checkBeforeRecord, formatBytes } from '../../utils/storage-monitor.js';
import { requestPersistentStorage } from '../../utils/storage-quota.js';
import { scopedId } from '../../utils/scoped-query.js';
import { initEditStaleBadge } from './collab/edit-stale-badge.ui.js';
import { initVoiceScrollUI } from './components/voice-scroll.ui.js';

const TIMESLICE_LABEL_MS = 250;

// Read the flat copy map embedded as an inert JSON <script> on the page.
function readCopy(root) {
  const node = root.querySelector('#tpCopy');
  if (!node) return {};
  try {
    return JSON.parse(node.textContent || '{}');
  } catch {
    return {};
  }
}

export function initTeleprompterUI(workspace, { root = document, onExit } = {}) {
  const $ = scopedId(root);
  const app = $('app');
  if (!app) return;
  // The entry always provides a workspace (an existing one, or a freshly created
  // scratch one), so there is no blocking empty state. Guard defensively anyway.
  if (!workspace) return;

  // Floating layers (color popup, scroll mirror) portal into the overlay root
  // when embedded; the standalone page keeps them on document.body.
  const portal = root === document ? document.body : root;

  let resolvePanelsReady;
  let rejectPanelsReady;
  const panelsReady = new Promise((resolve, reject) => {
    resolvePanelsReady = resolve;
    rejectPanelsReady = reject;
  });
  // Mark the root chain handled so a chunk-load failure before any user
  // interaction doesn't surface as a load-time unhandled rejection.
  panelsReady.catch(() => {});

  const cleanups = [];
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  };

  // Cross-tab "stale version" badge (edit view only). Wired up near teardown,
  // once the Play/Record mode helpers exist. Staleness tracks script CONTENT
  // only (not settings), so re-baseline the badge on every local content save
  // via notifyLocalWrite so this tab is never flagged for its own edit.
  let editStaleBadge = null;
  const notifyLocalWrite = () => {
    if (editStaleBadge) editStaleBadge.markLocalWrite();
  };

  // ---- Element refs ---------------------------------------------------------
  const promptBox = $('promptBox');
  const teleprompterText = $('teleprompterText');
  const cameraCanvas = $('cameraCanvas');
  const cameraFeed = $('cameraFeed');
  const cameraPlaceholder = $('cameraPlaceholder');
  const cameraPlaceholderText = $('cameraPlaceholderText');
  const prompterPanel = $('prompterPanel');
  const panelDragHandle = $('dragHandle');
  const panelResizeHandle = $('panelResizeHandle');
  const toastEl = $('toast');
  const recordButton = $('recordButton');
  const recordLabel = recordButton && recordButton.querySelector('.record-label');
  const speedControl = $('speedControl');
  const speedValue = $('speedValue');
  const speedRange = $('speedRange');
  const speedInput = $('speedInput');
  const speedOutput = $('speedOutput');
  const speedModeAuto = $('speedModeAuto');
  const speedMethodWpm = $('speedMethodWpm');
  const speedMethodTime = $('speedMethodTime');
  const speedWpmPanel = $('speedWpmPanel');
  const speedTimePanel = $('speedTimePanel');
  const scrollMinutes = $('scrollMinutes');
  const scrollSeconds = $('scrollSeconds');
  const scrollTimeRange = $('scrollTimeRange');
  const scrollTimeOutput = $('scrollTimeOutput');
  const pauseButton = $('pauseButton');
  const pauseLabel = pauseButton && pauseButton.querySelector('.pause-label');
  const headerPlayButton = $('headerPlayButton');
  const restartReadingButton = $('restartReadingButton');
  const exitPlaybackButton = $('exitPlaybackButton');
  const playBtn = $('playBtn');
  const playIcon = $('playIcon');
  const panelEditButton = $('panelEditButton');
  const formatToolbarElement = $('formatToolbar');
  const controlBar = prompterPanel && prompterPanel.querySelector('.control-bar');
  const controlBarActions = controlBar && controlBar.querySelector('.side:last-child');
  const formatToolbarHome = formatToolbarElement && formatToolbarElement.parentNode;
  const formatToolbarHomeNext = formatToolbarElement && formatToolbarElement.nextSibling;
  const layoutControl = $('layoutControl');
  const layoutControlHome = layoutControl && layoutControl.parentNode;
  const layoutControlHomeNext = layoutControl && layoutControl.nextSibling;
  const layoutFrameElement = $('layoutFrame');
  const layoutFrameHome = layoutFrameElement && layoutFrameElement.parentNode;
  const layoutFrameHomeNext = layoutFrameElement && layoutFrameElement.nextSibling;
  const recordCountdown = $('recordCountdown');
  const recordCountBox = $('recordCountBox');
  const stageEl = root.querySelector('.stage');

  // ---- Phone control relayout (≤600px) -------------------------------------
  // On phones the studio controls are re-composed into a tabbed bar by MOVING
  // the real nodes into the two tab panels (Record / Prompter) — they keep
  // their listeners, same idea as the panel hops below. Homes are captured now,
  // before any relocation, so desktop can restore the exact original order.
  const mPanelMain = $('mPanelMain');
  const mPanelTools = $('mPanelTools');
  const phoneViewport = window.matchMedia('(max-width: 600px)');
  const recordControls = root.querySelector('.record-controls');
  const cameraToggle = root.querySelector('[data-toggle="camera"]');
  const micToggle = root.querySelector('[data-toggle="mic"]');
  const prompterToggle = root.querySelector('[data-action="Prompter"]');
  const mirrorControlEl = $('mirrorControl');
  const speedControlEl = speedControl;
  const settingsControlEl = $('settingsControl');
  // Document order — restore walks this reversed so each node's original next
  // sibling is already back in place before we re-insert it.
  const phoneMovable = [
    recordControls, headerPlayButton, cameraToggle, micToggle, prompterToggle,
    mirrorControlEl, layoutControl, speedControlEl, settingsControlEl,
  ].filter(Boolean).map((el) => ({ el, parent: el.parentNode, next: el.nextSibling }));

  function applyPhoneLayout() {
    if (!mPanelMain || !mPanelTools) return;
    if (phoneViewport.matches) {
      // Tab 1 (Record): camera · mic · RECORD · play · settings.
      [cameraToggle, micToggle, recordControls, headerPlayButton, settingsControlEl]
        .forEach((el) => { if (el) mPanelMain.appendChild(el); });
      // Tab 2 (Prompter): layout · speed · mirror · (prompter, cam-on only).
      [layoutControl, speedControlEl, mirrorControlEl, prompterToggle]
        .forEach((el) => { if (el) mPanelTools.appendChild(el); });
    } else {
      phoneMovable.slice().reverse().forEach(({ el, parent, next }) => {
        if (!parent) return;
        const anchor = next && next.parentNode === parent ? next : null;
        parent.insertBefore(el, anchor);
      });
    }
  }
  applyPhoneLayout();
  phoneViewport.addEventListener('change', applyPhoneLayout);
  cleanups.push(() => phoneViewport.removeEventListener('change', applyPhoneLayout));

  // Phone bar tabs: switch between the Record group and the Prompter tools.
  root.querySelectorAll('.m-tab').forEach((tab) => {
    on(tab, 'click', () => {
      const target = tab.dataset.tab;
      root.querySelectorAll('.m-tab').forEach((t) => {
        const active = t.dataset.tab === target;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      root.querySelectorAll('.m-tab-panel').forEach((p) => {
        p.classList.toggle('active', p.dataset.panel === target);
      });
    });
  });

  // Copy strings from 11ty JSON, embedded as a JSON <script> tag on the page
  // (not executable — safe under CSP, and no window.__ channel).
  const copy = readCopy(root);

  // ---- Camera / mic permission gate -----------------------------------------
  // We let the browser show its own native prompt (no pre-prompt dialog). A
  // blocked permission can't be re-prompted from JS, so once it's actually
  // 'denied' we show platform-specific re-enable steps instead.
  const platform = detectPlatform();

  // Show the "permission blocked" guidance popup: a platform illustration with a
  // red box on the control to tap, plus short steps. No retry button — the user
  // changes the setting and reloads (the steps say so).
  function openPermissionGuidance(blocked) {
    return showPermissionPopup({
      blocked,
      platform,
      copy: copy.permission || {},
    });
  }

  // A getUserMedia NotAllowedError fires BOTH when the user hard-blocks and when
  // they merely dismiss the native prompt (still re-askable). Only the Permissions
  // API state tells them apart: 'denied' = blocked (needs site settings), 'prompt'
  // = dismissed (clicking again re-prompts). Show the re-enable guide only for a
  // confirmed 'denied'. `kinds` is [{ perm, label }]. Returns true if guided.
  async function guideIfBlocked(kinds) {
    const states = await Promise.all(kinds.map((k) => queryPermissionState(k.perm)));
    const blocked = kinds.filter((_, i) => states[i] === 'denied').map((k) => k.label);
    if (blocked.length) openPermissionGuidance(blocked);
    return blocked.length > 0;
  }

  // Gate a getUserMedia call. Returns true when the caller may proceed. We don't
  // pre-prompt: a 'prompt' state just falls through so the caller's getUserMedia
  // shows the browser's own native dialog. Only a real 'denied' gets our guide.
  async function ensureCaptureAllowed({ video = false, audio = false } = {}) {
    const kinds = [];
    if (video) kinds.push({ perm: 'camera', label: 'camera' });
    if (audio) kinds.push({ perm: 'microphone', label: 'mic' });
    if (!kinds.length) return true;

    const states = await Promise.all(kinds.map((k) => queryPermissionState(k.perm)));
    const blocked = kinds.filter((_, i) => states[i] === 'denied').map((k) => k.label);
    if (blocked.length) {
      const result = await openPermissionGuidance(blocked);
      return result === 'granted';
    }
    return true;
  }

  // ---- Studio settings: this script's own, or the global last-used defaults --
  // A new script (no settings yet) inherits the one global store; an existing
  // script uses its own. Every change mirrors into both (see logic layer).
  const savedSettings = resolveInitialSettings(workspace);

  // ---- Script load: fill the prompt surfaces --------------------------------
  // Prefer the rich innerHTML (keeps inline formatting); fall back to plain text
  // for scripts saved before rich persistence (and to auto-escape safely).
  const scriptText = workspace.scriptText || '';
  const scriptHtml = workspace.scriptHtml || '';
  if (scriptHtml) {
    if (promptBox) promptBox.innerHTML = scriptHtml;
    if (teleprompterText) teleprompterText.innerHTML = scriptHtml;
  } else {
    if (promptBox) promptBox.textContent = scriptText;
    if (teleprompterText) teleprompterText.textContent = scriptText;
  }

  // All rich-text editors are views of this single script state. Browser-native
  // contenteditable undo stacks are isolated per element, so keep one explicit
  // timeline that follows the script when focus moves between views.
  let sharedAlign = savedSettings.align || 'left';
  const editHistory = createSharedEditHistory({
    html: promptBox ? promptBox.innerHTML : scriptHtml,
    align: sharedAlign,
    fontSize: savedSettings.fontSize,
    lineHeight: savedSettings.lineHeight,
    color: savedSettings.color,
    bold: savedSettings.bold,
    italic: savedSettings.italic,
    underline: savedSettings.underline,
  }, {
    onApply: (state) => applySharedState(state, { syncToolbars: true }),
  });
  let notch = null;
  let formatToolbar = null;
  let readingSession = null;

  // Serializing state.html into a detached div (for the plain-text snippet) and
  // rewriting the whole workspaces list in localStorage is O(script × library)
  // — far too heavy per keystroke, so persistence trails the typing burst.
  const persistSharedState = debounce((state) => {
    const holder = document.createElement('div');
    holder.innerHTML = state.html;
    saveWorkspaceScript(workspace.id, { text: holder.innerText, html: state.html });
    notifyLocalWrite();
  }, 500);

  // While typing, only the source surface holds the live HTML; hidden sibling
  // surfaces are marked dirty and re-filled from the shared state at the next
  // mode switch (camera toggle / notch close / reading start) instead of being
  // re-parsed on every keystroke.
  const dirtySurfaces = new Set();

  function syncSurface(surface) {
    if (!surface || !dirtySurfaces.has(surface)) return;
    dirtySurfaces.delete(surface);
    const state = editHistory.current();
    if (surface.innerHTML !== state.html) surface.innerHTML = state.html;
    surface.style.textAlign = sharedAlign;
  }

  function syncDirtySurfaces() {
    [promptBox, teleprompterText].forEach(syncSurface);
  }

  function applySharedState(state, {
    source = null,
    persist = true,
    syncToolbars = false,
  } = {}) {
    if (!state) return;
    sharedAlign = state.align || 'left';
    [promptBox, teleprompterText].forEach((surface) => {
      if (!surface) return;
      if (surface === source) {
        dirtySurfaces.delete(surface);
        surface.style.textAlign = sharedAlign;
        return;
      }
      // A committed edit (source set) only ever comes from the visible editor;
      // its siblings are hidden, so defer their innerHTML rewrite.
      if (source) {
        dirtySurfaces.add(surface);
        return;
      }
      if (surface.innerHTML !== state.html) surface.innerHTML = state.html;
      surface.style.textAlign = sharedAlign;
      dirtySurfaces.delete(surface);
    });
    if (syncToolbars && formatToolbar) formatToolbar.applySettings(state);
    // The notch editor re-copies from the visible surface every time it opens
    // (notch.ui.js), so it only needs live mirroring while the notch is on.
    const notchEditor = $('notchEditText');
    const notchActive = Boolean(notch && notch.isActive());
    if (notchActive && notchEditor && notchEditor !== source) {
      // Edit came from a main surface: mirror the committed state into the notch
      // editor, then refresh the preview from that (fresh) main surface.
      notchEditor.innerHTML = state.html;
      notchEditor.style.textAlign = sharedAlign;
      notchEditor.style.fontSize = state.fontSize ? `${state.fontSize}px` : '';
      notchEditor.style.lineHeight = state.lineHeight || '1.25';
      notchEditor.style.color = state.color || '';
      notchEditor.style.fontWeight = state.bold ? 'bold' : '';
      notchEditor.style.fontStyle = state.italic ? 'italic' : '';
      notchEditor.style.textDecoration = state.underline ? 'underline' : '';
      notch.syncNotchText();
    } else if (notchActive) {
      // Edit came from the notch editor itself — typed OR toolbar-formatted. The
      // main surfaces are stale (dirty) here, so refresh the preview straight
      // from notchEditText rather than syncNotchText (which reads a main surface
      // and would clobber the live edit with old content).
      notch.syncPreview();
    }
    if (persist) persistSharedState(state);
  }

  function commitSharedEdit(source, settingsPatch = {}) {
    if (!source) return;
    const state = editHistory.commit({
      ...editHistory.current(),
      ...settingsPatch,
      html: source.innerHTML,
    });
    applySharedState(state, {
      source,
      syncToolbars: Object.keys(settingsPatch).length > 0,
    });
  }

  function commitSharedAlignment(align) {
    const state = editHistory.commit({ ...editHistory.current(), align });
    applySharedState(state, { syncToolbars: true });
    saveWorkspaceSettings(workspace.id,{ align: state.align });
  }

  // ---- Storage warning toast ------------------------------------------------
  let toastTimer = null;

  // ---- Shared color picker --------------------------------------------------
  const colorPicker = createColorPicker({ portal });

  // ---- Camera + mic ---------------------------------------------------------
  let cameraStream = null;
  let cameraRequestId = 0;
  // Preview khung camera bám theo tỷ lệ THẬT camera xuất ra (đọc từ getSettings/
  // loadedmetadata khi bật cam) để preview == file quay. 16:9 chỉ là fallback tạm
  // trước khi biết tỷ lệ. Mobile: camera hiển thị full màn theo khung thiết bị.
  const DEFAULT_CAMERA_ASPECT = 16 / 9;
  let cameraAspect = DEFAULT_CAMERA_ASPECT;
  const mobileViewport = window.matchMedia('(max-width: 768px)');

  function updateCameraCanvasSize() {
    if (!stageEl || !cameraCanvas) return;
    if (mobileViewport.matches) {
      cameraCanvas.style.width = '';
      cameraCanvas.style.height = '';
      return;
    }
    const stageRect = stageEl.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return;
    const stageRatio = stageRect.width / stageRect.height;
    const width = stageRatio > cameraAspect ? stageRect.height * cameraAspect : stageRect.width;
    const height = stageRatio > cameraAspect ? stageRect.height : stageRect.width / cameraAspect;
    cameraCanvas.style.width = `${Math.round(width)}px`;
    cameraCanvas.style.height = `${Math.round(height)}px`;
  }

  // Cập nhật khung preview theo kích thước camera thực sự trả về. Guard theo
  // requestId để một startCamera cũ không ghi đè tỷ lệ của lần bật mới nhất.
  function applyCameraAspect(width, height, requestId) {
    if (requestId !== cameraRequestId) return;
    if (!(width > 0) || !(height > 0)) return;
    cameraAspect = width / height;
    updateCameraCanvasSize();
  }

  async function startCamera() {
    const requestId = ++cameraRequestId;
    if (cameraPlaceholderText) cameraPlaceholderText.textContent = copy.cameraStarting || '';
    try {
      const { popups } = await panelsReady;
      const selectedDeviceId = popups.getSelectedDeviceId('camera');
      // Preview opens the camera at its own default mode (no resolution/aspect
      // constraints) — same as logic.js records with — so preview and take match.
      const video = selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true;

      // Prime on a first-ever request; show guidance (and bail) if already blocked.
      const allowed = await ensureCaptureAllowed({ video: true });
      if (requestId !== cameraRequestId) return;
      if (!allowed) {
        setCameraToggle(false); // declined/blocked → don't leave the cam button on
        return;
      }

      const stream = await getCaptureStream({ video, audio: false });
      if (requestId !== cameraRequestId || !app.classList.contains('cam-on')) {
        stopStream(stream);
        return;
      }
      cameraStream = stream;
      // "Check resolution" ngay khi bật cam: lấy tỷ lệ thật để dựng khung preview
      // khớp với file quay (raw stream, native ratio) — hết cảnh preview 16:9 cắt/zoom.
      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        const { width, height } = videoTrack.getSettings();
        applyCameraAspect(width, height, requestId);
      }
      if (cameraFeed) {
        cameraFeed.srcObject = stream;
        // Backup khi getSettings() chưa có dims kịp lúc (một số browser).
        on(cameraFeed, 'loadedmetadata', () => {
          applyCameraAspect(cameraFeed.videoWidth, cameraFeed.videoHeight, requestId);
        }, { once: true });
      }
      if (cameraPlaceholder) cameraPlaceholder.classList.remove('show');
    } catch (err) {
      if (requestId !== cameraRequestId) return;
      const reason = classifyMediaError(err);
      if (reason === 'denied') {
        setCameraToggle(false); // declined/dismissed → turn the cam button off
        await guideIfBlocked([{ perm: 'camera', label: 'camera' }]); // guide only if truly blocked
        return;
      }
      if (cameraPlaceholderText) {
        cameraPlaceholderText.textContent = cameraErrorText(reason, err);
      }
    }
  }

  // Map a classified capture failure to the camera placeholder message.
  function cameraErrorText(reason, err) {
    if (reason === 'denied') return copy.micDenied || copy.cameraError || '';
    if (reason === 'not-found') return copy.cameraNoDevice || '';
    if (reason === 'in-use') return copy.cameraInUse || '';
    if (reason === 'overconstrained') return copy.cameraOverconstrained || '';
    return `${copy.cameraErrorPrefix || ''}${err ? err.name : ''}${copy.cameraErrorSuffix || ''}`;
  }

  function stopCamera() {
    cameraRequestId += 1;
    stopStream(cameraStream);
    cameraStream = null;
    if (cameraFeed) cameraFeed.srcObject = null;
    // Lần bật sau bắt đầu lại từ fallback, tránh nháy tỷ lệ camera cũ.
    cameraAspect = DEFAULT_CAMERA_ASPECT;
  }

  function setFormatEditOpen(open) {
    const nextOpen = Boolean(open && app.classList.contains('cam-on'));
    app.classList.toggle('format-edit-open', nextOpen);
    if (panelEditButton) {
      panelEditButton.classList.toggle('active', nextOpen);
      panelEditButton.setAttribute('aria-pressed', String(nextOpen));
    }
  }

  function setFormatToolbarInPanel(inPanel) {
    if (!formatToolbarElement) return;
    if (inPanel && prompterPanel && controlBar) {
      prompterPanel.insertBefore(formatToolbarElement, controlBar);
      return;
    }
    if (!formatToolbarHome) return;
    const anchor = formatToolbarHomeNext && formatToolbarHomeNext.parentNode === formatToolbarHome
      ? formatToolbarHomeNext
      : null;
    formatToolbarHome.insertBefore(formatToolbarElement, anchor);
  }

  function setLayoutFrameInPanel(inPanel) {
    if (!layoutFrameElement) return;
    if (inPanel && prompterPanel) {
      prompterPanel.appendChild(layoutFrameElement);
      return;
    }
    if (!layoutFrameHome) return;
    const anchor = layoutFrameHomeNext && layoutFrameHomeNext.parentNode === layoutFrameHome
      ? layoutFrameHomeNext
      : null;
    layoutFrameHome.insertBefore(layoutFrameElement, anchor);
  }

  function setLayoutControlInPanel(inPanel) {
    if (!layoutControl) return;
    // On phones the layout toggle lives in the centered record bar, not the
    // panel control-bar — don't let the cam-on hop pull it back out.
    if (phoneViewport.matches) return;
    if (inPanel && controlBarActions) {
      controlBarActions.insertBefore(layoutControl, panelEditButton || controlBarActions.firstChild);
      return;
    }
    if (!layoutControlHome) return;
    const anchor = layoutControlHomeNext && layoutControlHomeNext.parentNode === layoutControlHome
      ? layoutControlHomeNext
      : null;
    layoutControlHome.insertBefore(layoutControl, anchor);
  }

  function setCameraMode(nextOn) {
    setFormatEditOpen(false);
    if (nextOn) {
      syncSurface(teleprompterText);
      app.classList.add('cam-on');
      setFormatToolbarInPanel(true);
      setLayoutFrameInPanel(true);
      setLayoutControlInPanel(true);
      updateCameraCanvasSize();
      if (cameraPlaceholderText) cameraPlaceholderText.textContent = copy.cameraStarting || '';
      if (cameraPlaceholder) cameraPlaceholder.classList.add('show');
      if (readingSession) readingSession.switchSurface(teleprompterText);
      startCamera();
    } else {
      syncSurface(promptBox);
      setFormatToolbarInPanel(false);
      setLayoutFrameInPanel(false);
      setLayoutControlInPanel(false);
      app.classList.remove('cam-on');
      if (readingSession) readingSession.switchSurface(promptBox);
      stopCamera();
      if (cameraPlaceholder) cameraPlaceholder.classList.remove('show');
    }
    // Layout vừa đổi → đồng bộ nút Prompter + editing theo cờ ẩn của layout mới.
    applyPrompterVisibility();
    requestAnimationFrame(() => layout.update());
  }

  on(panelEditButton, 'mousedown', (event) => event.preventDefault());
  on(panelEditButton, 'click', () => {
    setFormatEditOpen(!app.classList.contains('format-edit-open'));
  });

  // ---- Active surface resolution --------------------------------------------
  const activeSurface = () => {
    if (notch.isActive()) return notch.getScroll();
    return app.classList.contains('cam-on') ? teleprompterText : promptBox;
  };
  const activeEditSurface = () => (app.classList.contains('cam-on') ? teleprompterText : promptBox);

  // ---- Auto-scroll controller ----------------------------------------------
  const scroller = createScrollController({
    getSurface: activeSurface,
    onStateChange: (playing) => setPlayIcon(playing),
    portal,
  });

  // ---- Voice Scroll (Auto Scroll) -----------------------------------------
  let voiceScrollUI = null;
  let voiceScrollStarting = false;
  let voiceScrollAttempt = 0;
  let selectedScrollMode = savedSettings.scrollMode || 'auto';

  function setSpeedModePanel(mode) {
    const auto = mode === 'auto';
    const timed = mode === 'time';
    selectedScrollMode = auto ? 'auto' : timed ? 'time' : 'wpm';
    if (speedModeAuto) {
      speedModeAuto.classList.toggle('selected', auto);
      speedModeAuto.setAttribute('aria-checked', String(auto));
    }
    if (speedMethodWpm) {
      speedMethodWpm.classList.toggle('selected', !auto && !timed);
      speedMethodWpm.setAttribute('aria-checked', String(!auto && !timed));
    }
    if (speedMethodTime) {
      speedMethodTime.classList.toggle('selected', timed);
      speedMethodTime.setAttribute('aria-checked', String(timed));
    }
    if (speedWpmPanel) speedWpmPanel.hidden = auto || timed;
    if (speedTimePanel) speedTimePanel.hidden = !timed;
    if (speedValue) speedValue.textContent = auto ? 'AUTO' : timed ? 'TIME' : String(wpm);
    if (speedControl) {
      speedControl.setAttribute(
        'aria-label',
        auto
          ? 'Scroll mode: auto scroll'
          : timed
            ? `Scroll mode: ${scrollDurationSeconds} seconds`
            : `Scroll mode: ${wpm} words per minute`,
      );
    }
  }

  function setVoiceScrollButton({ active = false, busy = false } = {}) {
    if (speedControl) {
      speedControl.classList.toggle('auto-scroll-active', active || busy);
      if (active || busy) speedControl.setAttribute('aria-label', 'Auto scroll is active');
      else {
        speedControl.setAttribute(
          'aria-label',
          selectedScrollMode === 'auto'
            ? 'Scroll mode: auto scroll'
            : selectedScrollMode === 'time'
              ? `Scroll mode: ${scrollDurationSeconds} seconds`
              : `Scroll mode: ${wpm} words per minute`,
        );
      }
    }
  }

  function voiceScrollErrorMessage(error) {
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      return 'Microphone permission is required for voice scroll';
    }
    if (error === 'audio-capture') return copy.cameraNoDevice || 'No microphone is available';
    if (error === 'network') return 'Speech recognition network error';
    if (error === 'recognizer-busy') {
      return 'Microphone conflict: another tab or browser voice feature is using speech recognition. Stop it, then try Auto again';
    }
    if (error === 'start-timeout') return 'Speech recognition did not start';
    if (/does not support|unsupported/i.test(error || '')) {
      return 'This browser does not support voice scroll';
    }
    return 'Voice scroll stopped because speech recognition failed';
  }

  function stopVoiceScroll({ error = '' } = {}) {
    voiceScrollAttempt += 1;
    voiceScrollStarting = false;
    const current = voiceScrollUI;
    voiceScrollUI = null;
    if (current) current.stop();
    app.classList.remove('voice-scroll-active');
    setVoiceScrollButton();
    setPlayIcon(false);
    if (error) {
      showToast(voiceScrollErrorMessage(error), {
        variant: 'error',
        duration: error === 'recognizer-busy' ? 6000 : undefined,
      });
    }
  }

  function ensureVoiceScrollStopped() {
    if (voiceScrollUI || voiceScrollStarting) stopVoiceScroll();
  }

  async function requestVoiceScrollMicrophone() {
    const allowed = await ensureCaptureAllowed({ audio: true });
    // Match the proven reference implementation: SpeechRecognition owns the
    // microphone request. Opening and closing a separate getUserMedia stream
    // here can race Chrome's recognizer on macOS.
    return allowed;
  }

  async function startVoiceScroll() {
    if (voiceScrollUI || voiceScrollStarting || selectedScrollMode !== 'auto') return;
    const attempt = ++voiceScrollAttempt;
    voiceScrollStarting = true;
    setVoiceScrollButton({ busy: true, phase: 'requesting-microphone' });
    console.info('[VoiceScroll] requesting microphone');

    try {
      const micReady = await requestVoiceScrollMicrophone();
      if (attempt !== voiceScrollAttempt) return;
      if (!micReady) {
        voiceScrollStarting = false;
        setVoiceScrollButton();
        return;
      }

      // ON → start voice scroll
      scroller.stop();  // Stop WPM auto-scroll if running
      syncDirtySurfaces();
      const candidate = initVoiceScrollUI({
        getSurface: activeSurface,
        onPhaseChange: (phase) => {
          if (candidate !== voiceScrollUI) return;
          setVoiceScrollButton({
            active: phase === 'listening',
            busy: phase === 'detecting',
            phase,
          });
        },
        onError: (error) => {
          if (candidate !== voiceScrollUI) return;
          stopVoiceScroll({ error });
        },
      });
      voiceScrollUI = candidate;
      const started = await candidate.start();

      if (attempt !== voiceScrollAttempt || candidate !== voiceScrollUI) {
        candidate.stop();
        return;
      }
      if (!started) {
        stopVoiceScroll({ error: 'start-timeout' });
        return;
      }

      voiceScrollStarting = false;
      app.classList.add('voice-scroll-active');
      setVoiceScrollButton({ active: true, phase: 'listening' });
      setPlayIcon(true);
      showToast('Voice scroll is listening');
    } catch (err) {
      console.error('[VoiceScroll] failed to start', err);
      if (attempt === voiceScrollAttempt) {
        stopVoiceScroll({ error: err?.message || 'unknown' });
      }
    }
  }

  let playbackOnlyActive = false;
  let colorBeforeNotch = null;
  let didAutoChangeColor = false;

  const PLAY_PATH = 'M8 5v14l11-7z';
  const PAUSE_PATH = 'M7 5h4v14H7zM13 5h4v14h-4z';
  function setPlayIcon(playing) {
    if (playIcon) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', playing ? PAUSE_PATH : PLAY_PATH);
      playIcon.replaceChildren(path);
    }
    if (playBtn) playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (headerPlayButton) {
      headerPlayButton.classList.toggle('playing', playing);
      headerPlayButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
  }

  // Add enough trailing space so that the final line stops at 20% of the screen height,
  // preventing it from scrolling beyond the screen. Seat the first line on the
  // eye-line so it stays put after the center-on-record slide finishes.
  function prepareScrollSurface(surface, restart = false) {
    if (!surface) return false;
    const savedScrollTop = restart ? 0 : surface.scrollTop;
    surface.style.removeProperty('--tp-scroll-tail');
    surface.style.paddingTop = '';
    surface.style.paddingBottom = '';
    if (restart) surface.scrollTop = 0;
    const styles = getComputedStyle(surface);
    const baseBottom = parseFloat(styles.paddingBottom) || 0;
    const recordHeight = surface.clientHeight;
    const stopThreshold = recordHeight * 0.2;
    const trailing = Math.max(0, recordHeight - stopThreshold - baseBottom);
    surface.style.paddingTop = `${layout.eyeLineStartPadding(surface, true)}px`;
    // A pseudo-element grows scrollHeight without making the fixed-height
    // reading viewport itself taller, unlike a very large padding-bottom.
    surface.style.setProperty('--tp-scroll-tail', `${trailing}px`);
    // Rebuilding the tail can temporarily clamp scrollTop near the end. Restore
    // the paused position only after the scrollable layout is rebuilt.
    if (!restart) surface.scrollTop = savedScrollTop;
    return surface.scrollHeight - surface.clientHeight > 1;
  }

  readingSession = createReadingSessionController({
    scroller,
    getSurface: activeSurface,
    prepareSurface: prepareScrollSurface,
    getScrollMode: () => selectedScrollMode,
    configureScroll: (mode, surface) => {
      if (mode === 'time') scroller.setDuration(scrollDurationSeconds, surface);
      else scroller.setWpm(wpm);
    },
    startVoiceScroll,
    stopVoiceScroll: ensureVoiceScrollStopped,
    isVoiceScrollRunning: () => Boolean(voiceScrollUI || voiceScrollStarting),
  });

  // Play uses the exact same distraction-free reading UI as Record. The only
  // differences are that no MediaRecorder is started and the recording Pause
  // button stays hidden.
  function enterReadingUI(onCentered) {
    syncDirtySurfaces();
    // A contenteditable can retain focus after it is disabled. Move focus out
    // so reading shortcuts (especially Space) are not mistaken for text input.
    const focused = document.activeElement;
    if (focused === promptBox || focused === teleprompterText) focused.blur();
    setFormatEditOpen(false);
    app.classList.add('record-dim');
    setReadingScrollCapture(true);
    notch.closeNotchEdit();
    layout.centerOnRecord(activeSurface(), onCentered);
    requestAnimationFrame(() => layout.update());
  }

  function stopPlaybackOnly() {
    if (!playbackOnlyActive) return;
    playbackOnlyActive = false;
    app.classList.remove('playback-only', 'record-dim', 'record-paused');
    setReadingScrollCapture(false);
    readingSession.stop();
    activeSurface()?.style.removeProperty('--tp-scroll-tail');
    layout.restore(activeSurface());
    setEditingEnabled(true);
    if (pauseButton) pauseButton.classList.remove('show', 'paused');
    if (headerPlayButton) headerPlayButton.classList.remove('hidden');
    requestAnimationFrame(() => layout.update());
  }

  function togglePlayback() {
    // While recording, this control only starts/stops auto-scroll; recording
    // pause remains owned by the separate Pause button.
    if (controller.isRecording() || controller.isPaused() || countingDown) {
      readingSession.toggleScroll();
      return;
    }
    if (playbackOnlyActive) {
      // The Play control doubles as Pause while in reading mode. Keep the
      // reading session mounted so starting it again resumes from the current
      // scrollTop instead of restoring the layout and beginning at the top.
      readingSession.toggleScroll();
      return;
    }
    playbackOnlyActive = true;
    app.classList.add('playback-only');
    app.classList.remove('record-paused');
    if (pauseButton) pauseButton.classList.remove('show', 'paused');
    if (headerPlayButton) headerPlayButton.classList.remove('hidden');
    setEditingEnabled(false);
    readingSession.begin('play', { waitFor: ['layout'] });
    enterReadingUI(() => readingSession.release('layout'));
  }

  on(playBtn, 'click', togglePlayback);
  on(headerPlayButton, 'click', togglePlayback);
  on(restartReadingButton, 'click', () => {
    readingSession.restart();
  });
  on(exitPlaybackButton, 'click', stopPlaybackOnly);

  // ---- Toolbar toggles: camera / mic ---------------------------------------
  // Reflect a toggle's on/off visual + label. No capture side effects.
  function applyToggleState(button, type, enabled) {
    if (!button) return;
    button.setAttribute('aria-pressed', String(enabled));
    button.classList.toggle('active', enabled);
    button.classList.toggle('is-off', !enabled);
    const label = button.querySelector('.label');
    if (!label) return;
    label.textContent =
      type === 'camera'
        ? enabled ? (copy.hideCam || 'Hide Cam') : (copy.showCam || 'Show Cam')
        : enabled ? (copy.muteMic || 'Mute Mic') : (copy.unmuteMic || 'Unmute Mic');
  }

  // Turn the camera on/off. startCamera() acquires permission + preview and
  // reverts this toggle (setCameraToggle(false)) if access is refused, so the
  // button never stays active while the device is blocked.
  async function setCameraToggle(on) {
    if (on && (await queryPermissionState('camera')) === 'denied') {
      const res = await openPermissionGuidance(['camera']);
      if (res !== 'granted') {
        applyToggleState(cameraToggle, 'camera', false);
        return;
      }
    }
    applyToggleState(cameraToggle, 'camera', on);
    setCameraMode(on);
  }

  // Turn the mic on/off. Turning on acquires permission NOW (so the browser
  // prompts here, before any countdown) and only sticks if access is granted.
  async function setMicToggle(on) {
    if (on) {
      const allowed = await ensureCaptureAllowed({ audio: true });
      if (!allowed) {
        applyToggleState(micToggle, 'mic', false);
        return;
      }
      try {
        const probe = await getCaptureStream({ audio: true, video: false });
        stopStream(probe);
      } catch (err) {
        const reason = classifyMediaError(err);
        applyToggleState(micToggle, 'mic', false);
        if (reason === 'denied') await guideIfBlocked([{ perm: 'microphone', label: 'mic' }]);
        else showToast(cameraErrorText(reason, err));
        return;
      }
    }
    applyToggleState(micToggle, 'mic', on);
    panelsReady.then((p) => p.popups.refreshMobileMicValue()).catch(() => {});
  }

  root.querySelectorAll('[data-toggle]').forEach((button) => {
    on(button, 'click', () => {
      const turningOn = button.getAttribute('aria-pressed') !== 'true';
      if (button.dataset.toggle === 'camera') setCameraToggle(turningOn);
      else setMicToggle(turningOn);
    });
  });

  // On load, don't show a device as active if the browser hasn't granted it
  // (the mic toggle defaults to on). Reconcile against the real permission.
  (async () => {
    if (micToggle && micToggle.getAttribute('aria-pressed') === 'true') {
      if ((await queryPermissionState('microphone')) !== 'granted') {
        applyToggleState(micToggle, 'mic', false);
        panelsReady.then((p) => p.popups.refreshMobileMicValue()).catch(() => {});
      }
    }
  })();
  const micButton = root.querySelector('[data-toggle="mic"]');
  const micEnabled = () => micButton && micButton.getAttribute('aria-pressed') === 'true';
  const cameraEnabled = () => app.classList.contains('cam-on');

  // ---- Prompter show/hide ---------------------------------------------------
  const prompterButton = root.querySelector('[data-action="Prompter"]');
  // Cam ON (.panel) và cam OFF (.prompt-box) là hai layout của cùng một script;
  // mỗi layout giữ cờ ẩn/hiện riêng để "cắt" teleprompter ở layout này không kéo
  // theo ẩn layout kia khi chuyển cam.
  let camOnPrompterHidden = false; // .panel — cam ON
  let camOffPrompterHidden = false; // .prompt-box — cam OFF
  const isPrompterHidden = () => (cameraEnabled() ? camOnPrompterHidden : camOffPrompterHidden);
  function applyPrompterVisibility() {
    const hidden = isPrompterHidden();
    if (prompterPanel) prompterPanel.classList.toggle('closed', camOnPrompterHidden);
    if (promptBox) promptBox.classList.toggle('hidden', camOffPrompterHidden);
    if (prompterButton) prompterButton.classList.toggle('selected', !hidden);
    if (hidden && readingSession) readingSession.stopScroll();
    layout.setEditing(!hidden);
  }
  function setPrompterHidden(hidden) {
    if (cameraEnabled()) camOnPrompterHidden = hidden;
    else camOffPrompterHidden = hidden;
    applyPrompterVisibility();
  }
  root.querySelectorAll('[data-action]').forEach((button) => {
    on(button, 'click', () => {
      if (button.dataset.action === 'Prompter') {
        setPrompterHidden(!isPrompterHidden());
        return;
      }
    });
  });

  // ---- Mirror ---------------------------------------------------------------
  const mirrorControl = $('mirrorControl');
  function setMirror(mirrored) {
    if (mirrorControl) {
      mirrorControl.setAttribute('aria-pressed', String(mirrored));
      mirrorControl.classList.toggle('selected', mirrored);
    }
    if (promptBox) promptBox.classList.toggle('prompter-mirrored', mirrored);
    if (teleprompterText) teleprompterText.classList.toggle('prompter-mirrored', mirrored);
    app.classList.toggle('mirror-on', mirrored);
  }
  on(mirrorControl, 'click', () => {
    const mirrored = mirrorControl.getAttribute('aria-pressed') !== 'true';
    setMirror(mirrored);
    saveWorkspaceSettings(workspace.id,{ mirror: mirrored });
  });
  // Restore this script's saved mirror state.
  if (savedSettings.mirror) setMirror(true);

  // ---- Speed ----------------------------------------------------------------
  const barSpeedValue = $('barSpeedValue');
  let wpm = WPM_DEFAULT;
  let scrollDurationSeconds = clampScrollDuration(savedSettings.scrollDurationSeconds);
  let scrollDurationSaveTimer = null;

  function applyScrollDuration(explicitSeconds = null, persist = true) {
    const minutes = Math.max(0, Math.round(Number(scrollMinutes?.value) || 0));
    const seconds = Math.max(0, Math.min(59, Math.round(Number(scrollSeconds?.value) || 0)));
    const requested = explicitSeconds == null ? minutes * 60 + seconds : Number(explicitSeconds);
    scrollDurationSeconds = clampScrollDuration(requested);
    if (scrollMinutes) scrollMinutes.value = String(Math.floor(scrollDurationSeconds / 60));
    if (scrollSeconds) scrollSeconds.value = String(scrollDurationSeconds % 60);
    if (scrollTimeRange) {
      scrollTimeRange.min = '0';
      scrollTimeRange.max = '3600';
      const rangeValue = Math.max(0, Math.min(3600, scrollDurationSeconds));
      scrollTimeRange.value = String(rangeValue);
      scrollTimeRange.style.setProperty(
        '--fill',
        `${rangeFillPercent(rangeValue, scrollTimeRange.min, scrollTimeRange.max)}%`,
      );
    }
    if (scrollTimeOutput) {
      const mm = String(Math.floor(scrollDurationSeconds / 60)).padStart(2, '0');
      const ss = String(scrollDurationSeconds % 60).padStart(2, '0');
      scrollTimeOutput.textContent = `${mm}:${ss}`;
    }
    if (selectedScrollMode === 'time') {
      scroller.setDuration(scrollDurationSeconds, activeSurface());
      if (speedControl) {
        speedControl.setAttribute('aria-label', `Scroll mode: ${scrollDurationSeconds} seconds`);
      }
    }
    if (persist) {
      clearTimeout(scrollDurationSaveTimer);
      scrollDurationSaveTimer = setTimeout(() => {
        saveWorkspaceSettings(workspace.id,{ scrollDurationSeconds });
      }, 300);
    }
  }

  on(speedModeAuto, 'click', () => {
    setSpeedModePanel('auto');
    readingSession.refreshMode();
    saveWorkspaceSettings(workspace.id,{ scrollMode: 'auto' });
  });
  on(speedMethodWpm, 'click', () => {
    setSpeedModePanel('wpm');
    readingSession.refreshMode();
    saveWorkspaceSettings(workspace.id,{ scrollMode: 'wpm' });
  });
  on(speedMethodTime, 'click', () => {
    setSpeedModePanel('time');
    readingSession.refreshMode();
    saveWorkspaceSettings(workspace.id,{ scrollMode: 'time' });
  });
  on(scrollMinutes, 'input', () => applyScrollDuration());
  on(scrollSeconds, 'input', () => applyScrollDuration());
  on(scrollMinutes, 'change', () => applyScrollDuration());
  on(scrollSeconds, 'change', () => applyScrollDuration());
  on(scrollTimeRange, 'input', () => applyScrollDuration(scrollTimeRange.value));

  // Debounced so dragging the slider doesn't hammer localStorage.
  let wpmSaveTimer = null;
  function persistWpm() {
    clearTimeout(wpmSaveTimer);
    wpmSaveTimer = setTimeout(() => saveWorkspaceSettings(workspace.id,{ wpm }), 300);
  }
  function applySpeed(value, syncInput = true, persist = true) {
    wpm = clampWpm(value);
    if (speedRange) {
      // The slider maxes out at 400; higher values (from the custom input) pin
      // the thumb at the end. Read back the browser-clamped value so the fill
      // caps at 100% instead of overflowing, while the number displays stay full.
      speedRange.value = String(wpm);
      speedRange.style.setProperty('--fill', `${rangeFillPercent(speedRange.value, speedRange.min, speedRange.max)}%`);
    }
    if (syncInput && speedInput) speedInput.value = String(wpm);
    if (speedOutput) speedOutput.textContent = `${wpm} WPM`;
    if (speedValue && selectedScrollMode === 'wpm') speedValue.textContent = String(wpm);
    if (barSpeedValue) barSpeedValue.textContent = String(wpm);
    if (speedControl && selectedScrollMode === 'wpm') {
      speedControl.setAttribute('aria-label', `Scroll mode: ${wpm} words per minute`);
    }
    if (selectedScrollMode === 'wpm') scroller.setWpm(wpm);
    if (persist) persistWpm();
  }
  on(speedRange, 'input', () => applySpeed(speedRange.value));
  on(speedInput, 'input', () => {
    const v = Number(speedInput.value);
    if (v >= 1 && v <= 1000) applySpeed(v, false);
  });
  on(speedInput, 'change', () => applySpeed(speedInput.value || WPM_DEFAULT));
  // Restore this script's saved speed (no persist on the initial apply).
  applySpeed(savedSettings.wpm, true, false);
  applyScrollDuration(savedSettings.scrollDurationSeconds, false);
  setSpeedModePanel(savedSettings.scrollMode);

  // ---- Countdown ------------------------------------------------------------
  let countdownTimer = null;
  let countdownDelay = null;
  let countingDown = false;
  function showCountNumber(n) {
    if (!recordCountBox) return;
    const span = document.createElement('span');
    span.className = 'num';
    span.textContent = String(n);
    recordCountBox.replaceChildren(span);
    if (recordCountdown) recordCountdown.classList.add('show');
  }
  function cancelRecordCountdown() {
    countingDown = false;
    clearTimeout(countdownDelay);
    clearInterval(countdownTimer);
    if (recordCountdown) recordCountdown.classList.remove('show');
  }
  function startRecordCountdown() {
    countingDown = true;
    let count = 3;
    countdownDelay = setTimeout(() => {
      showCountNumber(count);
      countdownTimer = setInterval(() => {
        count -= 1;
        if (count <= 0) { cancelRecordCountdown(); beginRecording(); }
        else showCountNumber(count);
      }, 1000);
    }, 450);
  }

  // ---- Recording controller (logic layer) -----------------------------------
  const controller = createRecordingController({
    onError: (err) => {
      // Saving is no longer possible (e.g. disk full mid-write): end the doomed
      // session right away instead of silently discarding more footage later.
      if (controller.isRecording() || controller.isPaused()) {
        readingSession.stop();
        resetRecordUI();
        controller.stop({ workspaceId: workspace.id }).catch(() => {});
      }
      if (!toastEl) return;
      clearTimeout(toastTimer);
      // Append the DOMException name so device-specific failures (iOS Safari
      // storage errors) are identifiable from the toast alone.
      const errName = err && err.name ? ` (${err.name})` : '';
      toastEl.textContent =
        (copy.recordSaveError || 'Recording could not be saved') + errName;
      toastEl.classList.add('show');
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 5000);
    },
  });
  let recordTimer = null;

  // ---- Storage monitor (warn + auto-stop tiers during recording) -------------
  const storageMonitor = createStorageMonitor({
    // Tier 1 (200 MB): subtle transient toast — informational only.
    onWarn: (free) => {
      if (!settings.wantsStorageWarning()) return;
      if (!toastEl) return;
      clearTimeout(toastTimer);
      toastEl.textContent = `⚠️ ${formatBytes(free)} left — stop recording soon`;
      toastEl.classList.add('show', 'toast--warn-subtle');
      toastTimer = setTimeout(() => { toastEl.classList.remove('show', 'toast--warn-subtle'); }, 5000);
    },
    // Tier 2 (50 MB): auto-stop recording, save, teleprompter keeps running.
    // Not gated by the storage-warning preference: running the disk dry loses
    // the whole recording, so this is a data-safety stop, not a nag.
    onAutoStop: (free) => {
      if (!controller.isRecording() && !controller.isPaused()) return;
      // Stop recording UI (button + timer) but DO NOT stop the scroller.
      resetRecordUI({ keepReading: true });
      readingSession.continueAsPlay();
      storageMonitor.stop();
      // Save in background — fire and forget from the user's perspective.
      controller.stop({ workspaceId: workspace.id }).then((record) => {
        if (record && !record.skipped) {
          // Show a brief success toast at the bottom.
          if (toastEl) {
            clearTimeout(toastTimer);
            toastEl.textContent = `Recording saved — only ${formatBytes(free)} left`;
            toastEl.classList.remove('toast--warn-subtle');
            toastEl.classList.add('show');
            toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4000);
          }
        }
      }).catch(() => {});
    },
  });

  // ---- Storage warning modal (pre-flight) -----------------------------------
  const storageWarnModal = $('storageWarnModal');
  const storageWarnBackdrop = $('storageWarnBackdrop');
  const storageWarnDesc = $('storageWarnDesc');
  const storageWarnCancel = $('storageWarnCancel');
  const storageWarnContinue = $('storageWarnContinue');

  /**
   * Show the storage warning modal and wait for user choice.
   * @param {string} message - description text
   * @returns {Promise<'cancel'|'continue'>}
   */
  function showStorageWarnModal(message, { blocked = false } = {}) {
    return new Promise((resolve) => {
      if (!storageWarnModal || !storageWarnBackdrop) {
        resolve(blocked ? 'cancel' : 'continue'); // fallback: no modal in DOM
        return;
      }
      if (storageWarnDesc) storageWarnDesc.textContent = message;
      // Disable Continue when storage is fully blocked.
      if (storageWarnContinue) {
        storageWarnContinue.disabled = blocked;
        storageWarnContinue.style.opacity = blocked ? '0.4' : '';
        storageWarnContinue.style.cursor = blocked ? 'not-allowed' : '';
      }
      storageWarnBackdrop.classList.add('show');
      storageWarnModal.hidden = false;
      storageWarnModal.focus?.();

      function close(choice) {
        storageWarnBackdrop.classList.remove('show');
        storageWarnModal.hidden = true;
        if (storageWarnContinue) { storageWarnContinue.disabled = false; storageWarnContinue.style.opacity = ''; storageWarnContinue.style.cursor = ''; }
        storageWarnCancel.removeEventListener('click', onCancel);
        storageWarnContinue.removeEventListener('click', onContinue);
        storageWarnBackdrop.removeEventListener('click', onCancel);
        resolve(choice);
      }
      const onCancel = () => close('cancel');
      const onContinue = () => close('continue');
      storageWarnCancel.addEventListener('click', onCancel);
      storageWarnContinue.addEventListener('click', onContinue);
      storageWarnBackdrop.addEventListener('click', onCancel);
    });
  }

  // Reset the visual recording state (button, timer, pause button).
  // Does NOT stop the teleprompter scroller — safe to call from auto-stop.
  function resetRecordUI({ keepReading = false } = {}) {
    storageMonitor.stop();
    playbackOnlyActive = keepReading;
    if (toastEl) toastEl.classList.remove('toast--warn-subtle');
    recordButton.classList.remove('recording', 'paused');
    clearInterval(recordTimer);
    if (pauseButton) pauseButton.classList.remove('show', 'paused');
    if (pauseLabel) pauseLabel.textContent = copy.pause || 'Pause';
    if (recordLabel) recordLabel.textContent = copy.record || 'Record';
    app.classList.remove('record-paused');
    app.classList.toggle('playback-only', keepReading);
    app.classList.toggle('record-dim', keepReading);
    setReadingScrollCapture(keepReading);
    if (headerPlayButton) headerPlayButton.classList.remove('hidden');
    setEditingEnabled(!keepReading);
    if (!keepReading) {
      [promptBox, teleprompterText, notch.getScroll()].forEach((surface) => {
        if (surface) surface.style.removeProperty('--tp-scroll-tail');
      });
      if (promptBox) promptBox.style.paddingTop = '';
      if (teleprompterText) teleprompterText.style.paddingTop = '';
    }
  }

  function setEditingEnabled(enabled) {
    if (promptBox) promptBox.contentEditable = enabled ? 'true' : 'false';
    if (teleprompterText) teleprompterText.contentEditable = enabled ? 'true' : 'false';
  }
  function startRecordTimer() {
    recordTimer = setInterval(() => {
      if (recordLabel) recordLabel.textContent = formatDuration(controller.getElapsed());
    }, TIMESLICE_LABEL_MS);
  }

  // Surface why a recording couldn't start instead of failing silently.
  async function handleRecordCaptureError(err) {
    const reason = classifyMediaError(err);
    if (reason === 'denied') {
      // Guide only on a real block; a merely dismissed prompt stays quiet.
      await guideIfBlocked([
        { perm: 'camera', label: 'camera' },
        { perm: 'microphone', label: 'mic' },
      ]);
      return;
    }
    if (reason === 'not-found') showToast(copy.cameraNoDevice || '');
    else if (reason === 'in-use') showToast(copy.cameraInUse || '');
    else if (reason === 'overconstrained') showToast(copy.cameraOverconstrained || '');
    // 'unknown' (e.g. a lagging previous stop()) keeps the prior silent restore.
  }

  // Acquire whatever the recording needs (audio, and video when the cam is on)
  // up-front, so the browser prompts before the countdown. Returns false when
  // access is blocked/declined so the caller can abort cleanly.
  async function ensureRecordingPermissions() {
    // Mirror logic.js: audio is forced on only when the camera is off.
    const wantsAudio = cameraEnabled() ? micEnabled() : true;
    if (!wantsAudio) return true; // video-only, camera already granted + preview
    if ((await queryPermissionState('microphone')) === 'granted') return true;

    const allowed = await ensureCaptureAllowed({ audio: true, prime: true });
    if (!allowed) return false;
    try {
      const probe = await getCaptureStream({ audio: true, video: false });
      stopStream(probe);
      return true;
    } catch (err) {
      handleRecordCaptureError(err);
      return false;
    }
  }

  async function beginRecording() {
    let started = null;
    let startErr = null;
    try {
      // Inside the try: if the deferred panels chunk failed to load,
      // panelsReady rejects here and we fall through to the !started recovery
      // (buttons restored) rather than leaking an unhandled rejection —
      // beginRecording is called un-awaited from the countdown/interval.
      const { popups } = await panelsReady;
      // Permission was already acquired in onRecordClick (before the countdown),
      // so this getUserMedia call won't pop a prompt mid 3-2-1.
      started = await controller.start({
        wantsVideo: cameraEnabled(),
        wantsAudio: micEnabled(),
        videoDeviceId: popups.getSelectedDeviceId('camera'),
        audioDeviceId: popups.getSelectedDeviceId('mic'),
      });
    } catch (err) { startErr = err; }
    // start() returns null (without throwing) when capture cannot begin —
    // e.g. the previous stop() is still persisting its recording.
    if (!started) {
      if (startErr) handleRecordCaptureError(startErr);
      readingSession.stop();
      app.classList.remove('record-dim');
      setReadingScrollCapture(false);
      layout.restore(activeSurface());
      if (headerPlayButton) headerPlayButton.classList.remove('hidden');
      return;
    }
    app.classList.remove('record-paused');
    recordButton.classList.add('recording');
    setEditingEnabled(false);
    if (recordLabel) recordLabel.textContent = '00:00';
    if (pauseButton) pauseButton.classList.remove('show', 'paused');
    if (pauseLabel) pauseLabel.textContent = copy.pause || 'Pause';
    startRecordTimer();
    // Start monitoring storage — will fire warn/critical callbacks as needed.
    storageMonitor.start();
    readingSession.release('capture');
  }

  async function onRecordClick() {
    if (countingDown) {
      cancelRecordCountdown();
      readingSession.stop();
      layout.restore(activeSurface());
      app.classList.remove('record-dim', 'record-paused');
      setReadingScrollCapture(false);
      if (headerPlayButton) headerPlayButton.classList.remove('hidden');
      return;
    }
    if (!controller.isRecording() && !controller.isPaused()) {
      // Switching from Play to Record starts a fresh recording session while
      // preserving the same reading layout.
      stopPlaybackOnly();
      // ── Pre-flight storage check. The warn tier respects the user's
      // storage-warning preference; the blocked tier always stops — with that
      // little space left the recording is doomed regardless of preference.
      const storageCheck = await checkBeforeRecord();
      if (!storageCheck.ok && (storageCheck.blocked || settings.wantsStorageWarning())) {
        // Both blocked (< 30MB) and warn (< 200MB) show the modal.
        // When blocked, Continue is visually disabled inside the modal.
        const choice = await showStorageWarnModal(storageCheck.message, { blocked: !!storageCheck.blocked });
        if (choice === 'cancel' || storageCheck.blocked) {
          // Restore UI state that was set before this check.
          app.classList.remove('record-dim');
          return;
        }
        // choice === 'continue' && !blocked → proceed with recording.
      }
      // Acquire the mic permission BEFORE the countdown so the browser prompts
      // now, not after 3-2-1. The camera (when on) is already granted + preview.
      const permitted = await ensureRecordingPermissions();
      if (!permitted) {
        app.classList.remove('record-dim');
        return;
      }
      // Request persistent storage so recordings survive browser eviction.
      requestPersistentStorage().catch(() => {});
      // ── Begin countdown / recording ───────────────────────────────────────
      if (headerPlayButton) headerPlayButton.classList.add('hidden');
      // Slide the first line down onto the eye-line (runs through the countdown).
      readingSession.begin('record', { waitFor: ['layout', 'capture'] });
      enterReadingUI(() => readingSession.release('layout'));
      if (settings.wantsCountdown()) startRecordCountdown();
      else beginRecording();
    } else {
      // Manual stop → reset UI → stop scroller → jump straight to the scene
      // editor; the save keeps running in the background and the editor shows
      // a saving placeholder until it settles.
      readingSession.stop();
      resetRecordUI();
      const pendingSave = controller.stop({ workspaceId: workspace.id });
      await openSceneEditor({ pendingSave });
    }
  }
  on(recordButton, 'click', onRecordClick);

  function toggleRecordingPause() {
    if (controller.isRecording()) {
      controller.pause();
      app.classList.add('record-paused');
      if (pauseButton) pauseButton.classList.add('paused');
      if (recordButton) recordButton.classList.add('paused');
      if (pauseLabel) pauseLabel.textContent = copy.resume || 'Play';
      clearInterval(recordTimer);
      // A paused recording is still an active recording session; keep the
      // script locked until the user stops recording completely.
      setEditingEnabled(false);
      readingSession.pause();
    } else if (controller.isPaused()) {
      controller.resume();
      app.classList.remove('record-paused');
      if (pauseButton) pauseButton.classList.remove('paused');
      if (recordButton) recordButton.classList.remove('paused');
      if (pauseLabel) pauseLabel.textContent = copy.pause || 'Pause';
      setEditingEnabled(false);
      startRecordTimer();
      // Continue from the exact position where Pause stopped the scroller.
      readingSession.resume();
    }
  }
  on(pauseButton, 'click', toggleRecordingPause);

  const isReadingActive = () => app.classList.contains('record-dim');
  const isRecordingActive = () => countingDown || controller.isRecording() || controller.isPaused();

  // ---- Keyboard shortcuts ---------------------------------------------------
  const isEditingTarget = (el) => {
    if (!el) return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    return !!el.isContentEditable;
  };
  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditingTarget(e.target)) return;
    switch (e.key) {
      case ' ':
      case 'Spacebar':
        if (e.repeat) break;
        if (controller.isRecording() || controller.isPaused()) {
          e.preventDefault();
          toggleRecordingPause();
        } else if (playbackOnlyActive) {
          e.preventDefault();
          togglePlayback();
        }
        break;
      case 'ArrowRight': e.preventDefault(); applySpeed(wpm + (e.shiftKey ? BAR_SPEED_STEP * 2 : BAR_SPEED_STEP)); break;
      case 'ArrowLeft': e.preventDefault(); applySpeed(wpm - (e.shiftKey ? BAR_SPEED_STEP * 2 : BAR_SPEED_STEP)); break;
      case 'ArrowUp': e.preventDefault(); scroller.manualScroll(-SCROLL_STEP); break;
      case 'ArrowDown': e.preventDefault(); scroller.manualScroll(SCROLL_STEP); break;
      case 'Enter': e.preventDefault(); scroller.scrollToNextSection(); break;
      default: break;
    }
  };
  document.addEventListener('keydown', onKeyDown);
  cleanups.push(() => document.removeEventListener('keydown', onKeyDown));

  // With the visible Pause/Play buttons hidden during recording, clicking the
  // reading surface (camera on or off) toggles the same paused/playing state
  // for fixed-speed modes. In Auto, surface clicks belong exclusively to word
  // re-anchoring; pausing here would cancel the new voice-scroll animation.
  const isInteractiveTarget = (el) => !!(el.closest && el.closest('button, a, input, select, textarea, [role="button"], .app-header, .control-bar, .toolbar-shell'));
  on(stageEl, 'click', (e) => {
    if (!isRecordingActive()) return;
    if (selectedScrollMode === 'auto') return;
    if (isInteractiveTarget(e.target)) return;
    toggleRecordingPause();
  });
  // Non-passive wheel/touch handlers make the browser wait on the main thread
  // for every scroll over the stage — attach them only while a reading session
  // (record/play dim) is active; normal editor scrolling stays native.
  let readingScrollCaptureOn = false;
  let swipeLastY = null;
  const onStageWheel = (e) => { if (!isReadingActive()) return; e.preventDefault(); scroller.manualScroll(e.deltaY); };
  const onStageTouchStart = (e) => { swipeLastY = isReadingActive() ? e.touches[0].clientY : null; };
  const onStageTouchMove = (e) => {
    if (swipeLastY == null) return;
    const y = e.touches[0].clientY;
    scroller.manualScroll(swipeLastY - y);
    swipeLastY = y;
    e.preventDefault();
  };
  const onStageTouchEnd = () => { swipeLastY = null; };
  function setReadingScrollCapture(active) {
    if (!stageEl || active === readingScrollCaptureOn) return;
    readingScrollCaptureOn = active;
    if (active) {
      stageEl.addEventListener('wheel', onStageWheel, { passive: false });
      stageEl.addEventListener('touchstart', onStageTouchStart, { passive: true });
      stageEl.addEventListener('touchmove', onStageTouchMove, { passive: false });
      stageEl.addEventListener('touchend', onStageTouchEnd);
    } else {
      swipeLastY = null;
      stageEl.removeEventListener('wheel', onStageWheel);
      stageEl.removeEventListener('touchstart', onStageTouchStart);
      stageEl.removeEventListener('touchmove', onStageTouchMove);
      stageEl.removeEventListener('touchend', onStageTouchEnd);
    }
  }
  cleanups.push(() => setReadingScrollCapture(false));

  // ---- Fullscreen sync on the notch/settings toggles ------------------------
  cleanups.push(onFullscreenChange(() => {
    const active = isFullscreen();
    void active; // toggle state is reflected inside settings-theme + notch
  }));

  // ---- Live sync: editing a surface updates notch + persists ----------------
  const clearIfEmpty = (el) => { if (el && !el.textContent.trim() && el.innerHTML !== '') el.innerHTML = ''; };
  on(promptBox, 'input', () => { clearIfEmpty(promptBox); commitSharedEdit(promptBox); });
  on(teleprompterText, 'input', () => { clearIfEmpty(teleprompterText); commitSharedEdit(teleprompterText); });
  // Paste as plain text only — strip any HTML/markup from the clipboard so the
  // prompt surfaces never absorb foreign formatting (see utils/plain-paste.js).
  on(promptBox, 'paste', handlePlainTextPaste);
  on(teleprompterText, 'paste', handlePlainTextPaste);
  // Persistence trails typing (debounced) — commit it before the page/tab can
  // be discarded. pagehide is covered by teardown.
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistSharedState.flush();
  });

  async function performSharedHistory(redo) {
    const state = await (redo ? editHistory.redo() : editHistory.undo());
    if (!state) return;
    saveWorkspaceSettings(workspace.id,{
      align: state.align,
      fontSize: state.fontSize,
      lineHeight: state.lineHeight,
      color: state.color,
      bold: state.bold,
      italic: state.italic,
      underline: state.underline,
    });
  }

  function isSharedHistoryTarget(target) {
    const inSharedEditor = [promptBox, teleprompterText, $('notchEditText')]
      .some((surface) => surface && (target === surface || surface.contains(target)));
    const inSharedToolbar = Boolean(target.closest && target.closest('.format-toolbar, .notch-edit-body'));
    const inNotchMode = app.classList.contains('notch-on') && (
      target === document.body || Boolean(target.closest && target.closest('#notchPrompter'))
    );
    return inSharedEditor || inSharedToolbar || inNotchMode;
  }

  const onSharedUndoKeyDown = (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    if (!isSharedHistoryTarget(event.target)) return;

    event.preventDefault();
    const redo = key === 'y' || (key === 'z' && event.shiftKey);
    void performSharedHistory(redo);
  };
  document.addEventListener('keydown', onSharedUndoKeyDown, true);
  cleanups.push(() => document.removeEventListener('keydown', onSharedUndoKeyDown, true));

  const onSharedHistoryInput = (event) => {
    if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
    if (!isSharedHistoryTarget(event.target)) return;
    event.preventDefault();
    void performSharedHistory(event.inputType === 'historyRedo');
  };
  document.addEventListener('beforeinput', onSharedHistoryInput, true);
  cleanups.push(() => document.removeEventListener('beforeinput', onSharedHistoryInput, true));

  // ---- Back button ----------------------------------------------------------
  root.querySelectorAll('.back-btn').forEach((btn) => {
    on(btn, 'click', (e) => {
      e.preventDefault();
      if (onExit) onExit();
      else window.location.href = '/workspaces';
    });
  });

  root.querySelectorAll('.logo-btn').forEach((btn) => {
    on(btn, 'click', (e) => {
      e.preventDefault();
      if (onExit) onExit();
      else window.location.href = '/workspaces';
    });
  });

  // ---- Components -----------------------------------------------------------
  // Device/ratio popups and panel drag aren't needed for first paint, so they
  // ship in a separate chunk that starts downloading now (right after mount)
  // and wires up when it lands. `panels` stays null until then; early user
  // actions await `panelsReady` (camera, record, Ratio, mic). Everything below
  // this line — settings, notch, layout, format toolbar — stays in the main
  // chunk because it paints or restores state on first frame.
  const panelsModule = import('./components/studio-panels.ui.js');
  let panels = null;

  const popupsArgs = {
    root,
    getMicEnabled: micEnabled,
    onDeviceChange: (type) => {
      if (type !== 'camera' || !cameraEnabled()) return;
      stopCamera();
      if (cameraPlaceholder) cameraPlaceholder.classList.add('show');
      void startCamera();
    },
  };
  const settings = initSettingsTheme({
    root,
    app,
    prompterPanel,
    initial: {
      pageTheme: savedSettings.pageTheme,
      panelTheme: savedSettings.panelTheme,
      countdown: savedSettings.countdown,
      notchFullscreen: savedSettings.notchFullscreen,
    },
    onChange: (patch) => saveWorkspaceSettings(workspace.id,patch),
    initialStorageWarning: isStorageWarningEnabled(),
    onStorageWarningChange: setStorageWarningEnabled,
  });
  notch = initNotch({
    root,
    app,
    getEditSurface: activeEditSurface,
    onEditChange: ({ html, align }) => {
      const editor = $('notchEditText');
      if (!editor) return;
      if (editor.innerHTML !== html) editor.innerHTML = html;
      const alignChanged = align !== sharedAlign;
      commitSharedEdit(editor, alignChanged ? { align } : {});
      if (alignChanged) saveWorkspaceSettings(workspace.id,{ align });
    },
    shouldEnterFullscreen: settings.wantsNotchFullscreen,
    onActiveChange: (active, surface) => {
      if (!active) {
        // The main surfaces come back into view — apply edits typed in notch.
        syncDirtySurfaces();
        if (didAutoChangeColor) {
          if (editHistory.current().color === '#ffffff') {
            if (formatToolbar) {
              formatToolbar.setGlobalColor(colorBeforeNotch || '');
            }
          }
          didAutoChangeColor = false;
          colorBeforeNotch = null;
        }
        readingSession.switchSurface(activeSurface(), {
          preserveProgress: readingSession.isActive(),
        });
        return;
      }
      // Idle notch remains a top-seated preview. During Play/Record the central
      // session maps progress and resumes the same engine on the notch surface.
      readingSession.switchSurface(surface, {
        preserveProgress: readingSession.isActive(),
      });
      const currentState = editHistory.current();
      const currentColor = currentState.color || '';
      if (currentColor !== '#ffffff') {
        colorBeforeNotch = currentColor;
        didAutoChangeColor = true;
        if (formatToolbar) {
          formatToolbar.setGlobalColor('#ffffff');
        }
      }
    },
    copy,
  });
  const layout = initLayoutGuides({
    root, app, promptBox, teleprompterText, prompterPanel,
    initial: {
      promptMarginRatio: savedSettings.promptMarginRatio,
      panelMarginRatio: savedSettings.panelMarginRatio,
      eyeLineRatio: savedSettings.eyeLineRatio,
      eyeLineVisible: savedSettings.eyeLineVisible,
    },
    onChange: (patch) => {
      saveWorkspaceSettings(workspace.id,patch);
      if (patch.eyeLineRatio !== undefined && (isReadingActive() || notch.isActive())) {
        const surface = activeSurface();
        if (surface) {
          prepareScrollSurface(surface, false);
        }
      }
    },
  });
  // Pointermove can fire 120+ times/s — queue at most one layout.update per
  // frame instead of stacking a fresh rAF callback per event.
  let layoutUpdateQueued = false;
  function queueLayoutUpdate() {
    if (layoutUpdateQueued) return;
    layoutUpdateQueued = true;
    requestAnimationFrame(() => {
      layoutUpdateQueued = false;
      layout.update();
    });
  }
  const panelDragArgs = {
    stage: stageEl,
    panel: prompterPanel,
    handle: panelDragHandle,
    resizeHandle: panelResizeHandle,
    onMove: queueLayoutUpdate,
  };
  // Chunk started downloading at the top of this section; now that every arg
  // it needs exists, wire it up when it lands. `panelsDestroyed` lets teardown
  // win the race if it runs before the chunk resolves.
  let panelsDestroyed = false;
  panelsModule.then((m) => {
    panels = m.initStudioPanels({ popups: popupsArgs, panelDrag: panelDragArgs });
    if (panelsDestroyed) panels.destroy();
    resolvePanelsReady(panels);
  }).catch((err) => {
    rejectPanelsReady(err);
  });
  formatToolbar = initFormatToolbar({
    root,
    promptBox,
    teleprompterText,
    notchEditText: $('notchEditText'),
    colorPicker,
    initialAlign: savedSettings.align,
    initialFontSize: savedSettings.fontSize,
    initialLineHeight: savedSettings.lineHeight,
    initialColor: savedSettings.color,
    initialBold: savedSettings.bold,
    initialItalic: savedSettings.italic,
    initialUnderline: savedSettings.underline,
    onAlignChange: commitSharedAlignment,
    onSettingsChange: (patch) => saveWorkspaceSettings(workspace.id,patch),
    onFormatChange: commitSharedEdit,
  });
  applySharedState(editHistory.current(), { persist: false, syncToolbars: true });

  // Mobile format-toolbar height → CSS var so the stage clears it. The same
  // toolbar scrolls horizontally on phones; toggle .mff-has-more so the ">>"
  // affordance shows while there is more content off the right edge.
  const mobileFormatToolbar = $('mobileFormatToolbar');
  const mffMore = $('mffMore');
  const mffMoreLeft = $('mffMoreLeft');
  function updateMffMore() {
    if (!mobileFormatToolbar) return;
    const el = mobileFormatToolbar;
    const overflow = el.scrollWidth - el.clientWidth > 1;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    app.classList.toggle('mff-has-more', overflow && !atEnd);
    app.classList.toggle('mff-has-prev', overflow && !atStart);
  }
  let mobileToolbarObserver = null;
  if (mobileFormatToolbar && window.ResizeObserver) {
    mobileToolbarObserver = new ResizeObserver((entries) => {
      const height = entries[0].contentRect.height;
      if (height > 0) app.style.setProperty('--mobile-toolbar-h', `${height}px`);
      updateMffMore();
    });
    mobileToolbarObserver.observe(mobileFormatToolbar);
  }
  on(mobileFormatToolbar, 'scroll', updateMffMore, { passive: true });
  const scrollMff = (dir) => {
    if (mobileFormatToolbar) {
      mobileFormatToolbar.scrollBy({ left: dir * mobileFormatToolbar.clientWidth * 0.7, behavior: 'smooth' });
    }
  };
  on(mffMore, 'click', () => scrollMff(1));
  on(mffMoreLeft, 'click', () => scrollMff(-1));
  updateMffMore();

  const onResize = () => { updateCameraCanvasSize(); queueLayoutUpdate(); };
  window.addEventListener('resize', onResize);
  cleanups.push(() => window.removeEventListener('resize', onResize));

  // ---- Panel close button ---------------------------------------------------
  on($('closePanel'), 'click', () => setPrompterHidden(true));

  // ---- Scene editor (post-record edit, mounted in-place, no navigation) -----
  const sceneEditorRoot = $('sceneEditorView');
  let sceneEditorTeardown = null;
  function closeSceneEditor() {
    if (sceneEditorTeardown) { sceneEditorTeardown(); sceneEditorTeardown = null; }
    if (sceneEditorRoot) sceneEditorRoot.hidden = true;
    if (app) app.hidden = false;
  }
  async function openSceneEditor({ pendingSave } = {}) {
    if (!sceneEditorRoot) return;
    // The scene editor reads workspace state from the store — commit any
    // trailing debounced edit before handing over.
    persistSharedState.flush();
    // The editor is mounted beside (not inside) the teleprompter app, so the
    // fixed notch overlay must be explicitly turned off before swapping views.
    notch.deactivate();
    const { mountSceneEditor } = await import('../scene-editor/scene-editor.ui.js');
    sceneEditorTeardown = await mountSceneEditor(sceneEditorRoot, {
      workspaceId: workspace.id,
      copy: copy.sceneEditor || {},
      pendingSave,
      onBack: closeSceneEditor,
      onRecordScene: closeSceneEditor,
    });
    if (app) app.hidden = true;
    sceneEditorRoot.hidden = false;
  }

  // ---- Cross-tab stale-version badge (edit view only) -----------------------
  // Surfaces a discreet "updated in another tab" badge when the same script is
  // edited in a second tab. Reflects state only (never replays actions). The
  // isSyncPaused gate keeps it silent during Play/Record, and its Reload does a
  // full reload so it never fights the caret mid-typing.
  editStaleBadge = initEditStaleBadge({
    mount: document.body, // top-level: #app/.stage trap position:fixed children
    modeEl: app,
    readWorkspace: () => loadWorkspace(workspace.id),
    isSyncPaused: () => isReadingActive() || isRecordingActive(),
    copy,
  });
  cleanups.push(() => editStaleBadge.destroy());

  // ---- Teardown -------------------------------------------------------------
  let tornDown = false;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    window.removeEventListener('pagehide', teardown);
    persistSharedState.flush();
    readingSession.stop();
    scroller.destroy();
    if (voiceScrollUI) { voiceScrollUI.destroy(); voiceScrollUI = null; }
    controller.cancel();
    cancelRecordCountdown();
    clearInterval(recordTimer);
    stopCamera();
    clearTimeout(toastTimer);
    clearTimeout(wpmSaveTimer);
    clearTimeout(scrollDurationSaveTimer);
    storageMonitor.stop();
    if (mobileToolbarObserver) mobileToolbarObserver.disconnect();
    // Deferred chunk: destroy now if it's already up, else flag it so the
    // panelsReady handler tears it down the moment it resolves.
    panelsDestroyed = true;
    if (panels) panels.destroy();
    settings.destroy();
    notch.destroy();
    layout.destroy();
    formatToolbar.destroy();
    colorPicker.destroy();
    cleanups.forEach((fn) => fn());
  };
  window.addEventListener('pagehide', teardown);
  return teardown;
}
