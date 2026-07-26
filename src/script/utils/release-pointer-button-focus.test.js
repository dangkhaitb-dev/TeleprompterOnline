// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { releasePointerButtonFocus } from './release-pointer-button-focus.js';

let cleanup;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

describe('releasePointerButtonFocus', () => {
  it('blurs a button after pointer activation', () => {
    document.body.innerHTML = '<button type="button"><span>Open</span></button>';
    const button = document.querySelector('button');
    const label = document.querySelector('span');
    cleanup = releasePointerButtonFocus();

    button.focus();
    label.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(document.activeElement).not.toBe(button);
  });

  it('keeps focus for keyboard-originated activation', () => {
    document.body.innerHTML = '<button type="button">Save</button>';
    const button = document.querySelector('button');
    cleanup = releasePointerButtonFocus();

    button.focus();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

    expect(document.activeElement).toBe(button);
  });

  it('also handles custom controls with button semantics', () => {
    document.body.innerHTML = '<div role="button" tabindex="0">Menu</div>';
    const button = document.querySelector('[role="button"]');
    cleanup = releasePointerButtonFocus();

    button.focus();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

    expect(document.activeElement).not.toBe(button);
  });
});
