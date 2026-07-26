/**
 * Firebase Initialization
 *
 * Handles Firebase app initialization for analytics and auth.
 * Uses modular SDK for minimal bundle size.
 */

import { initializeApp, getApps } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { saveAuthState, clearCachedAuthState, getCachedAuthState } from './auth-cache.js';

// Re-export for backward compatibility
export { getCachedAuthState, clearCachedAuthState };

// Firebase configuration from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyCx2DjEGIRtwCUjfwgBWmlJn38SufPab6E",
  authDomain: "freesub-19b6f.firebaseapp.com",
  projectId: "freesub-19b6f",
  storageBucket: "freesub-19b6f.firebasestorage.app",
  messagingSenderId: "198073792624",
  appId: "1:198073792624:web:62665a8a70a6ebcbe45cb5",
  measurementId: "G-QYE4THHVJF"
};

/**
 * Initialize Firebase app and analytics
 *
 * @returns {Promise<{app: FirebaseApp, analytics: Analytics}|null>}
 *          Returns Firebase instances or null if initialization fails
 */
export async function initializeFirebase() {
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  try {
    // Check if analytics is supported (Safari private mode returns false)
    const analyticsSupported = await isSupported();

    if (!analyticsSupported) {
      if (isDev) {
      }
      return null;
    }

    // Initialize Firebase app
    const app = initializeApp(firebaseConfig);

    // Initialize Analytics (auto-tracking enabled by default)
    const analytics = getAnalytics(app);

    if (isDev) {
    }

    return { app, analytics };

  } catch (error) {
    // Silent fail - app continues to work without analytics
    return null;
  }
}

/**
 * Get or initialize Firebase app instance
 */
function getFirebaseApp() {
  const apps = getApps();
  if (apps.length > 0) return apps[0];
  return initializeApp(firebaseConfig);
}

/**
 * Initialize Firebase Auth - restore session or create anonymous user
 * Also syncs auth state to localStorage for early redirect checks
 * @returns {Promise<{user: User|null, isAnonymous: boolean}>}
 */
export async function initFirebaseAuth() {
  const app = getFirebaseApp();
  const auth = getAuth(app);

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();

      if (user) {
        saveAuthState(user);
        resolve({ user, isAnonymous: user.isAnonymous });
        return;
      }

      const result = await signInAnonymously(auth);
      saveAuthState(result.user);
      resolve({ user: result.user, isAnonymous: true });
    });
  });
}

/**
 * Start persistent auth state listener (call once on app init)
 * Updates localStorage whenever auth state changes
 */
export function startAuthStateSync() {
  const app = getFirebaseApp();
  const auth = getAuth(app);

  onAuthStateChanged(auth, (user) => {
    saveAuthState(user);
  });
}

/**
 * Get current user's Firebase ID token
 * @param {boolean} forceRefresh - force refresh the token
 * @returns {Promise<string|null>}
 */
export async function getFirebaseIdToken(forceRefresh = false) {
  const app = getFirebaseApp();
  const auth = getAuth(app);

  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken(forceRefresh);
}

/**
 * Get current Firebase user
 * @returns {User|null}
 */
export function getCurrentUser() {
  const app = getFirebaseApp();
  const auth = getAuth(app);
  return auth.currentUser;
}

/**
 * Check if current user is anonymous
 * @returns {boolean}
 */
export function isAnonymousUser() {
  const user = getCurrentUser();
  return user?.isAnonymous ?? true;
}

let popupWarmupPromise = null;

/**
 * Pre-load everything signInWithPopup awaits BEFORE it calls window.open:
 * the gapi script + cross-origin auth iframe (resolver._initialize) and the
 * anonymous user's ID token. On iOS Safari those loads consume the tap's
 * user activation — popup gets blocked on first tap if they aren't cached.
 * Await this while the login modal opens, before the user can tap.
 * @returns {Promise<void>}
 */
export function warmupAuthPopup() {
  if (!popupWarmupPromise) {
    popupWarmupPromise = (async () => {
      const auth = getAuth(getFirebaseApp());
      // On mobile/Safari the SDK proactively loads the popup iframe during
      // auth init (_shouldInitProactively) and authStateReady() only resolves
      // after that step — once settled, signInWithPopup finds the iframe
      // cached and reaches window.open while the tap gesture is still alive.
      await auth.authStateReady();
      if (auth.currentUser?.isAnonymous) {
        await auth.currentUser.getIdToken().catch(() => {});
      }
    })();
    // Reset on failure so a later call can retry
    popupWarmupPromise.catch(() => { popupWarmupPromise = null; });
  }
  return popupWarmupPromise;
}

/**
 * Sign in with Google popup
 * Captures anonymous token BEFORE popup for merge
 * @returns {Promise<{idToken: string, anonToken: string|null, user: {uid: string, email: string, displayName: string, photoURL: string}}>}
 */
export async function signInWithGoogle() {
  const app = getFirebaseApp();
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();

  // Capture anonymous token BEFORE popup (popup replaces currentUser)
  let anonToken = null;
  if (auth.currentUser?.isAnonymous) {
    anonToken = await auth.currentUser.getIdToken();
  }

  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();

  return {
    idToken,
    anonToken,
    user: {
      uid: result.user.uid,
      email: result.user.email,
      displayName: result.user.displayName,
      photoURL: result.user.photoURL
    }
  };
}

/**
 * Sign out current user and clear cached auth state
 */
export async function signOutFirebase() {
  const app = getFirebaseApp();
  const auth = getAuth(app);
  clearCachedAuthState();
  await auth.signOut();
}

/**
 * Subscribe to auth state changes
 * @param {(user: User|null) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribeAuthState(callback) {
  const app = getFirebaseApp();
  const auth = getAuth(app);
  return onAuthStateChanged(auth, callback);
}
