// home-main.js — entry for the landing / script-composer page (index.html).

import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/home.css';

import { initHomeUI } from './features/home/home.ui.js';
import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';
import { loadCrisp } from './utils/load-crisp.js';

document.documentElement.setAttribute('data-theme', 'light');

releasePointerButtonFocus();
initHomeUI();

// Support chat, lazily injected after load + idle so it never competes with the
// page's own JS (incl. the prefetched teleprompter chunk).
loadCrisp();
