import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/home.css';
import '../styles/blog.css';
import '../styles/components/cookie-banner.css';

import { initButtonClickTracking } from './libs/firebase/button-click-analytics.ui.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';
import { initCookieBannerUI } from './features/cookie-banner/cookie-banner.ui.js';
import { listenForConsentAndInitAnalytics } from './libs/firebase/firebase-init.js';

document.documentElement.setAttribute('data-theme', 'light');
initButtonClickTracking();
releasePointerButtonFocus();
listenForConsentAndInitAnalytics();
initCookieBannerUI();
