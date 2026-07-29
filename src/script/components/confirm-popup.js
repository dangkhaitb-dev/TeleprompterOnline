// confirm-popup.js — shared confirmation dialog (replaces the banned native
// confirm()). Returns Promise<boolean>. Focus-trapped, Escape = cancel,
// backdrop click = cancel. One-shot: resolves and self-removes. Pages import
// styles/components/confirm-popup.css.
//
// Used by Workspaces and the scene editor. Dark pages get themed via the
// --confirm-* overrides under [data-theme="dark"] in tokens.css.

const TRASH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>';

export function showConfirm({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  icon = TRASH_ICON,
  container = document.body,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="confirm-icon${danger ? ' danger' : ''}" aria-hidden="true">${icon}</div>
        <h2 class="confirm-title" id="confirm-title"></h2>
        <p class="confirm-message"></p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel" type="button" data-analytics-name="confirmCancelClick"></button>
          <button class="confirm-btn confirm-ok${danger ? ' danger' : ''}" type="button" data-analytics-name="confirmOkClick"></button>
        </div>
      </div>`;
    overlay.querySelector('.confirm-title').textContent = title;
    overlay.querySelector('.confirm-message').textContent = message;
    const cancelBtn = overlay.querySelector('.confirm-cancel');
    const okBtn = overlay.querySelector('.confirm-ok');
    cancelBtn.textContent = cancelLabel;
    okBtn.textContent = confirmLabel;

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }
      if (event.key === 'Tab') trapFocus(event, [cancelBtn, okBtn]);
    };

    okBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKey, true);

    container.appendChild(overlay);
    okBtn.focus();
  });
}

function trapFocus(event, focusables) {
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
