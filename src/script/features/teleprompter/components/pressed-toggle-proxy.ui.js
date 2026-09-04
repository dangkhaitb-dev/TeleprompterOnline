// A settings switch that mirrors an `aria-pressed` toggle button living
// elsewhere (phone: Mirror / Layout moved into Settings while the real buttons
// keep their existing click handlers). Checked state follows the button, and
// flipping the switch clicks the button.
export function bindPressedToggleProxy({ checkbox, button } = {}) {
  if (!checkbox || !button) return () => {};

  const sync = () => {
    checkbox.checked = button.getAttribute('aria-pressed') === 'true';
  };
  const handleChange = () => {
    if (checkbox.checked === (button.getAttribute('aria-pressed') === 'true')) return;
    button.click();
    sync();
  };

  sync();
  checkbox.addEventListener('change', handleChange);
  const observer = new MutationObserver(sync);
  observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] });

  return () => {
    checkbox.removeEventListener('change', handleChange);
    observer.disconnect();
  };
}
