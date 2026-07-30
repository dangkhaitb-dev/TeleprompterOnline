// toast.js — shared toast pill (dark, --z-toast). One reused element per page;
// showToast(message) supports timed notices and persistent dismissible alerts.
// No feature styling lives here — pages import styles/components/toast.css.
//
// Used by Workspaces. TODO(dedupe): migrate the home / teleprompter (position:
// absolute, cam-on offset) / scene-editor (in-flux) per-feature toasts to this
// once those surfaces can be re-verified — do not add a 4th copy.

const TOAST_DURATION_MS = 2400;

let toastEl = null;
let hideTimer = null;

export function hideToast() {
  clearTimeout(hideTimer);
  hideTimer = null;
  if (!toastEl) return;
  if (toastEl.contains(document.activeElement)) document.activeElement.blur();
  toastEl.classList.remove('is-visible');
}

function ensureToast() {
  if (toastEl && toastEl.isConnected) return toastEl;
  toastEl = document.createElement('div');
  toastEl.className = 'app-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');

  const content = document.createElement('span');
  content.className = 'app-toast__content';
  toastEl.appendChild(content);

  const title = document.createElement('strong');
  title.className = 'app-toast__title';
  title.hidden = true;
  content.appendChild(title);

  const message = document.createElement('span');
  message.className = 'app-toast__message';
  content.appendChild(message);

  const dismiss = document.createElement('button');
  dismiss.className = 'app-toast__dismiss';
  dismiss.type = 'button';
  dismiss.hidden = true;
  dismiss.setAttribute('aria-label', 'Dismiss notification');
  const dismissIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dismissIcon.setAttribute('viewBox', '0 0 24 24');
  dismissIcon.setAttribute('aria-hidden', 'true');
  const dismissPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  dismissPath.setAttribute('d', 'M5 5l14 14M19 5 5 19');
  dismissPath.setAttribute('fill', 'none');
  dismissPath.setAttribute('stroke', 'currentColor');
  dismissPath.setAttribute('stroke-width', '2.25');
  dismissPath.setAttribute('stroke-linecap', 'round');
  dismissIcon.appendChild(dismissPath);
  dismiss.appendChild(dismissIcon);
  dismiss.addEventListener('click', hideToast);
  toastEl.appendChild(dismiss);

  document.body.appendChild(toastEl);
  return toastEl;
}

export function showToast(message, {
  duration = TOAST_DURATION_MS,
  variant,
  dismissible = false,
  title = '',
} = {}) {
  if (!message) return;
  const el = ensureToast();
  const isError = variant === 'error';
  const isWarning = variant === 'warning';
  const isAlert = isError || isWarning;
  // Errors and warnings interrupt (assertive alert); normal toasts are polite status.
  el.setAttribute('role', isAlert ? 'alert' : 'status');
  el.setAttribute('aria-live', isAlert ? 'assertive' : 'polite');
  el.classList.toggle('is-error', isError);
  el.classList.toggle('is-warning', isWarning);
  el.classList.toggle('is-dismissible', dismissible);
  const titleEl = el.querySelector('.app-toast__title');
  titleEl.textContent = title;
  titleEl.hidden = !title;
  el.querySelector('.app-toast__message').textContent = message;
  el.querySelector('.app-toast__dismiss').hidden = !dismissible;
  // Force reflow so re-triggering restarts the enter transition.
  void el.offsetWidth;
  el.classList.add('is-visible');
  clearTimeout(hideTimer);
  hideTimer = null;
  if (duration !== null) hideTimer = setTimeout(hideToast, duration);
}
