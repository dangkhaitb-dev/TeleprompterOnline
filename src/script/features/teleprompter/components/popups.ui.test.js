// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initPopups } from './popups.ui.js';

describe('teleprompter media device menus', () => {
  let controller;
  let cameraPermissionGranted;
  let stopTrack;
  let mediaDevices;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="stage"><div class="toolbar-shell"></div></div>
      <button data-toggle="camera" aria-pressed="false"><span class="caret"></span></button>
      <button data-toggle="mic" aria-pressed="true"><span class="caret"></span></button>
      <div id="cameraMenu"><div data-device-type="camera"></div><button id="cameraMenuAction"></button></div>
      <div id="micMenu"><div data-device-type="mic"></div><button id="micMenuAction"></button></div>
    `;
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
    controller = initPopups({ onDeviceChange });

    document.querySelector('[data-toggle="camera"] .caret').click();

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
    controller = initPopups();
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
});
