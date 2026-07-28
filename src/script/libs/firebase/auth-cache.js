/**
 * Auth State Cache (localStorage only - no Firebase dependency)
 *
 * Fast auth state checks without loading Firebase. Import this when you only
 * need cached auth state (e.g. redirect checks). Storage goes through the
 * utils/storage wrapper.
 */

import { getItem, setItem, removeItem } from '../../utils/storage.js';
import { LS_AUTH_STATE } from '../../utils/storage-keys.js';

/**
 * Get cached auth state from localStorage (for early redirect check)
 * @returns {{ isAnonymous: boolean, uid: string, email: string|null } | null}
 */
export function getCachedAuthState() {
  const cached = getItem(LS_AUTH_STATE);
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return null;
  if (typeof cached.uid !== 'string' || !cached.uid) return null;
  return {
    isAnonymous: !!cached.isAnonymous,
    uid: cached.uid,
    email: typeof cached.email === 'string' ? cached.email : null,
    displayName: typeof cached.displayName === 'string' ? cached.displayName : null,
    photoURL: typeof cached.photoURL === 'string' ? cached.photoURL : null,
  };
}

/**
 * Save auth state to localStorage
 * @param {Object|null} user - Firebase user object or null
 */
export function saveAuthState(user) {
  if (user) {
    setItem(LS_AUTH_STATE, {
      isAnonymous: user.isAnonymous,
      uid: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
    });
  } else {
    removeItem(LS_AUTH_STATE);
  }
}

/**
 * Clear cached auth state (call on logout)
 */
export function clearCachedAuthState() {
  removeItem(LS_AUTH_STATE);
}
