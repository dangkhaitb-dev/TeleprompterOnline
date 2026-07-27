// notch.ui.js — Notch prompter block (black bar under the MacBook notch) + its
// edit panel. Ported from recorder.js notch sections. Toggling notch requests
// fullscreen (coupled). Text sync copies from the active prompt surface. The
// edit-panel formatting reuses the shared color picker; advanced drag/resize is
// wired for the notch block; the edit panel opens/closes and formats text.

import { enterFullscreen, exitFullscreen, isFullscreen } from '../../../utils/fullscreen.js';
import { getItem, setItem } from '../../../utils/storage.js';
import { LS_TP_NOTCH_SIZE, LS_TP_NOTCH_EDIT_SIZE } from '../../../utils/storage-keys.js';
import { scopedId } from '../../../utils/scoped-query.js';
import { handlePlainTextPaste } from '../../../utils/plain-paste.js';

// Notch block clamp: horizontal grows symmetrically (both edges) so the block
// stays centred under the physical notch; vertical grows downward only.
const NOTCH_MIN_W = 240;
const NOTCH_MIN_H = 60;
const NOTCH_MAX_H = 480;
// Notch edit panel clamp.
const NOTCH_EDIT_MIN_W = 320;
const NOTCH_EDIT_MIN_H = 200;

// Layout belongs to each surface, but these properties must match so the notch
// preview is a faithful rendering of the editor.
const TEXT_STYLE_PROPERTIES = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform',
  'textDecoration', 'color',
];

function copyTextStyles(from, to) {
  if (!from || !to) return;
  const styles = getComputedStyle(from);
  TEXT_STYLE_PROPERTIES.forEach((property) => {
    if (property === 'lineHeight') {
      // getComputedStyle resolves a unitless line-height (for example 1.5) to
      // pixels. Preserve the ratio so later font-size changes keep the editor
      // and preview proportional instead of retaining a stale pixel height.
      const inlineRatio = from.style.lineHeight.trim();
      if (/^(?:\d+|\d*\.\d+)$/.test(inlineRatio)) {
        to.style.lineHeight = inlineRatio;
        return;
      }
      const fontSize = parseFloat(styles.fontSize);
      const lineHeight = parseFloat(styles.lineHeight);
      if (Number.isFinite(fontSize) && fontSize > 0 && Number.isFinite(lineHeight)) {
        to.style.lineHeight = String(Math.round((lineHeight / fontSize) * 1000) / 1000);
        return;
      }
    }
    to.style[property] = styles[property];
  });
}

