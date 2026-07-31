import { incrementSupportVisitCount } from '../../utils/support-visit.js';

export function initSupportUI({ root = document, incrementVisit = incrementSupportVisitCount } = {}) {
  if (root.querySelector('[data-support-widget]') || !root.body) return () => {};
  if (incrementVisit() < 3) return () => {};

  const widget = root.createElement('a');
  widget.className = 'support-widget';
  widget.href = 'https://buy.polar.sh/polar_cl_K1QVdsH7dN9NkF6SEf9yIkviBh1lrUE4grYJf2p9rYn';
  widget.target = '_blank';
  widget.dataset.supportWidget = '';
  widget.setAttribute('aria-label', 'Support SolPrompter');
  widget.setAttribute('rel', 'nofollow noopener noreferrer');

  const icon = root.createElement('span');
  icon.className = 'support-widget__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="white"><path d="M305 151.1L320 171.8L335 151.1C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1L576 231.7C576 343.9 436.1 474.2 363.1 529.9C350.7 539.3 335.5 544 320 544C304.5 544 289.2 539.4 276.9 529.9C203.9 474.2 64 343.9 64 231.7L64 229.1C64 155.6 123.6 96 197.1 96C239.8 96 280 116.5 305 151.1z"/></svg>';
  widget.append(icon);

  const label = root.createElement('span');
  label.textContent = 'Support Me';
  widget.append(label);

  root.body.append(widget);

  const win = root.defaultView || (typeof window !== 'undefined' ? window : null);
  const mediaQuery = win?.matchMedia ? win.matchMedia('(max-width: 399.98px)') : null;

  const updateVisibility = () => {
    const isTeleprompterOpen = root.documentElement.classList.contains('tp-page') ||
      root.body.classList.contains('tp');
    const isSmallScreen = mediaQuery ? mediaQuery.matches : false;

    if (isTeleprompterOpen || isSmallScreen) {
      widget.style.setProperty('display', 'none', 'important');
    } else {
      widget.style.removeProperty('display');
    }
  };

  updateVisibility();

  const observer = new MutationObserver(updateVisibility);
  observer.observe(root.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  observer.observe(root.body, {
    attributes: true,
    attributeFilter: ['class'],
  });

  if (mediaQuery) {
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', updateVisibility);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(updateVisibility);
    }
  }

  return () => {
    observer.disconnect();
    if (mediaQuery) {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', updateVisibility);
      } else if (mediaQuery.removeListener) {
        mediaQuery.removeListener(updateVisibility);
      }
    }
  };
}
