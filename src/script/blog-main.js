import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/home.css';
import '../styles/blog.css';

import { initButtonClickTracking } from './libs/firebase/button-click-analytics.ui.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';

document.documentElement.setAttribute('data-theme', 'light');
initButtonClickTracking();
releasePointerButtonFocus();
