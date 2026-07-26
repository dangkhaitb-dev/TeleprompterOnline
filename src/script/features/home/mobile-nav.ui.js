// mobile-nav.ui.js — header hamburger + slide-in drawer for the landing page.
// Mobile only: the toggle, drawer and scrim are display:none on desktop (CSS).
// UI layer — this module only touches the DOM.

export function initMobileNav() {
  const toggle = document.getElementById('navToggle');
  const panel = document.getElementById('mobileNav');
  const scrim = document.getElementById('mobileNavScrim');
  const closeBtn = document.getElementById('mobileNavClose');
  if (!toggle || !panel || !scrim) return;

  let isOpen = false;

  const setOpen = (next) => {
    isOpen = next;
    panel.classList.toggle('is-open', next);
    scrim.classList.toggle('is-open', next);
    toggle.setAttribute('aria-expanded', String(next));
    document.body.classList.toggle('nav-open', next);
    if (next) {
      (closeBtn || panel.querySelector('a, button'))?.focus();
    } else {
      toggle.focus();
    }
  };

  toggle.addEventListener('click', () => setOpen(!isOpen));
  scrim.addEventListener('click', () => setOpen(false));
  if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));

  // Tapping any link closes the drawer (in-page anchors and navigations alike).
  panel.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen) setOpen(false);
  });
}
