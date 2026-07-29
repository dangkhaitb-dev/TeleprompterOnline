// color-picker.ui.js — shared HSV color popup (SV square + hue bar + presets +
// history + hex input). Ported from recorder.js openColorPopup. Reusable via
// openColorPopup(trigger, { hex, dark, onPick }). Color math comes from the
// model; history persists through utils/storage.

import {
  PRESET_COLORS,
  DEFAULT_COLOR_HISTORY,
  clamp01,
  normalizeHexColor,
  hexToRgb,
  rgbToHsv,
  hsvToHex,
} from '../teleprompter.model.js';
import { getItem, setItem } from '../../../utils/storage.js';
import { LS_TP_COLOR_HISTORY } from '../../../utils/storage-keys.js';

const HISTORY_MAX = 4;

function getColorHistory() {
  const raw = getItem(LS_TP_COLOR_HISTORY);
  const list = Array.isArray(raw)
    ? [...new Set(raw.map((h) => normalizeHexColor(h)).filter(Boolean))]
    : [];
  return list.length ? list.slice(0, HISTORY_MAX) : DEFAULT_COLOR_HISTORY.slice(0, HISTORY_MAX);
}

function saveColorHistory(list) {
  const unique = [...new Set(list.map((h) => normalizeHexColor(h)).filter(Boolean))];
  setItem(LS_TP_COLOR_HISTORY, unique.slice(0, HISTORY_MAX));
}

function addColorToHistory(hex) {
  const norm = normalizeHexColor(hex);
  if (!norm) return;
  const history = getColorHistory().filter((h) => normalizeHexColor(h) !== norm);
  history.unshift(norm);
  saveColorHistory(history);
}

