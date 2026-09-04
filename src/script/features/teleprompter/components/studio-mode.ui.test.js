// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  applyCameraStartupState,
  applyPendingCameraPreviewState,
  applyCameraPreviewState,
  createMobileStudioBar,
  createStudioMediaSettingsHandler,
  createStudioModeController,
} from './studio-mode.ui.js';

function setup() {
  document.body.innerHTML = `
    <main id="app">
      <button id="play">Play</button>
      <button id="record">Record</button>
      <button
        id="mode"
        data-normal-label="Normal"
        data-record-label="Record"
        data-switch-to-normal="Switch to Normal mode"
        data-switch-to-record="Switch to Record mode"
      ><span class="label"></span></button>
    </main>
  `;
  return {
    app: document.querySelector('#app'),
    playButton: document.querySelector('#play'),
    recordButton: document.querySelector('#record'),
    toggleButton: document.querySelector('#mode'),
  };
}

describe('studio mode controller', () => {
  it('shows an animated-text camera status until the feed is ready', () => {
    document.body.innerHTML = `
      <main id="app"></main>
      <video id="camera"></video>
      <p id="camera-status" hidden>Starting camera</p>
    `;
    const app = document.querySelector('#app');
    const cameraFeed = document.querySelector('#camera');
    const cameraStatus = document.querySelector('#camera-status');

    applyPendingCameraPreviewState({ app, cameraFeed, cameraStatus });
    expect(app.classList.contains('cam-on')).toBe(true);
    expect(cameraStatus.hidden).toBe(false);
    expect(cameraFeed.classList.contains('hidden')).toBe(true);

    applyCameraStartupState({ cameraFeed, cameraStatus, ready: true });
    expect(cameraStatus.hidden).toBe(true);
    expect(cameraFeed.classList.contains('hidden')).toBe(false);

    applyCameraStartupState({ cameraFeed, cameraStatus });
    expect(cameraStatus.hidden).toBe(true);
    expect(cameraFeed.classList.contains('hidden')).toBe(true);
  });

  it('hides only the camera feed in Record mode and restores Normal layout on exit', () => {
    document.body.innerHTML = '<main id="app"><video id="camera"></video></main>';
    const app = document.querySelector('#app');
    const cameraFeed = document.querySelector('#camera');

    applyCameraPreviewState({ app, cameraFeed, enabled: true });
    expect(app.classList.contains('cam-on')).toBe(true);
    expect(cameraFeed.classList.contains('hidden')).toBe(false);

    applyCameraPreviewState({
      app,
      cameraFeed,
      enabled: false,
      preserveStudioLayout: true,
    });
    expect(app.classList.contains('cam-on')).toBe(true);
    expect(cameraFeed.classList.contains('hidden')).toBe(true);

    applyCameraPreviewState({ app, cameraFeed, enabled: false });
    expect(app.classList.contains('cam-on')).toBe(false);
    expect(cameraFeed.classList.contains('hidden')).toBe(false);
  });

  it('starts in Normal with Play visible and Record hidden', () => {
    const elements = setup();
    const controller = createStudioModeController(elements);

    expect(elements.app.dataset.studioMode).toBe('normal');
    expect(elements.playButton.hidden).toBe(false);
    expect(elements.recordButton.hidden).toBe(true);
    expect(elements.toggleButton.getAttribute('aria-pressed')).toBe('false');
    expect(elements.toggleButton.querySelector('.label').textContent).toBe('Normal');
    expect(elements.toggleButton.getAttribute('aria-label')).toBe('Switch to Record mode');

    controller.destroy();
  });

  it('switches to Record and back while notifying the media owner', () => {
    const elements = setup();
    const onModeChange = vi.fn();
    const controller = createStudioModeController({ ...elements, onModeChange });

    elements.toggleButton.click();
    expect(elements.app.dataset.studioMode).toBe('record');
    expect(elements.playButton.hidden).toBe(true);
    expect(elements.recordButton.hidden).toBe(false);
    expect(elements.toggleButton.getAttribute('aria-pressed')).toBe('true');
    expect(elements.toggleButton.classList.contains('selected')).toBe(true);
    expect(elements.toggleButton.querySelector('.label').textContent).toBe('Record');
    expect(elements.toggleButton.getAttribute('aria-label')).toBe('Switch to Normal mode');
    expect(onModeChange).toHaveBeenLastCalledWith('record');

    elements.toggleButton.click();
    expect(elements.app.dataset.studioMode).toBe('normal');
    expect(elements.playButton.hidden).toBe(false);
    expect(elements.recordButton.hidden).toBe(true);
    expect(onModeChange).toHaveBeenLastCalledWith('normal');

    controller.destroy();
  });

  it('enters Record mode before enabling media from Settings', async () => {
    const studioMode = { getMode: vi.fn(() => 'normal'), setMode: vi.fn() };
    const requestRecordingMediaReady = vi.fn(async () => true);
    const setCameraEnabled = vi.fn();
    const setMicEnabled = vi.fn();
    const setMediaFromSettings = createStudioMediaSettingsHandler({
      studioMode,
      requestRecordingMediaReady,
      setCameraEnabled,
      setMicEnabled,
    });

    await expect(setMediaFromSettings('camera', true)).resolves.toBe(true);

    expect(studioMode.setMode).toHaveBeenCalledWith('record');
    expect(requestRecordingMediaReady).toHaveBeenCalledOnce();
    expect(setCameraEnabled).not.toHaveBeenCalled();
    expect(setMicEnabled).not.toHaveBeenCalled();
  });

  it('shows the Play or Record panel for the current studio mode', () => {
    document.body.innerHTML = `
      <div class="m-mode-panel active" data-panel="tools"></div>
      <div class="m-mode-panel" data-panel="main"></div>
    `;
    const bar = createMobileStudioBar({ root: document });

    bar.syncFromMode('record');
    expect(document.querySelector('[data-panel="main"]').classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-panel="tools"]').classList.contains('active')).toBe(false);

    bar.syncFromMode('normal');
    expect(document.querySelector('[data-panel="tools"]').classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-panel="main"]').classList.contains('active')).toBe(false);
  });
});
