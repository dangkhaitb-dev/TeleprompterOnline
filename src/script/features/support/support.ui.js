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
  icon.textContent = '♥';
  widget.append(icon);

  const label = root.createElement('span');
  label.textContent = 'Support Me';
  widget.append(label);

  root.body.append(widget);

  const updateVisibility = () => {
    const isTeleprompterOpen = root.documentElement.classList.contains('tp-page') ||
      root.body.classList.contains('tp');

    if (isTeleprompterOpen) {
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

  return () => observer.disconnect();
}
