// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LS_TP_COLOR_HISTORY } from '../../../utils/storage-keys.js';
import { createColorPicker } from './color-picker.ui.js';

const storedValues = vi.hoisted(() => new Map());

vi.mock('../../../utils/storage.js', () => ({
  getItem: (key) => storedValues.get(key) ?? null,
  setItem: (key, value) => storedValues.set(key, value),
}));

describe('color picker swatch grid', () => {
  let picker;

  beforeEach(() => {
    storedValues.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    picker?.destroy();
    picker = null;
    document.body.innerHTML = '';
    storedValues.clear();
  });

  function openPicker(hex) {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    picker = createColorPicker();
    picker.open(trigger, { hex });
    return [...document.querySelectorAll('.color-popup-swatch')];
  }

  it('renders one custom color, four different history colors, and five common text colors', () => {
    storedValues.set(LS_TP_COLOR_HISTORY, [
      '#FFFFFF', '#ffffff', '#f2c94c', '#75dd28', '#4598e7',
    ]);

    const swatches = openPicker('#ffffff');
    const colors = swatches.map((swatch) => swatch.dataset.hex);

    expect(swatches).toHaveLength(10);
    expect(swatches[0].classList).toContain('custom-swatch');
    expect(swatches.slice(1, 5).every((swatch) => swatch.classList.contains('history-swatch'))).toBe(true);
    expect(swatches.slice(5).every((swatch) => swatch.classList.contains('preset-swatch'))).toBe(true);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.slice(1, 5)).not.toContain(colors[0]);
  });
});
