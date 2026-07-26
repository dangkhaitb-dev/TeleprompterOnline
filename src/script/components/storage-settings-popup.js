// storage-settings-popup.js — a small dialog for the local recording storage:
// a master on/off switch plus a numeric "max local storage" field (in GB). All
// data lives on the user's device; the copy makes that explicit. Focus-trapped.
// Auto-saves: every toggle/limit change fires onChange immediately (and is also
// committed once on close), so there is no explicit Save/Cancel — Escape, the
// backdrop, or Enter simply dismiss. Pages import the matching CSS.

export function showStorageSettings({
  title = 'Local storage',
  intro = '',
  toggleLabel = 'Save recordings on this device',
  toggleHint = '',
  limitLabel = 'Max local storage',
  limitHint = '',
  unit = 'GB',
  value = 2,
  min = 0.5,
  max = 2,
  step = 0.5,
  saveEnabled = true,
  onChange = null,
  container = document.body,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prompt-overlay stgs-overlay';
    overlay.innerHTML = `
      <div class="prompt-box stgs-box" role="dialog" aria-modal="true" aria-labelledby="stgs-title">
        <h2 class="prompt-title" id="stgs-title"></h2>
        <p class="stgs-intro"></p>
        <label class="stgs-toggle">
          <span class="stgs-toggle-text">
            <span class="stgs-toggle-title"></span>
            <span class="stgs-toggle-hint"></span>
          </span>
          <input type="checkbox" class="stgs-switch" role="switch">
        </label>
        <div class="stgs-limit">
          <label class="stgs-limit-label" for="stgs-input"></label>
          <div class="stgs-field">
            <input class="stgs-input" id="stgs-input" type="number" inputmode="decimal" autocomplete="off">
            <span class="stgs-unit"></span>
          </div>
          <p class="stgs-limit-hint"></p>
        </div>
      </div>`;

    const $ = (sel) => overlay.querySelector(sel);
    $('.prompt-title').textContent = title;
    const introEl = $('.stgs-intro');
    introEl.textContent = intro;
    introEl.hidden = !intro;
    $('.stgs-toggle-title').textContent = toggleLabel;
    const toggleHintEl = $('.stgs-toggle-hint');
    toggleHintEl.textContent = toggleHint;
    toggleHintEl.hidden = !toggleHint;
    $('.stgs-limit-label').textContent = limitLabel;
    const limitHintEl = $('.stgs-limit-hint');
    limitHintEl.textContent = limitHint;
    limitHintEl.hidden = !limitHint;
    $('.stgs-unit').textContent = unit;

    const toggle = $('.stgs-switch');
    const input = $('.stgs-input');
    const limitRow = $('.stgs-limit');
    toggle.checked = saveEnabled;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    // The limit only matters while saving is on — dim it when the switch is off.
    const syncEnabled = () => {
      const on = toggle.checked;
      limitRow.classList.toggle('is-disabled', !on);
      input.disabled = !on;
    };

    // Current form values, with the GB field parsed and clamped into range.
    const readValues = () => {
      const parsed = Number(String(input.value).replace(',', '.'));
      const gb = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.max(parsed, min), max) : value;
      return { saveEnabled: toggle.checked, limitGB: gb };
    };
    // Auto-save: push the live values to the caller on every change.
    const apply = () => {
      if (typeof onChange === 'function') onChange(readValues());
    };

    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      // Commit once more so a value typed but not yet blurred isn't lost.
      apply();
      overlay.remove();
      resolve(readValues());
    };
    const onKey = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        trapFocus(event, [toggle, input].filter((el) => !el.disabled));
      }
    };

    toggle.addEventListener('change', () => {
      syncEnabled();
      apply();
    });
    input.addEventListener('change', apply);
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey, true);

    container.appendChild(overlay);
    syncEnabled();
    setTimeout(() => toggle.focus(), 20);
  });
}

function trapFocus(event, focusables) {
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
