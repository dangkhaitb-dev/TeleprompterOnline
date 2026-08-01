// home-main.js — entry for the landing / script-composer page (index.html).

import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/home.css';
import '../styles/pricing.css';
import '../styles/components/cookie-banner.css';

import { initHomeUI } from './features/home/home.ui.js';
import { initButtonClickTracking } from './libs/firebase/button-click-analytics.ui.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';
import { initCookieBannerUI } from './features/cookie-banner/cookie-banner.ui.js';
import { listenForConsentAndInitAnalytics } from './libs/firebase/firebase-init.js';

document.documentElement.setAttribute('data-theme', 'light');

initButtonClickTracking();
releasePointerButtonFocus();
listenForConsentAndInitAnalytics();
initCookieBannerUI();
initHomeUI();
