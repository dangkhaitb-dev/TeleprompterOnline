// toast.js — shared toast pill (dark, --z-toast). One reused element per page;
// showToast(message) flashes it with a timed `.is-visible` class. No feature
// styling lives here — pages import styles/components/toast.css.
//
// Used by Workspaces. TODO(dedupe): migrate the home / teleprompter (position:
// absolute, cam-on offset) / scene-editor (in-flux) per-feature toasts to this
// once those surfaces can be re-verified — do not add a 4th copy.

const TOAST_DURATION_MS = 2400;

let toastEl = null;
let hideTimer = null;

function ensureToast() {
  if (toastEl && toastEl.isConnected) return toastEl;
  toastEl = document.createElement('div');
  toastEl.className = 'app-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastEl);
  return toastEl;
}

export function showToast(message, { duration = TOAST_DURATION_MS, variant } = {}) {
  if (!message) return;
  const el = ensureToast();
  const isError = variant === 'error';
  // Errors interrupt (assertive alert); normal toasts are polite status.
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  el.classList.toggle('is-error', isError);
  el.textContent = message;
  // Force reflow so re-triggering restarts the enter transition.
  void el.offsetWidth;
  el.classList.add('is-visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('is-visible'), duration);
}
