import '../styles/reset.css';
import '../styles/tokens.css';
import '../styles/home.css';
import '../styles/blog.css';
import '../styles/blog-article.css';

import { releasePointerButtonFocus } from './utils/release-pointer-button-focus.js';

document.documentElement.setAttribute('data-theme', 'light');
releasePointerButtonFocus();
