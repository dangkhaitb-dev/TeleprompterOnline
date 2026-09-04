// export-menu.ui.js — one adaptive export button: one recording downloads the
// original blob; multiple recordings start ZIP packaging.

import { ICON_EXPORT } from './icons.js';

// A direct download finishes almost instantly, so the busy state would flash
// for a few ms and the user gets no confirmation that anything happened. Hold
// the spinner for at least this long after a click.
export const EXPORT_BUSY_MIN_MS = 1500;

// getIntent() → 'none' | 'direct' | 'archive'.
export function createExportMenu({
  signal,
  labels = {},
  getIntent,
  onDirect,
  onArchive,
  onEmpty,
}) {
  const wrap = document.createElement('div');
  wrap.className = 'se-export-wrap';
  wrap.innerHTML = `
    <button class="se-export-button" type="button" data-role="export">
      ${ICON_EXPORT}<span class="se-export-spinner" data-role="export-spinner" aria-hidden="true" hidden></span><span data-role="export-label">${labels.export || 'Export'}</span>
    </button>`;

  const button = wrap.querySelector('[data-role="export"]');
  const spinner = wrap.querySelector('[data-role="export-spinner"]');
  const label = wrap.querySelector('[data-role="export-label"]');
  const idleLabel = () => labels.export || 'Export';
  let busySince = 0;
  let releaseTimer = null;

  const applyBusy = (busy, busyLabel) => {
    button.disabled = busy;
    button.classList.toggle('is-loading', busy);
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    spinner.hidden = !busy;
    label.textContent = busy ? busyLabel : idleLabel();
  };

  button.addEventListener('click', () => {
    if (button.disabled) return;
    const intent = getIntent();
    if (intent === 'none') { onEmpty?.(); return; }
    if (intent === 'direct') { onDirect?.(); return; }
    onArchive?.();
  }, { signal });

  signal?.addEventListener('abort', () => clearTimeout(releaseTimer), { once: true });

  return {
    el: wrap,
    // Reflect export-in-progress: disable button, show spinner, swap label.
    // Leaving the busy state is deferred until EXPORT_BUSY_MIN_MS has elapsed
    // since it was entered, so quick exports still show visible feedback.
    setBusy(busy, busyLabel) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
      if (busy) {
        busySince = Date.now();
        applyBusy(true, busyLabel || idleLabel());
        return;
      }
      const remaining = EXPORT_BUSY_MIN_MS - (Date.now() - busySince);
      if (remaining <= 0) { applyBusy(false); return; }
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        applyBusy(false);
      }, remaining);
    },
  };
}
