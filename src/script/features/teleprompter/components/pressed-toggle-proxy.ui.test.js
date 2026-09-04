// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { bindPressedToggleProxy } from './pressed-toggle-proxy.ui.js';

function mount(pressed = 'false') {
  document.body.innerHTML = `
    <button id="src" aria-pressed="${pressed}">Mirror</button>
    <input id="proxy" type="checkbox">
  `;
  const button = document.querySelector('#src');
  button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
  });
  return { button, checkbox: document.querySelector('#proxy') };
}

describe('bindPressedToggleProxy', () => {
  it('starts from the button state and clicks the button when the switch flips', () => {
    const { button, checkbox } = mount('true');
    const unbind = bindPressedToggleProxy({ checkbox, button });
    expect(checkbox.checked).toBe(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(checkbox.checked).toBe(false);

    unbind();
  });

  it('follows the button when it is toggled elsewhere', async () => {
    const { button, checkbox } = mount('false');
    const unbind = bindPressedToggleProxy({ checkbox, button });

    button.click();
    await Promise.resolve();
    expect(checkbox.checked).toBe(true);

    unbind();
    button.click();
    await Promise.resolve();
    expect(checkbox.checked).toBe(true);
  });

  it('is a no-op without both elements', () => {
    expect(() => bindPressedToggleProxy({ checkbox: null, button: null })()).not.toThrow();
  });
});
