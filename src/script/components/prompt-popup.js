// prompt-popup.js — shared single-field text dialog (replaces the banned native
// prompt()). Resolves Promise<string> with the trimmed value, or null on
// cancel. Focus-trapped, Escape/backdrop = cancel, Enter = submit. One-shot.
// Pages import styles/components/prompt-popup.css.

export function showPrompt({
  title = '',
  value = '',
  placeholder = '',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  container = document.body,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prompt-overlay';
    overlay.innerHTML = `
      <div class="prompt-box" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <h2 class="prompt-title" id="prompt-title"></h2>
        <input class="prompt-input" type="text" spellcheck="false" autocomplete="off">
        <div class="prompt-actions">
          <button class="prompt-btn prompt-cancel" type="button"></button>
          <button class="prompt-btn prompt-ok" type="button"></button>
        </div>
      </div>`;
    overlay.querySelector('.prompt-title').textContent = title;
    const input = overlay.querySelector('.prompt-input');
    input.value = value;
    input.placeholder = placeholder;
    const cancelBtn = overlay.querySelector('.prompt-cancel');
    const okBtn = overlay.querySelector('.prompt-ok');
    cancelBtn.textContent = cancelLabel;
    okBtn.textContent = confirmLabel;

    // Keep the dialog inside the visible area when the mobile keyboard opens.
    // A fixed/centered overlay stays centred in the *layout* viewport, so the
    // keyboard hides its lower half (including the confirm button). Pin the
    // overlay to the visual viewport so it re-centres above the keyboard.
    const vv = window.visualViewport;
    const syncViewport = () => {
      if (!vv) return;
      overlay.style.top = `${vv.offsetTop}px`;
      overlay.style.height = `${vv.height}px`;
      overlay.style.bottom = 'auto';
    };

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      if (vv) {
        vv.removeEventListener('resize', syncViewport);
        vv.removeEventListener('scroll', syncViewport);
      }
      overlay.remove();
      resolve(result);
    };
    const submit = () => {
      const trimmed = input.value.trim();
      if (!trimmed) {
        input.focus();
        return;
      }
      close(trimmed);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Tab') {
        trapFocus(event, [input, cancelBtn, okBtn]);
      }
    };

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey, true);
    if (vv) {
      vv.addEventListener('resize', syncViewport);
      vv.addEventListener('scroll', syncViewport);
    }

    container.appendChild(overlay);
    syncViewport();
    setTimeout(() => {
      input.focus();
      input.select();
      syncViewport();
    }, 20);
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
