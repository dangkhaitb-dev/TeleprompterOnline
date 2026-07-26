// language-switcher.ui.js — dismiss the <details> language menu on outside
// click or Escape. The <details>/<summary> markup already owns open/toggle and
// keyboard focus; this only adds the "click-away closes it" behaviour that a
// native <details> lacks, plus closing the other instance so the desktop and
// drawer menus never stay open at once.

export function initLanguageSwitcher() {
  const switchers = Array.from(document.querySelectorAll('.lang-switcher'));
  if (!switchers.length) return;

  switchers.forEach((el) => {
    el.addEventListener('toggle', () => {
      if (!el.open) return;
      switchers.forEach((other) => {
        if (other !== el) other.open = false;
      });
    });
  });

  document.addEventListener('click', (event) => {
    switchers.forEach((el) => {
      if (el.open && !el.contains(event.target)) el.open = false;
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    switchers.forEach((el) => {
      if (!el.open) return;
      el.open = false;
      const summary = el.querySelector('summary');
      if (summary) summary.focus();
    });
  });
}
