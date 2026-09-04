// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportMenu, EXPORT_BUSY_MIN_MS } from './export-menu.ui.js';

describe('createExportMenu busy state', () => {
  let ac;

  beforeEach(() => {
    vi.useFakeTimers();
    ac = new AbortController();
  });

  afterEach(() => {
    ac.abort();
    vi.useRealTimers();
  });

  function mount(overrides = {}) {
    return createExportMenu({
      signal: ac.signal,
      labels: { export: 'Export' },
      getIntent: () => 'direct',
      ...overrides,
    });
  }

  it('shows spinner, disables button and swaps label while busy', () => {
    const menu = mount();
    const button = menu.el.querySelector('[data-role="export"]');
    const spinner = menu.el.querySelector('[data-role="export-spinner"]');
    const label = menu.el.querySelector('[data-role="export-label"]');

    menu.setBusy(true, 'Loading…');

    expect(button.disabled).toBe(true);
    expect(button.classList.contains('is-loading')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(spinner.hidden).toBe(false);
    expect(label.textContent).toBe('Loading…');
  });

  it('keeps the busy state for at least EXPORT_BUSY_MIN_MS after an instant export', () => {
    const menu = mount();
    const button = menu.el.querySelector('[data-role="export"]');
    const spinner = menu.el.querySelector('[data-role="export-spinner"]');
    const label = menu.el.querySelector('[data-role="export-label"]');

    menu.setBusy(true, 'Loading…');
    menu.setBusy(false);

    // Still busy right after release is requested.
    expect(button.disabled).toBe(true);
    expect(spinner.hidden).toBe(false);
    expect(label.textContent).toBe('Loading…');

    vi.advanceTimersByTime(EXPORT_BUSY_MIN_MS - 1);
    expect(button.disabled).toBe(true);

    vi.advanceTimersByTime(1);
    expect(button.disabled).toBe(false);
    expect(button.classList.contains('is-loading')).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(spinner.hidden).toBe(true);
    expect(label.textContent).toBe('Export');
  });

  it('releases immediately when the export already took longer than the minimum', () => {
    const menu = mount();
    const button = menu.el.querySelector('[data-role="export"]');

    menu.setBusy(true, 'Creating ZIP…');
    vi.advanceTimersByTime(EXPORT_BUSY_MIN_MS + 500);
    menu.setBusy(false);

    expect(button.disabled).toBe(false);
    expect(button.classList.contains('is-loading')).toBe(false);
  });

  it('ignores clicks while busy', () => {
    const onDirect = vi.fn();
    const menu = mount({ onDirect });
    const button = menu.el.querySelector('[data-role="export"]');

    menu.setBusy(true, 'Loading…');
    button.click();

    expect(onDirect).not.toHaveBeenCalled();
  });

  it('cancels a pending release when busy is re-entered', () => {
    const menu = mount();
    const button = menu.el.querySelector('[data-role="export"]');
    const label = menu.el.querySelector('[data-role="export-label"]');

    menu.setBusy(true, 'Loading…');
    menu.setBusy(false);
    menu.setBusy(true, 'Creating ZIP…');
    vi.advanceTimersByTime(EXPORT_BUSY_MIN_MS);

    expect(button.disabled).toBe(true);
    expect(label.textContent).toBe('Creating ZIP…');
  });
});
