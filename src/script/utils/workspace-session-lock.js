// Workspace session presence using Web Locks. Studio sessions take shared locks;
// garbage collection takes an exclusive lock with `ifAvailable`, so GC can run
// only after the final live Studio session releases its shared lock.

// Acquire a shared session lock for a workspace. Resolves to
// `{ acquired, release }`; calling `release()` lets the browser free the lock
// (an in-page overlay closes without a page unload, so it must release
// explicitly). The browser still auto-releases when the page closes/crashes.
export function acquireWorkspaceSessionLock(id, lockManager) {
  const locks = lockManager === undefined
    ? (typeof navigator !== 'undefined' ? navigator.locks : null)
    : lockManager;
  const noop = () => {};
  if (!id || !locks) return Promise.resolve({ acquired: false, release: noop });

  return new Promise((resolve) => {
    let acquired = false;
    let release = noop;
    const held = new Promise((releaseLock) => {
      release = releaseLock;
    });
    locks.request(`vp:ws:${id}`, { mode: 'shared' }, () => {
      acquired = true;
      resolve({ acquired: true, release });
      return held;
    }).catch(() => {
      if (!acquired) resolve({ acquired: false, release: noop });
    });
  });
}
