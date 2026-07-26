// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { onWorkspacesChanged } from './cross-tab-sync.js';
import { LS_WORKSPACES } from './storage-keys.js';

const fireStorage = (key) => window.dispatchEvent(new StorageEvent('storage', { key }));

describe('onWorkspacesChanged', () => {
  let off = () => {};
  afterEach(() => off());

  it('calls the handler when the workspaces key changes in another tab', () => {
    const handler = vi.fn();
    off = onWorkspacesChanged(handler);
    fireStorage(LS_WORKSPACES);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated storage keys', () => {
    const handler = vi.fn();
    off = onWorkspacesChanged(handler);
    fireStorage('vteleprompter:some-other-key');
    expect(handler).not.toHaveBeenCalled();
  });

  it('reacts to a full localStorage clear (key === null)', () => {
    const handler = vi.fn();
    off = onWorkspacesChanged(handler);
    fireStorage(null);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops calling after unsubscribe', () => {
    const handler = vi.fn();
    const unsubscribe = onWorkspacesChanged(handler);
    unsubscribe();
    fireStorage(LS_WORKSPACES);
    expect(handler).not.toHaveBeenCalled();
  });

  it('is a safe no-op when the target cannot listen', () => {
    const handler = vi.fn();
    const unsubscribe = onWorkspacesChanged(handler, { target: {} });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
