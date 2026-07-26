// export-menu.ui.js — one adaptive export button: one recording downloads the
// original blob; multiple recordings start ZIP packaging.

import { ICON_EXPORT } from './icons.js';

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
      ${ICON_EXPORT}<span data-role="export-label">${labels.export || 'Export'}</span>
    </button>`;

  const button = wrap.querySelector('[data-role="export"]');
  const label = wrap.querySelector('[data-role="export-label"]');
  button.addEventListener('click', () => {
    if (button.disabled) return;
    const intent = getIntent();
    if (intent === 'none') { onEmpty?.(); return; }
    if (intent === 'direct') { onDirect?.(); return; }
    onArchive?.();
  }, { signal });

  return {
    el: wrap,
    // Reflect export-in-progress: disable button + swap label.
    setBusy(busy, busyLabel) {
      button.disabled = busy;
      label.textContent = busy ? busyLabel : (labels.export || 'Export');
    },
  };
}
