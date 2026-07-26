// popups.ui.js — toolbar popups: Speed, Settings, Shortcuts, and the camera/mic
// device menus. Positioning + open/close/outside-click/Esc are ported from
// recorder.js (positionQuickMenu, device menus). Only the popups' own show/hide
// and value wiring live here; side effects go through the provided callbacks.

import { getCaptureStream, stopStream } from '../../../utils/media.js';
import { scopedId } from '../../../utils/scoped-query.js';

// Position a popup centered on its trigger and clamped to the stage. Anchored
// to the button itself (not the toolbar shell) so it still works when the
// trigger is moved out of the bottom bar — e.g. the phone top cluster. Drops
// below the trigger when it sits in the top half, otherwise sits above it.
function positionAbove(root, menu, button) {
  const stage = root.querySelector('.stage');
  if (!stage || !menu || !button) return;
  const stageRect = stage.getBoundingClientRect();
  const btnRect = button.getBoundingClientRect();
  const menuWidth = menu.offsetWidth;
  let left = btnRect.left + btnRect.width / 2 - stageRect.left - menuWidth / 2;
  left = Math.max(10, Math.min(left, stageRect.width - menuWidth - 10));
  menu.style.left = `${left}px`;
  const gap = 10;
  if (btnRect.top > stageRect.top + stageRect.height / 2) {
    menu.style.top = 'auto';
    menu.style.bottom = `${stageRect.bottom - btnRect.top + gap}px`;
  } else {
    menu.style.bottom = 'auto';
    menu.style.top = `${btnRect.bottom - stageRect.top + gap}px`;
  }
}

