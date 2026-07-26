import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/home.css';
import '../styles/blog.css';
import '../styles/blog-article.css';

import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';
import { loadCrisp } from './utils/load-crisp.js';

document.documentElement.setAttribute('data-theme', 'light');
releasePointerButtonFocus();

// Support chat, lazily injected after load + idle.
loadCrisp();
