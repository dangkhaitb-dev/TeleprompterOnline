import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { initPanelDrag } from './panel-drag.ui.js';

describe('initPanelDrag resize handles', () => {
  let dom;

  beforeEach(() => {
    dom = new JSDOM(`
      <div id="stage">
        <div id="panel"><button id="drag"></button><i data-resize="e"></i><i id="resize"></i></div>
      </div>
    `);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.getComputedStyle = dom.window.getComputedStyle;
  });

  afterEach(() => {
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.getComputedStyle;
  });

  it('changes the panel width when its east handle is dragged', () => {
    const stage = document.getElementById('stage');
    const panel = document.getElementById('panel');
    const dragHandle = document.getElementById('drag');
    const resizeHandle = panel.querySelector('[data-resize="e"]');
    const onMove = vi.fn();

    stage.getBoundingClientRect = () => ({ left: 0, top: 60, width: 900, height: 600 });
    panel.getBoundingClientRect = () => ({ left: 100, top: 100, width: 300, height: 240 });
    resizeHandle.setPointerCapture = vi.fn();

    const pointer = (type, x) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 200 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    const controller = initPanelDrag({ stage, panel, handle: dragHandle, onMove });
    resizeHandle.dispatchEvent(pointer('pointerdown', 400));
    resizeHandle.dispatchEvent(pointer('pointermove', 500));

    expect(panel.style.width).toBe('400px');
    expect(panel.style.height).toBe('240px');
    expect(panel.style.maxWidth).toBe('none');
    expect(onMove).toHaveBeenCalled();
    controller.destroy();
  });

  it('leaves the stored position untouched when the window resizes while the panel is hidden', () => {
    const stage = document.getElementById('stage');
    const panel = document.getElementById('panel');
    const dragHandle = document.getElementById('drag');

    // Simulate a panel the user already positioned by hand.
    panel.style.left = '120px';
    panel.style.top = '80px';

    stage.getBoundingClientRect = () => ({ left: 0, top: 60, width: 900, height: 600 });
    // Notch mode hides the panel (display:none) → getBoundingClientRect is 0×0.
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });

    const raf = globalThis.requestAnimationFrame;
    const caf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
    globalThis.cancelAnimationFrame = () => {};

    const controller = initPanelDrag({ stage, panel, handle: dragHandle });
    dom.window.dispatchEvent(new dom.window.Event('resize'));

    expect(panel.style.left).toBe('120px');
    expect(panel.style.top).toBe('80px');

    controller.destroy();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  });

  it('resizes width symmetrically and height from the bottom when the sync-resize handle is dragged', () => {
    const stage = document.getElementById('stage');
    const panel = document.getElementById('panel');
    const dragHandle = document.getElementById('drag');
    const resizeHandle = document.getElementById('resize');
    const onMove = vi.fn();

    stage.getBoundingClientRect = () => ({ left: 0, top: 60, width: 900, height: 600 });
    panel.getBoundingClientRect = () => ({ left: 100, top: 100, width: 300, height: 240 });
    resizeHandle.setPointerCapture = vi.fn();

    const pointer = (type, x, y) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    const controller = initPanelDrag({ stage, panel, handle: dragHandle, resizeHandle, onMove });
    resizeHandle.dispatchEvent(pointer('pointerdown', 400, 300));
    resizeHandle.dispatchEvent(pointer('pointermove', 430, 320));

    // Width grows by 2x the horizontal delta (30 * 2 = 60), staying centered:
    // left moves left by half the total growth (30px).
    expect(panel.style.width).toBe('360px');
    expect(panel.style.left).toBe('70px');
    // Height grows by exactly the vertical delta; top stays pinned.
    expect(panel.style.height).toBe('260px');
    expect(panel.style.top).toBe('40px');
    expect(onMove).toHaveBeenCalled();
    controller.destroy();
  });
});
