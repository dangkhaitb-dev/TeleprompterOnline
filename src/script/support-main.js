import '../styles/features/support.css';

import { initSupportUI } from './features/support/support.ui.js';

// Keep the widget implementation available, but do not show the checkout CTA
// until support is ready to be promoted again.
const SUPPORT_WIDGET_ENABLED = false;

if (SUPPORT_WIDGET_ENABLED) {
  initSupportUI();
}