export function initNotch({
  root = document,
  app,
  getEditSurface,
  onEditChange,
  onToast,
  onActiveChange,
  shouldEnterFullscreen,
  copy,
} = {}) {
  const $ = scopedId(root);
  const notchControl = $('notchControl');
  const notchPrompter = $('notchPrompter');
  const notchScroll = $('notchScroll');
  const notchText = $('notchText');
  const notchEditBtn = $('notchEditBtn');
  const notchEditPanel = $('notchEditPanel');
  const notchEditText = $('notchEditText');
  if (!notchControl || !notchPrompter) return {
    destroy() {},
    deactivate() {},
    isActive: () => false,
    getScroll: () => null,
  };

  const cleanups = [];
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  };

  const isActive = () => app && app.classList.contains('notch-on');

  // Session-only drag position for the notch edit panel (reset to centre on open).
  let notchEditPos = null;
  let fullscreenRequestedByNotch = false;

  const wantsFullscreen = () => (
    typeof shouldEnterFullscreen === 'function' ? shouldEnterFullscreen() : true
  );
  function requestNotchFullscreen() {
    fullscreenRequestedByNotch = !isFullscreen();
    enterFullscreen().catch(() => { fullscreenRequestedByNotch = false; });
  }

  // Preserve the rich markup created by the formatting toolbar. Copying only
  // innerText strips font, size, color, B/I/U and per-run formatting.
  function syncNotchText() {
    const surface = getEditSurface && getEditSurface();
    if (!surface || !notchText) return;
    notchText.innerHTML = surface.innerHTML;
    copyTextStyles(surface, notchText);
  }

  function syncPreviewFromNotchEdit() {
    if (!notchEditText || !notchText) return;
    notchText.innerHTML = notchEditText.innerHTML;
    copyTextStyles(notchEditText, notchText);
  }

  function commitNotchEdit() {
    syncPreviewFromNotchEdit();
    if (typeof onEditChange === 'function') {
      onEditChange({
        html: notchEditText.innerHTML,
        align: notchEditText.style.textAlign || getComputedStyle(notchEditText).textAlign || 'left',
      });
      return;
    }
    const surface = getEditSurface && getEditSurface();
    if (!surface) return;
    surface.innerHTML = notchEditText.innerHTML;
    copyTextStyles(notchEditText, surface);
    // Reuse the page's existing input handler to persist scriptHtml.
    surface.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function closeNotchEdit() {
    if (notchEditPanel) notchEditPanel.classList.remove('show');
    if (notchEditBtn) {
      notchEditBtn.classList.remove('active');
      notchEditBtn.setAttribute('aria-pressed', 'false');
    }
  }

  // Turn off every visual/state flag without changing fullscreen. This is used
  // when the teleprompter view hands control to another in-page screen, such as
  // the post-record scene editor.
  function deactivate() {
    const wasActive = isActive();
    closeNotchEdit();
    notchControl.setAttribute('aria-pressed', 'false');
    notchControl.classList.remove('selected');
    if (app) app.classList.remove('notch-on');
    notchPrompter.classList.remove('show');
    notchPrompter.setAttribute('aria-hidden', 'true');
    if (wasActive && onActiveChange) onActiveChange(false, notchScroll);
  }

  on(notchControl, 'click', () => {
    const active = notchControl.getAttribute('aria-pressed') !== 'true';
    closeNotchEdit();
    if (active && wantsFullscreen()) {
      // Request immediately inside the click gesture for the strongest
      // Fullscreen API compatibility across browsers.
      requestNotchFullscreen();
    } else {
      if (!active && fullscreenRequestedByNotch) exitFullscreen();
      fullscreenRequestedByNotch = false;
    }
    notchControl.setAttribute('aria-pressed', String(active));
    notchControl.classList.toggle('selected', active);
    if (active) syncNotchText();
    if (app) app.classList.toggle('notch-on', active);
    notchPrompter.classList.toggle('show', active);
    notchPrompter.setAttribute('aria-hidden', String(!active));
    if (onActiveChange) onActiveChange(active, notchScroll);
    if (onToast) onToast(active ? (copy && copy.notchOn) : (copy && copy.notchOff));
  });

  // ---- Notch edit panel: open/close + basic text formatting ----------------
  on(notchEditBtn, 'click', () => {
    const open = !notchEditPanel.classList.contains('show');
    if (open) {
      // Always reopen at the centred default: clear any inline position left
      // over from a previous drag/resize (size is kept, only position resets).
      notchEditPanel.style.left = '';
      notchEditPanel.style.top = '';
      notchEditPanel.style.transform = '';
      notchEditPos = null;
    }
    notchEditPanel.classList.toggle('show', open);
    notchEditBtn.classList.toggle('active', open);
    notchEditBtn.setAttribute('aria-pressed', String(open));
    if (open && notchEditText) {
      const surface = getEditSurface && getEditSurface();
      notchEditText.innerHTML = surface ? surface.innerHTML : '';
      if (surface) copyTextStyles(surface, notchEditText);
      syncPreviewFromNotchEdit();
      notchEditText.focus();
    }
  });

  // Formatting is owned by format-toolbar.ui.js, exactly like promptBox and
  // teleprompterText. Notch only owns panel lifecycle and raw text input.
  const editToolbar = $('notchEditToolbar');
  on(notchEditText, 'input', commitNotchEdit);
  // Paste as plain text only — keep spaces/line breaks, drop clipboard HTML.
  on(notchEditText, 'paste', handlePlainTextPaste);

  // ---- Notch block resize (handles: e / w / s / se / sw) -------------------
  // Horizontal edges grow the width symmetrically (dx * 2) so the block keeps
  // centred under the notch; the south edge grows height downward. Size persists.
  function applyNotchSize(width, height) {
    const maxW = Math.max(NOTCH_MIN_W, window.innerWidth - 24);
    const w = Math.round(Math.max(NOTCH_MIN_W, Math.min(width, maxW)));
    const h = Math.round(Math.max(NOTCH_MIN_H, Math.min(height, NOTCH_MAX_H)));
    notchPrompter.style.width = `${w}px`;
    notchPrompter.style.height = `${h}px`;
  }

  notchPrompter.querySelectorAll('[data-notch-resize]').forEach((handle) => {
    const dir = handle.dataset.notchResize;
    let start = null;
    on(handle, 'pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const rect = notchPrompter.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
    });
    on(handle, 'pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      let { width, height } = start;
      if (dir.includes('e')) width = start.width + dx * 2;
      if (dir.includes('w')) width = start.width - dx * 2;
      if (dir.includes('s')) height = start.height + dy;
      applyNotchSize(width, height);
    });
    ['pointerup', 'pointercancel'].forEach((type) => on(handle, type, () => {
      if (!start) return;
      start = null;
      setItem(LS_TP_NOTCH_SIZE, { w: notchPrompter.offsetWidth, h: notchPrompter.offsetHeight });
    }));
  });

  const savedNotchSize = getItem(LS_TP_NOTCH_SIZE);
  if (savedNotchSize && savedNotchSize.w && savedNotchSize.h) applyNotchSize(savedNotchSize.w, savedNotchSize.h);

  // ---- Notch edit panel: free drag (via toolbar) + corner resize -----------
  // Position is session-only (the open handler resets to the centred default);
  // only the size is remembered. Coords are relative to notchPrompter (the
  // nearest position:fixed ancestor), matching the demo.
  function clampNotchEditPos(left, top) {
    const panelRect = notchEditPanel.getBoundingClientRect();
    const parentRect = notchPrompter.getBoundingClientRect();
    const margin = 8;
    const minLeft = margin - parentRect.left;
    const maxLeft = window.innerWidth - margin - parentRect.left - panelRect.width;
    const minTop = margin - parentRect.top;
    const maxTop = window.innerHeight - margin - parentRect.top - panelRect.height;
    return {
      left: Math.min(Math.max(left, minLeft), maxLeft),
      top: Math.min(Math.max(top, minTop), maxTop),
    };
  }

  // Drop the default centring transform once the user places the panel by hand.
  function applyNotchEditPos(pos) {
    notchEditPanel.style.left = `${pos.left}px`;
    notchEditPanel.style.top = `${pos.top}px`;
    notchEditPanel.style.transform = 'none';
  }

  function applyNotchEditSize(width, height) {
    const maxW = Math.max(NOTCH_EDIT_MIN_W, window.innerWidth - 24);
    const maxH = Math.max(NOTCH_EDIT_MIN_H, window.innerHeight - 24);
    const w = Math.round(Math.max(NOTCH_EDIT_MIN_W, Math.min(width, maxW)));
    const h = Math.round(Math.max(NOTCH_EDIT_MIN_H, Math.min(height, maxH)));
    notchEditPanel.style.width = `${w}px`;
    notchEditPanel.style.height = `${h}px`;
    return { w, h };
  }

  if (notchEditPanel && editToolbar) {
    // Drag: grab empty toolbar space (not a select/button) to move the panel.
    let dragStart = null;
    on(editToolbar, 'pointerdown', (e) => {
      if (e.target.closest('select, button')) return;
      e.preventDefault();
      editToolbar.setPointerCapture(e.pointerId);
      const panelRect = notchEditPanel.getBoundingClientRect();
      const parentRect = notchPrompter.getBoundingClientRect();
      dragStart = { x: e.clientX, y: e.clientY, left: panelRect.left - parentRect.left, top: panelRect.top - parentRect.top };
      notchEditPanel.classList.add('dragging');
      editToolbar.classList.add('dragging');
    });
    on(editToolbar, 'pointermove', (e) => {
      if (!dragStart) return;
      notchEditPos = clampNotchEditPos(dragStart.left + (e.clientX - dragStart.x), dragStart.top + (e.clientY - dragStart.y));
      applyNotchEditPos(notchEditPos);
    });
    ['pointerup', 'pointercancel'].forEach((type) => on(editToolbar, type, () => {
      if (!dragStart) return;
      dragStart = null;
      notchEditPanel.classList.remove('dragging');
      editToolbar.classList.remove('dragging');
    }));

    // Resize from the 4 corners. The n/w corners move left/top so the opposite
    // edge stays put; clamped deltas are reconciled against the applied size.
    notchEditPanel.querySelectorAll('[data-notch-edit-resize]').forEach((handle) => {
      const dir = handle.dataset.notchEditResize;
      let start = null;
      on(handle, 'pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        const panelRect = notchEditPanel.getBoundingClientRect();
        const parentRect = notchPrompter.getBoundingClientRect();
        start = {
          x: e.clientX, y: e.clientY,
          left: panelRect.left - parentRect.left, top: panelRect.top - parentRect.top,
          width: panelRect.width, height: panelRect.height,
        };
        notchEditPanel.classList.add('dragging');
      });
      on(handle, 'pointermove', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        let width = start.width;
        let height = start.height;
        if (dir.includes('e')) width = start.width + dx;
        if (dir.includes('w')) width = start.width - dx;
        if (dir.includes('s')) height = start.height + dy;
        if (dir.includes('n')) height = start.height - dy;
        const applied = applyNotchEditSize(width, height);
        let left = start.left;
        let top = start.top;
        if (dir.includes('w')) left = start.left + (start.width - applied.w);
        if (dir.includes('n')) top = start.top + (start.height - applied.h);
        notchEditPos = clampNotchEditPos(left, top);
        applyNotchEditPos(notchEditPos);
      });
      ['pointerup', 'pointercancel'].forEach((type) => on(handle, type, () => {
        if (!start) return;
        start = null;
        notchEditPanel.classList.remove('dragging');
        setItem(LS_TP_NOTCH_EDIT_SIZE, { w: notchEditPanel.offsetWidth, h: notchEditPanel.offsetHeight });
      }));
    });

    const savedEditSize = getItem(LS_TP_NOTCH_EDIT_SIZE);
    if (savedEditSize && savedEditSize.w && savedEditSize.h) applyNotchEditSize(savedEditSize.w, savedEditSize.h);
  }

  return {
    isActive,
    getScroll: () => notchScroll,
    syncNotchText,
    // Refresh the notch preview straight from the edit panel (notchEditText).
    // Used after a toolbar format, when the main surfaces are stale/dirty.
    syncPreview: syncPreviewFromNotchEdit,
    closeNotchEdit,
    deactivate,
    destroy() { cleanups.forEach((fn) => fn()); closeNotchEdit(); },
  };
}
