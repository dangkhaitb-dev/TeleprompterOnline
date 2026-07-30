// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initPopups } from './popups.ui.js';

describe('teleprompter media device menus', () => {
  let controller;
  let cameraPermissionGranted;
  let stopTrack;
  let mediaDevices;
  let mediaState;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="stage">
        <div class="toolbar-shell"><button id="settingsControl" aria-expanded="false"></button></div>
        <div id="settingsMenu">
          <div id="cameraSettingsGroup">
            <button id="cameraSettingsRow" aria-expanded="false"></button>
            <input id="toggleCamera" type="checkbox">
            <span id="cameraSettingsValue"></span>
          </div>
          <div id="micSettingsGroup">
            <button id="micSettingsRow" aria-expanded="false"></button>
            <input id="toggleMic" type="checkbox">
            <span id="micSettingsValue"></span>
          </div>
        </div>
      </div>
      <div id="cameraMenu"><div data-device-type="camera"></div><button id="cameraMenuAction"></button></div>
      <div id="micMenu"><div data-device-type="mic"></div><button id="micMenuAction"></button></div>
    `;
    mediaState = { camera: false, mic: true };
    cameraPermissionGranted = false;
    stopTrack = vi.fn();
    mediaDevices = new EventTarget();
    mediaDevices.enumerateDevices = vi.fn(async () => [
      {
        kind: 'videoinput',
        deviceId: 'camera-built-in',
        label: cameraPermissionGranted ? 'FaceTime HD Camera' : '',
      },
      {
        kind: 'videoinput',
        deviceId: 'camera-usb',
        label: cameraPermissionGranted ? 'USB Camera' : '',
      },
      { kind: 'audioinput', deviceId: 'default', label: 'MacBook Microphone' },
    ]);
    mediaDevices.getUserMedia = vi.fn(async (constraints) => {
      if (constraints.video) cameraPermissionGranted = true;
      return { getTracks: () => [{ stop: stopTrack }] };
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices,
    });
  });

  afterEach(() => {
    if (controller) controller.destroy();
    controller = null;
    document.body.innerHTML = '';
  });

  it('requests permission and replaces placeholder values with connected cameras', async () => {
    const onDeviceChange = vi.fn();
    controller = initPopups({
      getMediaEnabled: (type) => mediaState[type],
      onDeviceChange,
    });

    document.querySelector('#cameraSettingsRow').click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-device-type="camera"] .device-option')).toHaveLength(2);
      expect(document.querySelector('[data-device-type="camera"]').textContent)
        .toContain('FaceTime HD Camera');
    });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(controller.getSelectedDeviceId('camera')).toBe('camera-built-in');

    const usbCamera = document.querySelector('[data-device-id="camera-usb"]');
    usbCamera.click();

    expect(controller.getSelectedDeviceId('camera')).toBe('camera-usb');
    expect(onDeviceChange).toHaveBeenCalledWith('camera', 'camera-usb');
  });

  it('refreshes the list when the browser reports a device change', async () => {
    controller = initPopups({ getMediaEnabled: (type) => mediaState[type] });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-device-type="mic"]').textContent)
        .toContain('MacBook Microphone');
    });

    mediaDevices.enumerateDevices.mockResolvedValue([
      { kind: 'audioinput', deviceId: 'usb-mic', label: 'USB Podcast Microphone' },
    ]);
    mediaDevices.dispatchEvent(new Event('devicechange'));

    await vi.waitFor(() => {
      expect(document.querySelector('[data-device-type="mic"]').textContent)
        .toContain('USB Podcast Microphone');
    });
  });

  it('opens Settings for missing media and keeps both On/Off values in sync', () => {
    controller = initPopups({ getMediaEnabled: (type) => mediaState[type] });

    controller.openSettingsForMedia(['camera']);

    expect(document.querySelector('#settingsMenu').classList.contains('open')).toBe(true);
    expect(document.querySelector('#cameraSettingsGroup').classList.contains('is-required')).toBe(true);
    expect(document.querySelector('#micSettingsGroup').classList.contains('is-required')).toBe(false);
    expect(document.querySelector('#cameraSettingsValue').textContent).toBe('Off');
    expect(document.querySelector('#micSettingsValue').textContent).toBe('On');
    expect(document.querySelector('#toggleCamera').checked).toBe(false);
    expect(document.querySelector('#toggleMic').checked).toBe(true);
  });

  it('uses the device-menu action to enable media without a toolbar toggle', async () => {
    const onMediaToggle = vi.fn(async (type, enabled) => {
      mediaState[type] = enabled;
      return enabled;
    });
    controller = initPopups({
      getMediaEnabled: (type) => mediaState[type],
      onMediaToggle,
    });

    document.querySelector('#cameraSettingsRow').click();
    document.querySelector('#cameraMenuAction').click();

    await vi.waitFor(() => {
      expect(onMediaToggle).toHaveBeenCalledWith('camera', true);
      expect(document.querySelector('#cameraSettingsValue').textContent).toBe('On');
    });
  });
});
