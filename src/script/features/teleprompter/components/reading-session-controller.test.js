import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadingSessionController } from './reading-session-controller.js';

function surface({ top = 0, height = 100, scrollHeight = 1000 } = {}) {
  return { scrollTop: top, clientHeight: height, scrollHeight };
}

function setup({ mode = 'wpm' } = {}) {
  const first = surface({ top: 90 });
  let active = first;
  let scrollMode = mode;
  let scrolling = false;

  const scroller = {
    bindSurface: vi.fn(),
    start: vi.fn(() => { scrolling = true; }),
    stop: vi.fn(() => { scrolling = false; }),
    isScrolling: vi.fn(() => scrolling),
  };
  const prepareSurface = vi.fn(() => true);
  const configureScroll = vi.fn();
  const startVoiceScroll = vi.fn();
  const stopVoiceScroll = vi.fn();

  const controller = createReadingSessionController({
    scroller,
    getSurface: () => active,
    prepareSurface,
    getScrollMode: () => scrollMode,
    configureScroll,
    startVoiceScroll,
    stopVoiceScroll,
    isVoiceScrollRunning: () => false,
  });

  return {
    controller,
    scroller,
    first,
    prepareSurface,
    configureScroll,
    startVoiceScroll,
    stopVoiceScroll,
    setActive(next) { active = next; },
    setMode(next) { scrollMode = next; },
  };
}

describe('createReadingSessionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['play', 'record'])('starts %s through the same gated lifecycle', (kind) => {
    const {
      controller,
      scroller,
      first,
      prepareSurface,
      startVoiceScroll,
    } = setup();

    controller.begin(kind, { waitFor: ['layout', 'capture'] });
    expect(scroller.start).not.toHaveBeenCalled();

    controller.release('layout');
    expect(scroller.start).not.toHaveBeenCalled();

    controller.release('capture');
    expect(prepareSurface).toHaveBeenCalledWith(first, true);
    expect(scroller.start).toHaveBeenCalledWith(first);
    expect(startVoiceScroll).not.toHaveBeenCalled();
  });

  it('pauses and resumes Record on the currently bound surface', () => {
    const { controller, scroller, first, prepareSurface } = setup();
    controller.begin('record');
    scroller.stop.mockClear();
    scroller.start.mockClear();
    prepareSurface.mockClear();

    controller.pause();
    expect(scroller.stop).toHaveBeenCalledOnce();

    controller.resume();
    expect(prepareSurface).toHaveBeenCalledWith(first, false);
    expect(scroller.start).toHaveBeenCalledWith(first);
  });

  it('maps normalized progress when switching normal to camera/notch', () => {
    const { controller, scroller, setActive } = setup();
    const next = surface({ top: 0, height: 200, scrollHeight: 2000 });
    controller.begin('play');
    scroller.start.mockClear();
    // first max = 900, so 90px is 10%; next max = 1800 → 180px.
    setActive(next);

    controller.switchSurface(next);

    expect(next.scrollTop).toBe(180);
    expect(scroller.bindSurface).toHaveBeenLastCalledWith(next);
    expect(scroller.start).toHaveBeenCalledWith(next);
  });

  it('keeps an idle notch preview at the top', () => {
    const { controller, scroller, setActive } = setup();
    const notch = surface({ top: 64, height: 100, scrollHeight: 700 });
    setActive(notch);

    controller.switchSurface(notch, { preserveProgress: false });

    expect(notch.scrollTop).toBe(0);
    expect(scroller.start).not.toHaveBeenCalled();
  });

  it('switches scroll modes without creating a second session path', () => {
    const {
      controller,
      scroller,
      first,
      setMode,
      startVoiceScroll,
    } = setup();
    controller.begin('play');
    setMode('auto');

    controller.refreshMode();

    expect(scroller.stop).toHaveBeenCalled();
    expect(startVoiceScroll).toHaveBeenCalledOnce();
    expect(controller.getSurface()).toBe(first);
    expect(controller.getKind()).toBe('play');
  });
});
