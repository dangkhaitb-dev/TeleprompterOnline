// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSettingsTheme } from './settings-theme.ui.js';

describe('teleprompter layout guide setting', () => {
  let controller;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app" class="layout-guides-on"></div>
      <div id="prompterPanel"></div>
      <button id="layoutControl" class="selected" aria-pressed="true"></button>
    `;
  });

  afterEach(() => {
    if (controller) controller.destroy();
    controller = null;
    document.body.innerHTML = '';
  });

  it('always starts hidden and keeps toggling session-only', () => {
    const app = document.getElementById('app');
    const layoutControl = document.getElementById('layoutControl');
    const onChange = vi.fn();

    controller = initSettingsTheme({
      app,
      prompterPanel: document.getElementById('prompterPanel'),
      initial: { layoutGuides: true },
      onChange,
    });

    expect(app.classList.contains('layout-guides-on')).toBe(false);
    expect(layoutControl.classList.contains('selected')).toBe(false);
    expect(layoutControl.getAttribute('aria-pressed')).toBe('false');

    layoutControl.click();

    expect(app.classList.contains('layout-guides-on')).toBe(true);
    expect(layoutControl.classList.contains('selected')).toBe(true);
    expect(layoutControl.getAttribute('aria-pressed')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });
});
