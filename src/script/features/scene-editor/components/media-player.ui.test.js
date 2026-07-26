/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaPlayer } from './media-player.ui.js';

function createAudio({ lockedVolume = false } = {}) {
  const audio = document.createElement('audio');
  let paused = true;
  let volume = 1;

  Object.defineProperties(audio, {
    paused: { configurable: true, get: () => paused },
    duration: { configurable: true, get: () => 20 },
    volume: {
      configurable: true,
      get: () => volume,
      set: (next) => { if (!lockedVolume) volume = next; },
    },
  });
  audio.play = vi.fn(() => {
    paused = false;
    audio.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  audio.pause = vi.fn(() => {
    paused = true;
    audio.dispatchEvent(new Event('pause'));
  });
  return audio;
}

function mount(audio) {
  const controller = new AbortController();
  const viewer = document.createElement('div');
  viewer.className = 'se-viewer';
  const preview = document.createElement('div');
  preview.className = 'se-audio-preview';
  preview.append(audio);
  viewer.append(preview);
  const player = createMediaPlayer({ signal: controller.signal });
  viewer.append(player.el);
  document.body.append(viewer);
  player.attachMedia(audio, 20);
  return { controller, player };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.AudioContext;
  vi.restoreAllMocks();
});

describe('scene editor media player', () => {
  it('plays, pauses, and seeks through the custom controls', async () => {
    const audio = createAudio();
    const { controller, player } = mount(audio);
    const play = player.el.querySelector('.se-media-play-btn');
    const progress = player.el.querySelector('.se-media-progress-input');

    play.click();
    expect(audio.play).toHaveBeenCalledOnce();
    play.click();
    expect(audio.pause).toHaveBeenCalledOnce();

    progress.value = '25';
    progress.dispatchEvent(new Event('input', { bubbles: true }));
    // Drag seeks are coalesced to one currentTime write per animation frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(audio.currentTime).toBe(5);

    controller.abort();
    player.destroy();
  });

  it('uses Web Audio gain when iOS locks media.volume', () => {
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    window.AudioContext = class {
      constructor() {
        this.state = 'suspended';
        this.destination = {};
      }
      createMediaElementSource() { return source; }
      createGain() { return gain; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      close() { return Promise.resolve(); }
    };
    const audio = createAudio({ lockedVolume: true });
    const { controller, player } = mount(audio);
    const volume = player.el.querySelector('.se-media-volume-input');

    volume.value = '35';
    volume.dispatchEvent(new Event('input', { bubbles: true }));

    expect(source.connect).toHaveBeenCalledWith(gain);
    expect(gain.gain.value).toBe(0.35);
    controller.abort();
    player.destroy();
  });

  it('keeps custom play/pause controls active on iOS', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    );
    const audio = createAudio({ lockedVolume: true });
    const { controller, player } = mount(audio);
    const play = player.el.querySelector('.se-media-play-btn');

    expect(audio.controls).toBe(false);
    expect(player.el.hidden).toBe(false);

    play.click();
    expect(audio.play).toHaveBeenCalledOnce();
    play.click();
    expect(audio.pause).toHaveBeenCalledOnce();

    audio.closest('.se-audio-preview').click();
    expect(audio.play).toHaveBeenCalledTimes(2);
    audio.closest('.se-audio-preview').click();
    expect(audio.pause).toHaveBeenCalledTimes(2);

    controller.abort();
    player.destroy();
  });
});