export function initPopups({
  root = document,
  getMicEnabled,
  onDeviceChange,
} = {}) {
  const $ = scopedId(root);
  const cleanups = [];
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  };

  const speedMenu = $('speedMenu');
  const speedControl = $('speedControl');
  const settingsMenu = $('settingsMenu');
  const settingsControl = $('settingsControl');
  const shortcutsMenu = $('shortcutsMenu');
  const shortcutsControl = $('shortcutsControl');

  const deviceMenus = {
    camera: {
      menu: $('cameraMenu'),
      button: root.querySelector('[data-toggle="camera"]'),
      action: $('cameraMenuAction'),
      options: root.querySelector('[data-device-type="camera"]'),
      kind: 'videoinput',
      singular: 'Camera',
      empty: 'No cameras found',
      loading: 'Loading cameras…',
    },
    mic: {
      menu: $('micMenu'),
      button: root.querySelector('[data-toggle="mic"]'),
      action: $('micMenuAction'),
      options: root.querySelector('[data-device-type="mic"]'),
      kind: 'audioinput',
      singular: 'Microphone',
      empty: 'No microphones found',
      loading: 'Loading microphones…',
    },
  };
  const selectedDeviceIds = { camera: '', mic: '' };
  const refreshTokens = { camera: 0, mic: 0 };

  // ---- Quick menus (speed / settings / shortcuts) --------------------------
  function closeQuickMenus() {
    [
      [speedMenu, speedControl],
      [settingsMenu, settingsControl],
      [shortcutsMenu, shortcutsControl],
    ].forEach(([menu, ctrl]) => {
      if (menu) menu.classList.remove('open');
      if (ctrl) {
        ctrl.setAttribute('aria-expanded', 'false');
        ctrl.classList.remove('selected');
      }
    });
  }

  function closeDeviceMenus() {
    Object.values(deviceMenus).forEach((entry) => entry.menu && entry.menu.classList.remove('open'));
  }

  function closeAll() {
    closeQuickMenus();
    closeDeviceMenus();
  }

  function toggleQuickMenu(menu, button) {
    if (!menu || !button) return;
    const shouldOpen = !menu.classList.contains('open');
    closeAll();
    if (!shouldOpen) return;
    menu.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('selected');
    positionAbove(root, menu, button);
  }

  on(speedControl, 'click', () => toggleQuickMenu(speedMenu, speedControl));
  on(settingsControl, 'click', () => toggleQuickMenu(settingsMenu, settingsControl));
  on(shortcutsControl, 'click', () => toggleQuickMenu(shortcutsMenu, settingsControl));

  // ---- Device menus (open from camera/mic caret) ---------------------------
  function updateDeviceActionLabel(type) {
    const entry = deviceMenus[type];
    if (!entry || !entry.action) return;
    const enabled = entry.button && entry.button.getAttribute('aria-pressed') === 'true';
    entry.action.textContent = type === 'camera'
      ? (enabled ? 'Hide Camera' : 'Show Camera')
      : (enabled ? 'Mute Microphone' : 'Unmute Microphone');
  }

  function renderDeviceStatus(entry, message) {
    if (!entry.options) return;
    entry.options.replaceChildren();
    const status = document.createElement('div');
    status.className = 'device-status';
    status.setAttribute('role', 'status');
    status.textContent = message;
    entry.options.append(status);
  }

  function createDeviceOption(type, entry, device, index) {
    const option = document.createElement('button');
    option.className = 'device-option';
    option.type = 'button';
    option.setAttribute('role', 'menuitemradio');
    option.dataset.deviceId = device.deviceId;

    const label = document.createElement('span');
    label.textContent = device.label || `${entry.singular} ${index + 1}`;

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('device-check');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('viewBox', '0 0 16 16');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke-width', '1.5');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', 'm14 4-8 8-4-4');
    icon.append(path);
    option.append(label, icon);

    const selected = selectedDeviceIds[type] === device.deviceId;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
    return option;
  }

  function renderDevices(type, devices) {
    const entry = deviceMenus[type];
    if (!entry || !entry.options) return;
    if (!devices.length) {
      selectedDeviceIds[type] = '';
      renderDeviceStatus(entry, entry.empty);
      return;
    }

    const previousId = selectedDeviceIds[type];
    if (!devices.some((device) => device.deviceId === previousId)) {
      const preferred = devices.find((device) => device.deviceId === 'default') || devices[0];
      selectedDeviceIds[type] = preferred.deviceId;
      if (previousId && typeof onDeviceChange === 'function') {
        onDeviceChange(type, preferred.deviceId);
      }
    }

    entry.options.replaceChildren(...devices.map((device, index) => (
      createDeviceOption(type, entry, device, index)
    )));
  }

  async function refreshDevices(type, { requestPermission = false } = {}) {
    const entry = deviceMenus[type];
    const mediaDevices = navigator.mediaDevices;
    if (!entry || !entry.options) return;
    const refreshToken = ++refreshTokens[type];
    renderDeviceStatus(entry, entry.loading);

    if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') {
      renderDeviceStatus(entry, 'Media devices are not supported by this browser');
      return;
    }

    try {
      let devices = (await mediaDevices.enumerateDevices())
        .filter((device) => device.kind === entry.kind);

      // Browsers hide device labels until the page has capture permission.
      // Ask only when the user explicitly opens this device menu.
      if (requestPermission && (!devices.length || devices.some((device) => !device.label))) {
        let permissionStream = null;
        try {
          permissionStream = await getCaptureStream({
            video: type === 'camera',
            audio: type === 'mic',
          });
        } finally {
          stopStream(permissionStream);
        }
        devices = (await mediaDevices.enumerateDevices())
          .filter((device) => device.kind === entry.kind);
      }

      if (refreshToken === refreshTokens[type]) renderDevices(type, devices);
    } catch (error) {
      if (refreshToken !== refreshTokens[type]) return;
      // Permission can be denied while enumerateDevices still exposes generic
      // entries. Show those when possible instead of leaving fake data behind.
      try {
        const devices = (await mediaDevices.enumerateDevices())
          .filter((device) => device.kind === entry.kind);
        if (devices.length) {
          renderDevices(type, devices);
          return;
        }
      } catch {
        // Fall through to the actionable status below.
      }
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      renderDeviceStatus(entry, denied ? 'Permission is required to list devices' : entry.empty);
    }
  }

  Object.entries(deviceMenus).forEach(([type, entry]) => {
    if (!entry.button || !entry.menu) return;
    const caret = entry.button.querySelector('.caret');
    on(caret, 'click', (e) => {
      e.stopPropagation();
      const isOpen = entry.menu.classList.contains('open');
      closeAll();
      if (!isOpen) {
        updateDeviceActionLabel(type);
        entry.menu.classList.add('open');
        positionAbove(root, entry.menu, entry.button);
        void refreshDevices(type, { requestPermission: true });
      }
    });

    on(entry.options, 'click', (event) => {
      const option = event.target.closest('.device-option');
      if (!option || !entry.options.contains(option)) return;
      entry.options.querySelectorAll('.device-option').forEach((item) => {
        item.classList.remove('selected');
        item.setAttribute('aria-checked', 'false');
      });
      option.classList.add('selected');
      option.setAttribute('aria-checked', 'true');
      selectedDeviceIds[type] = option.dataset.deviceId || '';
      if (typeof onDeviceChange === 'function') {
        onDeviceChange(type, selectedDeviceIds[type]);
      }
      closeDeviceMenus();
    });

    on(entry.action, 'click', () => {
      closeDeviceMenus();
      if (entry.button) entry.button.click();
    });
  });

  // Mobile mic settings row opens the mic device menu anchored to Settings.
  const mobileMicRow = $('mobileMicSettingsRow');
  const mobileMicValue = $('mobileMicSettingsValue');
  const refreshMobileMicValue = () => {
    if (mobileMicValue) mobileMicValue.textContent = (getMicEnabled && getMicEnabled()) ? 'On' : 'Off';
  };
  on(mobileMicRow, 'click', () => {
    updateDeviceActionLabel('mic');
    toggleQuickMenu(deviceMenus.mic.menu, settingsControl);
  });
  refreshMobileMicValue();

  const mediaDevices = navigator.mediaDevices;
  const onDeviceListChange = () => {
    Object.keys(deviceMenus).forEach((type) => void refreshDevices(type));
  };
  if (mediaDevices && typeof mediaDevices.addEventListener === 'function') {
    mediaDevices.addEventListener('devicechange', onDeviceListChange);
    cleanups.push(() => mediaDevices.removeEventListener('devicechange', onDeviceListChange));
  }

  Object.keys(deviceMenus).forEach((type) => void refreshDevices(type));

  // ---- Global close on outside-click / Esc ---------------------------------
  const onPointerDown = (e) => {
    const insideQuick = [
      [speedMenu, speedControl],
      [settingsMenu, settingsControl],
      [shortcutsMenu, settingsControl],
    ].some(([menu, ctrl]) => (menu && menu.contains(e.target)) || (ctrl && ctrl.contains(e.target)));
    if (!insideQuick) closeQuickMenus();

    Object.values(deviceMenus).forEach((entry) => {
      if (!entry.menu || !entry.menu.classList.contains('open')) return;
      if (entry.menu.contains(e.target) || (entry.button && entry.button.contains(e.target))) return;
      entry.menu.classList.remove('open');
    });
  };
  document.addEventListener('pointerdown', onPointerDown);
  cleanups.push(() => document.removeEventListener('pointerdown', onPointerDown));

  const onKeyDown = (e) => { if (e.key === 'Escape') closeAll(); };
  document.addEventListener('keydown', onKeyDown);
  cleanups.push(() => document.removeEventListener('keydown', onKeyDown));

  const onResize = () => {
    if (speedMenu && speedMenu.classList.contains('open')) positionAbove(root, speedMenu, speedControl);
    if (settingsMenu && settingsMenu.classList.contains('open')) positionAbove(root, settingsMenu, settingsControl);
  };
  window.addEventListener('resize', onResize);
  cleanups.push(() => window.removeEventListener('resize', onResize));

  return {
    closeAll,
    refreshMobileMicValue,
    getSelectedDeviceId(type) { return selectedDeviceIds[type] || ''; },
    refreshDevices,
    destroy() { cleanups.forEach((fn) => fn()); },
  };
}
