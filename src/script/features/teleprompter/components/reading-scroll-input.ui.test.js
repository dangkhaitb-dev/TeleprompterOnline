// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadingScrollInput } from './reading-scroll-input.ui.js';

function touchEvent(type, y) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    configurable: true,
    value: type === 'touchend' ? [] : [{ clientY: y }],
  });
  return event;
}

describe('createReadingScrollInput', () => {
  let stage;
  let prompt;
  let notchScroll;
  let activeSurface;
  let reading;
  let onManualScroll;
  let onManualScrollEnd;
  let input;

  beforeEach(() => {
    stage = document.createElement('main');
    prompt = document.createElement('div');
    notchScroll = document.createElement('div');
    stage.appendChild(prompt);
    document.body.append(stage, notchScroll);
    activeSurface = prompt;
    reading = true;
    onManualScroll = vi.fn();
    onManualScrollEnd = vi.fn();
    input = createReadingScrollInput({
      documentRoot: document,
      getSurface: () => activeSurface,
      getStage: () => stage,
      isReadingActive: () => reading,
      onManualScroll,
      onManualScrollEnd,
    });
    input.setActive(true);
  });

  afterEach(() => {
    input.destroy();
    document.body.replaceChildren();
  });

  it('captures a wheel directly on the independent Notch surface', () => {
    activeSurface = notchScroll;
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 72,
    });

    notchScroll.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onManualScroll).toHaveBeenCalledWith(72);
  });

  it('captures touch movement on the active Notch surface and releases manual ownership', () => {
    activeSurface = notchScroll;
    notchScroll.dispatchEvent(touchEvent('touchstart', 320));
    const move = touchEvent('touchmove', 254);
    notchScroll.dispatchEvent(move);
    notchScroll.dispatchEvent(touchEvent('touchend'));

    expect(move.defaultPrevented).toBe(true);
    expect(onManualScroll).toHaveBeenCalledWith(66);
    expect(onManualScrollEnd).toHaveBeenCalledOnce();
  });

  it('does not intercept native scrolling outside an active reading session', () => {
    reading = false;
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 40,
    });

    notchScroll.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(onManualScroll).not.toHaveBeenCalled();
  });
});
