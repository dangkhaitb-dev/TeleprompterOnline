const NORMAL_MODE = 'normal';
const RECORD_MODE = 'record';

export function applyCameraStartupState({
  cameraFeed,
  cameraStatus,
  loading = false,
  ready = false,
} = {}) {
  if (cameraStatus) cameraStatus.hidden = !loading;
  cameraFeed?.classList.toggle('hidden', !ready);
}

export function applyPendingCameraPreviewState({ app, cameraFeed, cameraStatus } = {}) {
  applyCameraPreviewState({ app, cameraFeed, enabled: true });
  applyCameraStartupState({ cameraFeed, cameraStatus, loading: true });
}

export function applyCameraPreviewState({
  app,
  cameraFeed,
  enabled,
  preserveStudioLayout = false,
} = {}) {
  if (enabled) {
    app?.classList.add('cam-on');
    cameraFeed?.classList.remove('hidden');
    return;
  }
  if (preserveStudioLayout) {
    cameraFeed?.classList.add('hidden');
    return;
  }
  app?.classList.remove('cam-on');
  cameraFeed?.classList.remove('hidden');
}

export function createStudioModeController({
  app,
  toggleButton,
  playButton,
  recordButton,
  onModeChange = () => {},
} = {}) {
  let mode = NORMAL_MODE;
  const label = toggleButton?.querySelector('.label');

  function render() {
    const isRecordMode = mode === RECORD_MODE;
    if (app) app.dataset.studioMode = mode;
    if (playButton) playButton.hidden = isRecordMode;
    if (recordButton) recordButton.hidden = !isRecordMode;
    if (toggleButton) {
      toggleButton.dataset.mode = mode;
      toggleButton.setAttribute('aria-pressed', String(isRecordMode));
      const titleText = isRecordMode
        ? toggleButton.dataset.switchToNormal || 'Switch to Normal mode'
        : toggleButton.dataset.switchToRecord || 'Switch to Record mode';
      toggleButton.setAttribute('aria-label', titleText);
      toggleButton.setAttribute('title', titleText);
      toggleButton.classList.toggle('selected', isRecordMode);
    }
    if (label) {
      label.textContent = isRecordMode
        ? toggleButton.dataset.recordLabel || 'Record'
        : toggleButton.dataset.normalLabel || 'Normal';
    }
  }

  function setMode(nextMode, { notify = true } = {}) {
    const normalized = nextMode === RECORD_MODE ? RECORD_MODE : NORMAL_MODE;
    if (normalized === mode) return mode;
    mode = normalized;
    render();
    if (notify) onModeChange(mode);
    return mode;
  }

  function handleToggle() {
    setMode(mode === NORMAL_MODE ? RECORD_MODE : NORMAL_MODE);
  }

  toggleButton?.addEventListener('click', handleToggle);
  render();

  return {
    getMode: () => mode,
    setMode,
    destroy() {
      toggleButton?.removeEventListener('click', handleToggle);
    },
  };
}

export function createStudioMediaSettingsHandler({
  studioMode,
  requestRecordingMediaReady,
  setCameraEnabled,
  setMicEnabled,
} = {}) {
  return function setMediaFromSettings(type, enabled) {
    if (enabled && studioMode?.getMode() !== RECORD_MODE) {
      studioMode?.setMode(RECORD_MODE);
      return requestRecordingMediaReady();
    }
    return type === 'camera'
      ? setCameraEnabled(enabled)
      : setMicEnabled(enabled);
  };
}

// Phone studio bar: no tab strip. The shared Camera button (moved in from the
// desktop toolbar) flips studio mode; the Play / Record panels follow that mode.
export function createMobileStudioBar({ root = document } = {}) {
  const panels = [...root.querySelectorAll('.m-mode-panel')];
  return {
    syncFromMode(mode) {
      const target = mode === RECORD_MODE ? 'main' : 'tools';
      panels.forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === target);
      });
    },
  };
}
