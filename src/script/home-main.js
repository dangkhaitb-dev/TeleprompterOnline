// home-main.js — entry for the landing / script-composer page (index.html).

import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/home.css';
import '../styles/pricing.css';

import { initHomeUI } from './features/home/home.ui.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';

document.documentElement.setAttribute('data-theme', 'light');

releasePointerButtonFocus();
initHomeUI();
