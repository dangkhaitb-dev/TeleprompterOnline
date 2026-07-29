import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScrollController } from './scroll-controller.js';

describe('createScrollController surface binding', () => {
  let frames;

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not leak scroll coordinates when getSurface changes mid-frame', () => {
    const normal = { scrollTop: 120, scrollHeight: 1000, clientHeight: 100 };
    const camera = { scrollTop: 0, scrollHeight: 700, clientHeight: 200 };
    let active = normal;
    const controller = createScrollController({
      getSurface: () => active,
      portal: { appendChild() {} },
    });

    controller.start(normal);
    active = camera;
    frames.shift()(16);

    expect(normal.scrollTop).toBe(120);
    expect(camera.scrollTop).toBe(0);
    expect(controller.getTarget()).toBe(normal);
  });

  it('reseeds position and extent when a new surface is explicitly bound', () => {
    const normal = { scrollTop: 120, scrollHeight: 1000, clientHeight: 100 };
    const notch = { scrollTop: 24, scrollHeight: 500, clientHeight: 100 };
    const controller = createScrollController({
      getSurface: () => notch,
      portal: { appendChild() {} },
    });

    controller.bindSurface(normal);
    controller.bindSurface(notch);
    controller.start(notch);
    frames.shift()(16);

    expect(controller.getTarget()).toBe(notch);
    expect(notch.scrollTop).toBe(24);
  });

  it('moves auto-scroll at the configured speed without a startup easing ramp', () => {
    const surface = { scrollTop: 0, scrollHeight: 1000, clientHeight: 100 };
    const controller = createScrollController({
      getSurface: () => surface,
      portal: { appendChild() {} },
    });
    controller.setWpm(130); // 40 px/s
    controller.start(surface);

    frames.shift()(16); // Seed the frame timestamp.
    frames.shift()(32);
    expect(surface.scrollTop).toBeCloseTo(0.64);

    frames.shift()(48);
    expect(surface.scrollTop).toBeCloseTo(1.28);
  });
});
