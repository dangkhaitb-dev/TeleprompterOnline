import { describe, expect, it, vi } from 'vitest';
import { acquireWorkspaceSessionLock } from './workspace-session-lock.js';

describe('acquireWorkspaceSessionLock', () => {
  it('requests a shared lock with the workspace-scoped name', async () => {
    let heldPromise;
    const locks = {
      request: vi.fn((_name, _options, callback) => {
        heldPromise = callback({ name: 'vp:ws:alpha', mode: 'shared' });
        return heldPromise;
      }),
    };

    const lock = await acquireWorkspaceSessionLock('alpha', locks);
    expect(lock.acquired).toBe(true);
    expect(locks.request).toHaveBeenCalledWith(
      'vp:ws:alpha',
      { mode: 'shared' },
      expect.any(Function),
    );

    // The lock stays held until release() is called…
    const marker = Symbol('still-held');
    await expect(Promise.race([heldPromise, Promise.resolve(marker)])).resolves.toBe(marker);

    // …then release() settles the callback promise so the browser frees it.
    lock.release();
    await expect(heldPromise).resolves.toBeUndefined();
  });

  it.each([
    ['', { request: vi.fn() }],
    [null, { request: vi.fn() }],
    ['alpha', null],
  ])('fails closed without an id or lock manager', async (id, locks) => {
    const lock = await acquireWorkspaceSessionLock(id, locks);
    expect(lock.acquired).toBe(false);
    expect(() => lock.release()).not.toThrow();
    if (locks) expect(locks.request).not.toHaveBeenCalled();
  });

  it('resolves unacquired if the browser rejects the request before acquisition', async () => {
    const locks = { request: vi.fn(() => Promise.reject(new Error('denied'))) };

    const lock = await acquireWorkspaceSessionLock('alpha', locks);
    expect(lock.acquired).toBe(false);
    expect(() => lock.release()).not.toThrow();
  });
});
