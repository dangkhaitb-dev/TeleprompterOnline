// panel-drag.ui.js — free movement for the camera-mode teleprompter panel.

// Smallest width the panel may be resized to. Kept low so the teleprompter can
// be squeezed into a narrow column; the control bar stays usable below this.
const MIN_PANEL_WIDTH = 200;

export function initPanelDrag({ stage, panel, handle, resizeHandle, onMove } = {}) {
  if (!stage || !panel || !handle) return { destroy() {} };

  let drag = null;
  let resize = null;
  const cleanups = [];
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener(type, fn));
  };
  const notifyMove = () => {
    if (typeof onMove === 'function') onMove();
  };

  function stageOffset() {
    return parseFloat(getComputedStyle(panel).getPropertyValue('--tp-panel-stage-offset')) || 0;
  }

  // One geometry snapshot per gesture. Re-reading rects/computed style inside
  // pointermove forces a synchronous reflow per event (the previous move's
  // style writes dirtied layout) — measure at pointerdown, reuse while dragging.
  function measureMetrics() {
    const stageRect = stage.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
      // The stage normally begins below the header. A negative stage-relative
      // top lets the panel occupy that header band while its top edge remains
      // inside the viewport.
      minTop: Math.min(0, -stageRect.top),
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
      panelLeft: panelRect.left - stageRect.left,
      panelTop: panelRect.top - stageRect.top,
      offset: stageOffset(),
    };
  }

  function clampPosition(left, top, metrics) {
    return {
      left: Math.max(0, Math.min(left, Math.max(0, metrics.stageWidth - metrics.panelWidth))),
      top: Math.max(metrics.minTop, Math.min(top, Math.max(0, metrics.stageHeight - metrics.panelHeight))),
    };
  }

  function applyPosition(left, top, metrics) {
    const next = clampPosition(left, top, metrics);
    panel.style.left = `${Math.round(next.left)}px`;
    // `top` is the panel's visual stage-relative coordinate. In reading mode
    // CSS offsets the panel by the 60px reclaimed from the hidden header, so
    // store the matching layout coordinate instead of applying that offset a
    // second time.
    panel.style.top = `${Math.round(next.top - metrics.offset)}px`;
    panel.style.transform = 'translateY(var(--tp-panel-stage-offset))';
    notifyMove();
  }

  function applyGeometry({ left, top, width, height }, offset) {
    // CSS supplies the initial responsive maximums. Once the user explicitly
    // resizes the panel, the stage bounds below become the source of truth.
    panel.style.maxWidth = 'none';
    panel.style.maxHeight = 'none';
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top - offset)}px`;
    panel.style.width = `${Math.round(width)}px`;
    panel.style.height = `${Math.round(height)}px`;
    panel.style.transform = 'translateY(var(--tp-panel-stage-offset))';
    notifyMove();
  }

  on(handle, 'pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const metrics = measureMetrics();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: metrics.panelLeft,
      top: metrics.panelTop,
      metrics,
    };
    // Replace the initial left:50%/translateX centering without making the
    // panel jump when the first pointermove arrives.
    applyPosition(drag.left, drag.top, metrics);
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
    panel.classList.add('is-dragging');
  });

  on(handle, 'pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    applyPosition(
      drag.left + event.clientX - drag.startX,
      drag.top + event.clientY - drag.startY,
      drag.metrics,
    );
  });

  const stopDrag = (event) => {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    drag = null;
    handle.classList.remove('dragging');
    panel.classList.remove('is-dragging');
  };
  on(handle, 'pointerup', stopDrag);
  on(handle, 'pointercancel', stopDrag);
  on(handle, 'lostpointercapture', stopDrag);

  // The template exposes eight resize handles. Keep the opposite edge fixed
  // while constraining the resized panel to the visible stage/header area.
  panel.querySelectorAll('[data-resize]').forEach((resizeHandle) => {
    on(resizeHandle, 'pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const direction = resizeHandle.dataset.resize || '';
      const metrics = measureMetrics();
      resize = {
        pointerId: event.pointerId,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        left: metrics.panelLeft,
        top: metrics.panelTop,
        width: metrics.panelWidth,
        height: metrics.panelHeight,
        stageWidth: metrics.stageWidth,
        stageHeight: metrics.stageHeight,
        minTop: metrics.minTop,
        offset: metrics.offset,
      };

      // Resolve the initial percentage/translate centering immediately so the
      // first movement starts from the panel's actual on-screen geometry.
      applyGeometry(resize, resize.offset);
      resizeHandle.setPointerCapture(event.pointerId);
    });

    on(resizeHandle, 'pointermove', (event) => {
      if (!resize || event.pointerId !== resize.pointerId) return;

      const minWidth = Math.min(MIN_PANEL_WIDTH, resize.stageWidth);
      const minHeight = Math.min(180, resize.stageHeight - resize.minTop);
      const dx = event.clientX - resize.startX;
      const dy = event.clientY - resize.startY;
      const right = resize.left + resize.width;
      const bottom = resize.top + resize.height;
      let { left, top, width, height } = resize;

      if (resize.direction.includes('e')) {
        width = Math.max(minWidth, Math.min(resize.width + dx, resize.stageWidth - resize.left));
      }
      if (resize.direction.includes('w')) {
        left = Math.max(0, Math.min(resize.left + dx, right - minWidth));
        width = right - left;
      }
      if (resize.direction.includes('s')) {
        height = Math.max(minHeight, Math.min(resize.height + dy, resize.stageHeight - resize.top));
      }
      if (resize.direction.includes('n')) {
        top = Math.max(resize.minTop, Math.min(resize.top + dy, bottom - minHeight));
        height = bottom - top;
      }

      applyGeometry({ left, top, width, height }, resize.offset);
    });

    const stopResize = (event) => {
      if (!resize || (event.pointerId !== undefined && event.pointerId !== resize.pointerId)) return;
      resize = null;
    };
    on(resizeHandle, 'pointerup', stopResize);
    on(resizeHandle, 'pointercancel', stopResize);
    on(resizeHandle, 'lostpointercapture', stopResize);
  });

  // Mobile-only control: horizontal drag resizes width symmetrically about
  // the panel's center (left/right move together, staying centered), while
  // vertical drag resizes height with the top edge pinned (panel is no
  // longer freely draggable on mobile, so its top position never moves).
  if (resizeHandle) {
    let symResize = null;
    on(resizeHandle, 'pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const metrics = measureMetrics();
      symResize = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: metrics.panelLeft,
        top: metrics.panelTop,
        width: metrics.panelWidth,
        height: metrics.panelHeight,
        stageWidth: metrics.stageWidth,
        stageHeight: metrics.stageHeight,
        minTop: metrics.minTop,
        offset: metrics.offset,
      };

      applyGeometry(symResize, symResize.offset);
      resizeHandle.setPointerCapture(event.pointerId);
    });

    on(resizeHandle, 'pointermove', (event) => {
      if (!symResize || event.pointerId !== symResize.pointerId) return;

      const dx = event.clientX - symResize.startX;
      const dy = event.clientY - symResize.startY;
      const minWidth = Math.min(MIN_PANEL_WIDTH, symResize.stageWidth);
      const minHeight = Math.min(180, symResize.stageHeight - symResize.minTop);
      const centerX = symResize.left + symResize.width / 2;

      let width = Math.max(minWidth, symResize.width + dx * 2);
      width = Math.min(width, symResize.stageWidth);
      let left = centerX - width / 2;
      left = Math.max(0, Math.min(left, symResize.stageWidth - width));

      let height = Math.max(minHeight, symResize.height + dy);
      height = Math.min(height, symResize.stageHeight - symResize.top);

      applyGeometry({ left, top: symResize.top, width, height }, symResize.offset);
    });

    const stopSymResize = (event) => {
      if (!symResize || (event.pointerId !== undefined && event.pointerId !== symResize.pointerId)) return;
      symResize = null;
    };
    on(resizeHandle, 'pointerup', stopSymResize);
    on(resizeHandle, 'pointercancel', stopSymResize);
    on(resizeHandle, 'lostpointercapture', stopSymResize);
  }

  // Deferred to rAF so the re-clamp batches with the other resize listeners
  // instead of interleaving reads and writes inside the same resize event.
  let resizeRaf = 0;
  const onResize = () => {
    if (!panel.style.left || !panel.style.top) return;
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      const metrics = measureMetrics();
      applyPosition(metrics.panelLeft, metrics.panelTop, metrics);
    });
  };
  on(window, 'resize', onResize);
  cleanups.push(() => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
  });

  return { destroy() { cleanups.forEach((cleanup) => cleanup()); } };
}