// Build the popup once and reuse it for every trigger. Returns an API.
export function createColorPicker({ portal = document.body } = {}) {
  const popup = document.createElement('div');
  popup.className = 'color-popup';
  popup.innerHTML = `
    <div class="color-popup-sv" data-role="sv"><div class="color-popup-sv-thumb" data-role="sv-thumb"></div></div>
    <div class="color-popup-hue" data-role="hue"><div class="color-popup-hue-thumb" data-role="hue-thumb"></div></div>
    <div class="color-popup-grid" data-role="grid"></div>
    <label class="color-popup-hex">
      <span class="color-popup-hex-dot" data-role="dot"></span>
      <span class="color-popup-hex-prefix">#</span>
      <input type="text" data-role="hex" maxlength="6" autocomplete="off" spellcheck="false" placeholder="000000">
    </label>`;
  portal.appendChild(popup);

  const sv = popup.querySelector('[data-role="sv"]');
  const svThumb = popup.querySelector('[data-role="sv-thumb"]');
  const hue = popup.querySelector('[data-role="hue"]');
  const hueThumb = popup.querySelector('[data-role="hue-thumb"]');
  const grid = popup.querySelector('[data-role="grid"]');
  const dot = popup.querySelector('[data-role="dot"]');
  const hexInput = popup.querySelector('[data-role="hex"]');
  hexInput.dataset.analyticsName = 'colorHexChange';

  let ctx = null; // { trigger, onPick }
  let hsv = { h: 0, s: 0, v: 0 };

  function renderGrid(activeHex) {
    const active = normalizeHexColor(activeHex);
    const history = [...getColorHistory(), ...DEFAULT_COLOR_HISTORY]
      .map((hex) => normalizeHexColor(hex))
      .filter((hex, index, colors) => hex && hex !== active && colors.indexOf(hex) === index)
      .slice(0, HISTORY_MAX);
    const usedInFirstRow = new Set([active, ...history]);
    const commonTextColors = [...PRESET_COLORS, ...DEFAULT_COLOR_HISTORY]
      .map((hex) => normalizeHexColor(hex))
      .filter((hex, index, colors) => (
        hex && !usedInFirstRow.has(hex) && colors.indexOf(hex) === index
      ))
      .slice(0, 5);
    const cells = [
      { hex: active, cls: 'custom-swatch', label: 'Custom Color' },
      ...history.map((hex, i) => ({ hex, cls: 'history-swatch', label: `History ${i + 1}` })),
      ...commonTextColors.map((hex) => ({ hex, cls: 'preset-swatch', label: hex })),
    ];
    grid.textContent = '';
    cells.forEach(({ hex, cls, label }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `color-popup-swatch ${cls}`;
      b.dataset.hex = hex || '';
      b.dataset.analyticsName = 'colorSwatchClick';
      b.style.background = hex || 'transparent';
      b.setAttribute('aria-label', label);
      if (hex && normalizeHexColor(hex) === normalizeHexColor(activeHex)) b.classList.add('selected');
      b.addEventListener('click', () => { if (b.dataset.hex) pickHex(b.dataset.hex); });
      grid.appendChild(b);
    });
  }

  function renderThumbs() {
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    popup.querySelector('[data-role="sv"]').style.setProperty('--hue', String(Math.round(hsv.h)));
  }

  function pickHsv(h, s, v) {
    hsv = { h, s, v };
    const hex = hsvToHex(h, s, v);
    dot.style.background = hex;
    hexInput.value = hex.replace('#', '');
    renderThumbs();
    if (ctx && ctx.onPick) ctx.onPick(hex);
  }

  function pickHex(hex, { skipHexField, silent } = {}) {
    const norm = normalizeHexColor(hex);
    if (!norm) return;
    const { r, g, b } = hexToRgb(norm);
    hsv = rgbToHsv(r, g, b);
    dot.style.background = norm;
    if (!skipHexField) hexInput.value = norm.replace('#', '');
    renderThumbs();
    renderGrid(norm);
    // silent: initialize the popup UI without applying the color — opening
    // the picker must not recolor the selection before the user picks.
    if (!silent && ctx && ctx.onPick) ctx.onPick(norm);
  }

  // Drag helpers for SV square + hue bar.
  function bindDrag(el, handler) {
    let dragging = false;
    const move = (e) => {
      const rect = el.getBoundingClientRect();
      const x = clamp01((e.clientX - rect.left) / rect.width);
      const y = clamp01((e.clientY - rect.top) / rect.height);
      handler(x, y);
    };
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      move(e);
    });
    el.addEventListener('pointermove', (e) => { if (dragging) move(e); });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });
  }

  bindDrag(sv, (x, y) => pickHsv(hsv.h, x, 1 - y));
  bindDrag(hue, (x) => pickHsv(x * 360, hsv.s || 1, hsv.v || 1));

  hexInput.addEventListener('input', () => {
    const norm = normalizeHexColor(hexInput.value);
    if (norm) pickHex(norm, { skipHexField: true });
  });

  function position(trigger) {
    const rect = trigger.getBoundingClientRect();
    const width = popup.offsetWidth || 232;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 8;
    const height = popup.offsetHeight || 260;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  function open(trigger, { hex, dark, onPick } = {}) {
    ctx = { trigger, onPick };
    popup.classList.toggle('dark', !!dark);
    const start = normalizeHexColor(hex) || '#ef4d62';
    pickHex(start, { silent: true });
    renderGrid(start);
    popup.classList.add('show');
    position(trigger);
    trigger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!popup.classList.contains('show')) return;
    popup.classList.remove('show');
    if (ctx && ctx.trigger) ctx.trigger.setAttribute('aria-expanded', 'false');
    // Persist the picked color once the popup closes.
    const norm = normalizeHexColor(hexInput.value);
    if (norm) addColorToHistory(norm);
    ctx = null;
  }

  // Outside-click / Esc to close.
  document.addEventListener('pointerdown', (e) => {
    if (!popup.classList.contains('show')) return;
    if (popup.contains(e.target)) return;
    if (ctx && ctx.trigger && ctx.trigger.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('resize', () => {
    if (popup.classList.contains('show') && ctx && ctx.trigger) position(ctx.trigger);
  });

  return {
    open,
    close,
    isOpen: () => popup.classList.contains('show'),
    destroy: () => popup.remove(),
  };
}
