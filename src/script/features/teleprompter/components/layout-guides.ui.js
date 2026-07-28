// layout-guides.ui.js — margin handles (symmetric text padding) + eye-line
// drag/toggle, and the peek behavior. Ported from recorder.js layout section.
// The frame always tracks the active text surface; guides are shown via peek or
// the mobile Layout toggle (class handled in settings-theme + CSS).

import { scopedId } from '../../../utils/scoped-query.js';

export function initLayoutGuides({
  root = document,
  app,
  promptBox,
  teleprompterText,
  prompterPanel,
  initial = {},
  onChange,
} = {}) {
  const $ = scopedId(root);
  const stage = root.querySelector('.stage');
  const layoutFrame = $('layoutFrame');
  const layoutEyeLine = $('layoutEyeLine');
  if (!stage || !layoutFrame) return { update() {}, destroy() {} };

  const handleLeft = layoutFrame.querySelector('.layout-handle.left');
  const handleRight = layoutFrame.querySelector('.layout-handle.right');
  let eyeLineRatio = Number.isFinite(initial.eyeLineRatio) ? initial.eyeLineRatio : 0.25;
  const marginRatios = {
    promptMarginRatio: initial.promptMarginRatio ?? null,
    panelMarginRatio: initial.panelMarginRatio ?? null,
  };
  let layoutEditing = true;

  const cleanups = [];
  const on = (el, type, fn, opts) => {
    if (!el) return;
    el.addEventListener(type, fn, opts);
    cleanups.push(() => el.removeEventListener(type, fn, opts));
  };

  const camOn = () => app && app.classList.contains('cam-on');
  const layoutTarget = () => (camOn() ? prompterPanel : promptBox);
  const layoutTextSurface = () => (camOn() ? teleprompterText : promptBox);
  const activeMarginKey = () => (camOn() ? 'panelMarginRatio' : 'promptMarginRatio');
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };

  if (layoutEyeLine) layoutEyeLine.classList.toggle('eye-hidden', initial.eyeLineVisible === false);

  // Returns the pad it applied (or null when no stored ratio) so callers can
  // hand it straight to positionSideHandles instead of reading computed style
  // back — a write→read cycle that forces a style recalc per call.
  function applyStoredMargin() {
    const surface = layoutTextSurface();
    if (!surface) return null;
    const ratio = marginRatios[activeMarginKey()];
    if (ratio === null || ratio === undefined) return null;
    const width = surface.clientWidth;
    if (!width) return null;
    const minTextWidth = Math.min(220, width - 32);
    const maxPad = Math.max(16, (width - minTextWidth) / 2);
    const pad = Math.round(Math.max(16, Math.min(width * ratio, maxPad)));
    surface.style.paddingLeft = `${pad}px`;
    surface.style.paddingRight = `${pad}px`;
    return pad;
  }

  // Prefer a jump over the slide when the user asks for reduced motion.
  const prefersReducedMotion = () =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Padding-top that seats the first script line on the eye-line. During record
  // the cam-off stage overflows the header (top:0), so measure the promptBox
  // against app height, matching the demo. The notch has no eye-line.
  function eyeLineStartPadding(surface, recording) {
    if (!surface) return 0;
    // Notch is a compact viewport without an eye-line. Preserve its CSS top
    // padding instead of applying the main-stage eyeLineRatio to its height.
    if (surface !== promptBox && surface !== teleprompterText) {
      return parseFloat(getComputedStyle(surface).paddingTop) || 0;
    }
    if (surface === teleprompterText) {
      return Math.max(0, Math.round(prompterPanel.clientHeight * eyeLineRatio - surface.offsetTop));
    }
    if (recording && surface === promptBox) {
      return Math.round(app.clientHeight * eyeLineRatio);
    }
    return Math.round(surface.clientHeight * eyeLineRatio);
  }

  function positionSideHandles(pad = null) {
    const surface = layoutTextSurface();
    if (!surface) return;
    let padLeft = pad;
    let padRight = pad;
    if (pad == null) {
      const styles = getComputedStyle(surface);
      padLeft = parseFloat(styles.paddingLeft) || 0;
      padRight = parseFloat(styles.paddingRight) || 0;
    }
    // Keep each 24px drag control entirely outside the editable content. The
    // inner edge still marks the exact text boundary without covering text.
    if (handleLeft) handleLeft.style.left = `${padLeft - 24}px`;
    if (handleRight) handleRight.style.right = `${padRight - 24}px`;
  }

  function updateEyeLine() {
    if (layoutEyeLine) layoutEyeLine.style.top = `${eyeLineRatio * 100}%`;
  }

  function update() {
    if (!layoutEditing) return;
    const target = layoutTarget();
    if (target === prompterPanel && layoutFrame.parentNode === prompterPanel) {
      layoutFrame.style.left = '0px';
      layoutFrame.style.top = '0px';
      layoutFrame.style.width = '100%';
      layoutFrame.style.height = '100%';
      layoutFrame.classList.add('show');
      positionSideHandles(applyStoredMargin());
      updateEyeLine();
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const targetRect = target === promptBox ? stageRect : (target && target.getBoundingClientRect());
    if (!targetRect || !targetRect.width || !targetRect.height) {
      layoutFrame.classList.remove('show');
      return;
    }
    layoutFrame.style.left = `${targetRect.left - stageRect.left}px`;
    layoutFrame.style.top = `${targetRect.top - stageRect.top}px`;
    layoutFrame.style.width = `${targetRect.width}px`;
    layoutFrame.style.height = `${targetRect.height}px`;
    layoutFrame.classList.add('show');
    positionSideHandles(applyStoredMargin());
    updateEyeLine();
  }

  // ---- Margin handle drag (symmetric padding) ------------------------------
  layoutFrame.querySelectorAll('[data-layout-edge]').forEach((handle) => {
    let drag = null;
    on(handle, 'pointerdown', (event) => {
      event.preventDefault();
      const frameRect = layoutFrame.getBoundingClientRect();
      if (!frameRect.width) return;
      drag = {
        edge: handle.dataset.layoutEdge,
        left: frameRect.left,
        right: frameRect.right,
        width: frameRect.width,
        marginKey: activeMarginKey(),
        ratio: null,
      };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
    });
    // Writing the padding re-wraps the whole script text — coalesce to one
    // relayout per frame instead of one per pointer event (60–120 Hz).
    let marginRaf = 0;
    let marginClientX = null;
    const applyMarginFromPointer = () => {
      marginRaf = 0;
      if (!drag || marginClientX == null) return;
      const minTextWidth = Math.min(220, drag.width - 32);
      const maxPad = Math.max(16, (drag.width - minTextWidth) / 2);
      const requested = drag.edge === 'left' ? marginClientX - drag.left : drag.right - marginClientX;
      const pad = Math.round(Math.max(16, Math.min(requested, maxPad)));
      marginClientX = null;
      const surface = layoutTextSurface();
      if (surface) {
        surface.style.paddingLeft = `${pad}px`;
        surface.style.paddingRight = `${pad}px`;
      }
      drag.ratio = pad / drag.width;
      positionSideHandles(pad);
    };
    on(handle, 'pointermove', (event) => {
      if (!drag) return;
      marginClientX = event.clientX;
      if (!marginRaf) marginRaf = requestAnimationFrame(applyMarginFromPointer);
    });
    ['pointerup', 'pointercancel'].forEach((type) => on(handle, type, () => {
      if (drag && type === 'pointerup' && drag.ratio !== null) {
        marginRatios[drag.marginKey] = drag.ratio;
        emit({ [drag.marginKey]: drag.ratio });
      }
      drag = null;
      handle.classList.remove('is-dragging');
    }));
  });

  // ---- Eye-line drag / click-to-toggle -------------------------------------
  let eyeDrag = null;
  on(layoutEyeLine, 'pointerdown', (event) => {
    event.preventDefault();
    const frameRect = layoutFrame.getBoundingClientRect();
    if (!frameRect.height) return;
    eyeDrag = { top: frameRect.top, height: frameRect.height, startY: event.clientY, moved: false };
    layoutEyeLine.setPointerCapture(event.pointerId);
  });
  on(layoutEyeLine, 'pointermove', (event) => {
    if (!eyeDrag) return;
    if (!eyeDrag.moved && Math.abs(event.clientY - eyeDrag.startY) <= 4) return;
    eyeDrag.moved = true;
    const ratio = (event.clientY - eyeDrag.top) / eyeDrag.height;
    eyeLineRatio = Math.max(0.05, Math.min(0.95, ratio));
    updateEyeLine();
  });
  on(layoutEyeLine, 'pointerup', () => {
    if (eyeDrag && !eyeDrag.moved) {
      const hidden = layoutEyeLine.classList.toggle('eye-hidden');
      emit({ eyeLineVisible: !hidden });
    } else if (eyeDrag && eyeDrag.moved) {
      emit({ eyeLineRatio });
    }
    eyeDrag = null;
  });
  on(layoutEyeLine, 'pointercancel', () => { eyeDrag = null; });

  // ---- Peek: show guides when the cursor is in the margin band -------------
  // Throttled to one rect+computed-style read per frame — this handler runs on
  // every mouse move over the stage for the whole editing session.
  let peekRaf = 0;
  let peekPoint = null;
  const clearPeek = () => {
    if (peekRaf) { cancelAnimationFrame(peekRaf); peekRaf = 0; }
    peekPoint = null;
    if (!app) return;
    app.classList.remove('guides-peek');
    app.classList.remove('over-text');
  };
  const runPeek = () => {
    peekRaf = 0;
    const point = peekPoint;
    peekPoint = null;
    if (!app || !point) return;
    if (!layoutEditing || app.classList.contains('record-dim') || app.classList.contains('notch-on')) {
      clearPeek();
      return;
    }
    const frame = layoutFrame.getBoundingClientRect();
    if (!frame.width || !frame.height) { clearPeek(); return; }
    const { x, y } = point;
    const inFrame = x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom;
    if (!inFrame) { clearPeek(); return; }
    const styles = getComputedStyle(layoutTextSurface());
    const padLeft = parseFloat(styles.paddingLeft) || 0;
    const padRight = parseFloat(styles.paddingRight) || 0;
    const inMargin = x < frame.left + padLeft || x > frame.right - padRight;
    app.classList.toggle('guides-peek', inMargin);
    app.classList.toggle('over-text', !inMargin);
  };
  const updatePeek = (event) => {
    peekPoint = { x: event.clientX, y: event.clientY };
    if (!peekRaf) peekRaf = requestAnimationFrame(runPeek);
  };
  on(stage, 'pointermove', updatePeek);
  on(stage, 'pointerleave', clearPeek);
  cleanups.push(() => {
    if (peekRaf) cancelAnimationFrame(peekRaf);
  });

  [promptBox, teleprompterText].forEach((surface) => {
    on(surface, 'blur', () => requestAnimationFrame(update));
  });

  const onResize = () => requestAnimationFrame(update);
  window.addEventListener('resize', onResize);
  cleanups.push(() => window.removeEventListener('resize', onResize));

  // ---- Center-on-record easing ---------------------------------------------
  // On record start the first script line slides down to the eye-line: seat it
  // at the eye-line via padding-top, jump the scroll up by that amount so the
  // line starts at the very top, then ease the scroll back to 0 (easeOutCubic,
  // matching the demo) so the line glides down onto the eye-line. The notch has
  // no eye-line, so centering is a no-op there.
  const CENTER_DURATION_MS = 700;
  let centering = false;
  let centerRaf = null;
  let scrollBeforeCenter = 0;

  const isNotch = (surface) => surface && surface !== promptBox && surface !== teleprompterText;
  const isCentering = () => centering;

  function stopCenterRaf() {
    centering = false;
    if (centerRaf != null) { cancelAnimationFrame(centerRaf); centerRaf = null; }
  }

  // Seat the first line at the eye-line and return the scroll offset that puts
  // it at the very top (the start of the slide). Callers own padding-bottom.
  function seatAtEyeLine(surface) {
    const prevScrollTop = surface.scrollTop;
    const prevPaddingTop = parseFloat(getComputedStyle(surface).paddingTop) || 0;
    const nextPaddingTop = eyeLineStartPadding(surface, true);
    surface.style.paddingTop = `${nextPaddingTop}px`;
    const addedTop = nextPaddingTop - prevPaddingTop;
    surface.scrollTop = prevScrollTop + addedTop;
    return surface.scrollTop;
  }

  function centerOnRecord(surface, onDone, { animate = true } = {}) {
    stopCenterRaf();
    const done = () => { if (typeof onDone === 'function') onDone(); };
    if (!surface || isNotch(surface)) { done(); return; }
    scrollBeforeCenter = surface.scrollTop;
    const startTop = seatAtEyeLine(surface);
    if (!animate || startTop <= 0 || prefersReducedMotion()) {
      surface.scrollTop = 0;
      done();
      return;
    }
    centering = true;
    let startTime = 0;
    const step = (timestamp) => {
      if (!centering) return;
      if (!startTime) startTime = timestamp;
      const t = Math.min(1, (timestamp - startTime) / CENTER_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      surface.scrollTop = Math.round(startTop * (1 - eased));
      if (t < 1) {
        centerRaf = requestAnimationFrame(step);
      } else {
        centerRaf = null;
        centering = false;
        done();
      }
    };
    centerRaf = requestAnimationFrame(step);
  }

  // Undo centering: clear padding-top and return the scroll to where it was.
  function restore(surface) {
    stopCenterRaf();
    if (!surface) return;
    surface.style.paddingTop = '';
    surface.style.paddingBottom = '';
    surface.scrollTop = scrollBeforeCenter;
  }

  cleanups.push(stopCenterRaf);

  layoutFrame.classList.add('show');
  requestAnimationFrame(update);

  return {
    update,
    setEditing(enabled) { layoutEditing = enabled; layoutFrame.classList.toggle('show', enabled); if (enabled) requestAnimationFrame(update); },
    eyeLineStartPadding,
    centerOnRecord,
    restore,
    isCentering,
    destroy() { cleanups.forEach((fn) => fn()); },
  };
}
