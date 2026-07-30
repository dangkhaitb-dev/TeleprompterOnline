const NORMAL_MODE = 'normal';
const RECORD_MODE = 'record';

export function applyCameraLoadingState({
  cameraFeed,
  cameraLoading,
  loading = false,
  ready = false,
} = {}) {
  if (cameraLoading) cameraLoading.hidden = !loading;
  cameraFeed?.classList.toggle('hidden', loading || !ready);
}

export function applyPendingCameraPreviewState({ app, cameraFeed, cameraLoading } = {}) {
  applyCameraPreviewState({ app, cameraFeed, enabled: true });
  applyCameraLoadingState({ cameraFeed, cameraLoading, loading: true });
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
      toggleButton.setAttribute(
        'aria-label',
        isRecordMode
          ? toggleButton.dataset.switchToNormal || 'Switch to Normal mode'
          : toggleButton.dataset.switchToRecord || 'Switch to Record mode',
      );
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

export function createMobileStudioTabs({ root = document, studioMode } = {}) {
  const tabs = [...root.querySelectorAll('.m-tab')];
  const panels = [...root.querySelectorAll('.m-tab-panel')];

  function select(target, { syncMode = true } = {}) {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === target;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === target);
    });
    if (syncMode) studioMode?.setMode(target === 'main' ? RECORD_MODE : NORMAL_MODE);
  }

  const listeners = tabs.map((tab, index) => {
    const handleClick = () => select(tab.dataset.tab);
    const handleKeyDown = (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      event.stopPropagation();
      tabs[nextIndex].focus();
      select(tabs[nextIndex].dataset.tab);
    };
    tab.addEventListener('click', handleClick);
    tab.addEventListener('keydown', handleKeyDown);
    return () => {
      tab.removeEventListener('click', handleClick);
      tab.removeEventListener('keydown', handleKeyDown);
    };
  });

  return {
    syncFromMode(mode) {
      select(mode === RECORD_MODE ? 'main' : 'tools', { syncMode: false });
    },
    destroy() {
      listeners.forEach((remove) => remove());
    },
  };
}
