// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initNotch } from './notch.ui.js';

describe('Notch typography synchronization', () => {
  let notch;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app"></div>
      <button id="notchControl" aria-pressed="false"></button>
      <div id="source" style="font-size: 24px; line-height: 1.5;">One<br>Two</div>
      <div id="notchPrompter">
        <div id="notchScroll"><div id="notchText"></div></div>
        <button id="notchEditBtn" aria-pressed="false"></button>
        <div id="notchEditPanel">
          <div id="notchEditToolbar"></div>
          <div id="notchEditText"></div>
        </div>
      </div>
    `;
    notch = initNotch({
      app: document.getElementById('app'),
      getEditSurface: () => document.getElementById('source'),
      shouldEnterFullscreen: () => false,
    });
  });

  afterEach(() => {
    notch.destroy();
    document.body.innerHTML = '';
  });

  it('preserves a unitless line-height ratio in the preview and editor', () => {
    document.getElementById('notchControl').click();
    document.getElementById('notchEditBtn').click();

    expect(document.getElementById('notchText').style.lineHeight).toBe('1.5');
    expect(document.getElementById('notchEditText').style.lineHeight).toBe('1.5');
  });
});
