// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from './toast.js';

describe('shared toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('keeps a dismissible alert visible until the user closes it', () => {
    showToast('Turn off Auto there, then try again.', {
      dismissible: true,
      duration: null,
      title: 'Auto scroll stopped',
      variant: 'warning',
    });

    const toast = document.querySelector('.app-toast');
    const dismiss = toast.querySelector('button');
    expect(toast.classList.contains('is-visible')).toBe(true);
    expect(toast.classList.contains('is-dismissible')).toBe(true);
    expect(toast.classList.contains('is-warning')).toBe(true);
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.querySelector('.app-toast__title').textContent).toBe('Auto scroll stopped');
    expect(toast.querySelector('.app-toast__message').textContent)
      .toBe('Turn off Auto there, then try again.');
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss notification');
    expect(dismiss.querySelector('svg')).not.toBeNull();

    vi.advanceTimersByTime(60_000);
    expect(toast.classList.contains('is-visible')).toBe(true);

    dismiss.click();
    expect(toast.classList.contains('is-visible')).toBe(false);
  });
});
