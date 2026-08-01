// main.js — landing entry for the teleprompter base.
// Minimal shell: idle-callback polyfill, base styles, deferred Firebase auth
// sync. Build the teleprompter feature under features/ and wire it in here.

import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/main.css';
import '../styles/components/cookie-banner.css';

import { initButtonClickTracking } from './libs/firebase/button-click-analytics.ui.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';
import { initCookieBannerUI } from './features/cookie-banner/cookie-banner.ui.js';
import { listenForConsentAndInitAnalytics } from './libs/firebase/firebase-init.js';

initButtonClickTracking();
releasePointerButtonFocus();
listenForConsentAndInitAnalytics();
initCookieBannerUI();

if (typeof window.requestIdleCallback !== 'function') {
  window.requestIdleCallback = function (cb, options) {
    const timeout = (options && options.timeout) || 1;
    const start = Date.now();
    return setTimeout(() => {
      cb({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (Date.now() - start)) });
    }, timeout);
  };
  window.cancelIdleCallback = function (id) { clearTimeout(id); };
}

document.documentElement.setAttribute('data-theme', 'light');

// Defer Firebase auth-state sync until the browser is idle so it never blocks
// first paint. Firebase is kept as auth plumbing for when the app needs it.
requestIdleCallback(() => {
  import('./libs/firebase/firebase-init.js')
    .then(({ startAuthStateSync }) => startAuthStateSync())
    .catch(() => {});
}, { timeout: 3000 });
