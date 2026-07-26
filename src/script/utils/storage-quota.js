// storage-quota.js — thin wrapper over the StorageManager API (navigator.
// storage). Reports how much local storage the origin is using vs its quota,
// and can ask the browser to keep the data persistent. No DOM.

export async function estimateStorage() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
      return null;
    }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

// Ask the browser to make storage persistent so recordings aren't evicted under
// disk pressure. Resolves to whether persistence is granted (best-effort).
export async function requestPersistentStorage() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore — persistence is a nice-to-have
  }
  return false;
}
