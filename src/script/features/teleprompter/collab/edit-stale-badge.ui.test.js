// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initEditStaleBadge } from './edit-stale-badge.ui.js';
import { LS_WORKSPACES } from '../../../utils/storage-keys.js';

const fireStorage = () => window.dispatchEvent(new StorageEvent('storage', { key: LS_WORKSPACES }));

// A mutable stand-in for the store: tests flip `current` then fire a storage
// event, mirroring "another tab saved".
function makeStore(initial) {
  let current = initial;
  return {
    read: () => current,
    set: (next) => { current = next; },
  };
}

const ws = (over = {}) => ({
  id: 'ws1',
  scriptHtml: '<p>hello</p>',
  scriptText: 'hello',
  settings: { wpm: 120, align: 'left' },
  ...over,
});

describe('initEditStaleBadge', () => {
  let mount;
  let handle;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });
  afterEach(() => {
    handle?.destroy();
    mount.remove();
  });

  const badgeEl = () => mount.querySelector('.tp-stale-badge');

  it('mounts hidden and stays hidden when nothing diverges', () => {
    const store = makeStore(ws());
    handle = initEditStaleBadge({ mount, readWorkspace: store.read, isSyncPaused: () => false });
    expect(badgeEl()).toBeTruthy();
    expect(badgeEl().hidden).toBe(true);
    fireStorage();
    expect(badgeEl().hidden).toBe(true);
  });

  it('shows when another tab changed the content', () => {
    const store = makeStore(ws());
    handle = initEditStaleBadge({ mount, readWorkspace: store.read, isSyncPaused: () => false });
    store.set(ws({ scriptHtml: '<p>changed</p>', scriptText: 'changed' }));
    fireStorage();
    expect(badgeEl().hidden).toBe(false);
  });

  it('ignores a settings-only change (content-only scope)', () => {
    const store = makeStore(ws());
    handle = initEditStaleBadge({ mount, readWorkspace: store.read, isSyncPaused: () => false });
    store.set(ws({ settings: { wpm: 200, align: 'left' } }));
    fireStorage();
    expect(badgeEl().hidden).toBe(true);
  });

  it('stays hidden while Play/Record is active (sync paused)', () => {
    const store = makeStore(ws());
    handle = initEditStaleBadge({ mount, readWorkspace: store.read, isSyncPaused: () => true });
    store.set(ws({ scriptHtml: '<p>changed</p>' }));
    fireStorage();
    expect(badgeEl().hidden).toBe(true);
  });

  it('markLocalWrite re-baselines and clears the badge', () => {
    const store = makeStore(ws());
    handle = initEditStaleBadge({ mount, readWorkspace: store.read, isSyncPaused: () => false });
    store.set(ws({ scriptHtml: '<p>changed</p>' }));
    fireStorage();
    expect(badgeEl().hidden).toBe(false);

    handle.markLocalWrite(); // this tab now holds the newest version
    expect(badgeEl().hidden).toBe(true);
    fireStorage(); // same (already current) state — should not re-show
    expect(badgeEl().hidden).toBe(true);
  });

  it('clicking the badge runs the reload action', () => {
    const store = makeStore(ws());
    const reload = vi.fn();
    handle = initEditStaleBadge({ mount, readWorkspace: store.read, isSyncPaused: () => false, reload });
    store.set(ws({ scriptHtml: '<p>changed</p>' }));
    fireStorage();
    badgeEl().click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('destroy removes the badge and stops listening', () => {
    const store = makeStore(ws());
    handle = initEditStaleBadge({ mount, readWorkspace: store.read, isSyncPaused: () => false });
    handle.destroy();
    expect(mount.querySelector('.tp-stale-badge')).toBeNull();
    store.set(ws({ scriptHtml: '<p>changed</p>' }));
    expect(() => fireStorage()).not.toThrow();
  });

  it('degrades to a no-op without a mount or reader', () => {
    const noop = initEditStaleBadge({});
    expect(() => noop.markLocalWrite()).not.toThrow();
    expect(() => noop.destroy()).not.toThrow();
  });
});
