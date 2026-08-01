// cookie-banner.ui.js — cookie consent banner.
// Shows a banner on first visit, stores the decision, dispatches
// ANALYTICS_CONSENT_CHANGED so analytics can activate without a page reload.
// Must not be imported by lower layers (ui is the top layer).

import { EVENTS } from '../../constants/events.js';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  hasDecided,
} from '../../utils/cookie-consent.js';

/**
 * Mount the cookie consent banner if the user has not yet decided.
 * Call once per page from the main entry script after styles are loaded.
 */
export function initCookieBannerUI() {
  // The recording studio is intentionally distraction-free. Its entry point
  // does not mount this UI, and this guard also removes any banner if another
  // caller invokes the initializer while the teleprompter page is active.
  if (
    document.body?.classList.contains('tp')
    || document.documentElement.classList.contains('tp-page')
  ) {
    document.querySelectorAll('.cookie-banner').forEach((banner) => banner.remove());
    return;
  }

  if (hasDecided()) {
    // User already decided — activate analytics immediately if granted.
    if (getAnalyticsConsent() === 'granted') {
      dispatchConsentEvent('granted');
    }
    return;
  }

  const banner = buildBanner();
  // Consent must be visible on the first render; do not defer it with an idle
  // callback or animation-frame chain.
  banner.classList.add('cookie-banner--visible');
  document.body.appendChild(banner);

  const dismiss = (decision) => {
    setAnalyticsConsent(decision);
    banner.classList.remove('cookie-banner--visible');
    banner.addEventListener('transitionend', () => banner.remove(), { once: true });
    dispatchConsentEvent(decision);
  };

  banner.querySelector('#cookieAcceptBtn').addEventListener('click', () => dismiss('granted'));
  banner.querySelector('#cookieDeclineBtn').addEventListener('click', () => dismiss('denied'));
}

function dispatchConsentEvent(consent) {
  window.dispatchEvent(
    new CustomEvent(EVENTS.ANALYTICS_CONSENT_CHANGED, { detail: { consent } }),
  );
}

function buildBanner() {
  const el = document.createElement('div');
  el.className = 'cookie-banner';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Cookie consent');
  el.innerHTML = `
    <div class="cookie-banner__inner">
      <div class="cookie-banner__text">
        <p class="cookie-banner__message">
          We use cookies to keep the app working and, with your permission, improve it.
          <a class="cookie-banner__link" href="/policy.html#cookie-policy">Cookie Policy</a>
        </p>
      </div>
      <div class="cookie-banner__actions">
        <button class="cookie-banner__btn cookie-banner__btn--decline" type="button" id="cookieDeclineBtn">
          Essential only
        </button>
        <button class="cookie-banner__btn cookie-banner__btn--accept" type="button" id="cookieAcceptBtn">
          Accept all
        </button>
      </div>
    </div>`;
  return el;
}
