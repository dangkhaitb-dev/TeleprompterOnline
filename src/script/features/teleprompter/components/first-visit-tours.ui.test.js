// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFirstVisitTours } from './first-visit-tours.ui.js';

const copy = {
  label: 'Teleprompter quick tour',
  skip: 'Skip',
  play: 'Play help',
  scrollMode: 'Scroll help',
  scrollModes: 'Scroll modes help',
  recordButton: 'Record button help',
};

function createFrameQueue() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    cancelFrame: vi.fn((id) => callbacks.delete(id)),
    flush() {
      const pending = Array.from(callbacks.values());
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    requestFrame: vi.fn((callback) => {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    }),
  };
}

describe('initFirstVisitTours', () => {
  let controls;
  let coordinator;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="play">Play</button>
      <button id="speed">Scroll</button>
      <div id="speed-menu"></div>
      <button id="desktop-mode">Record mode</button>
      <button id="mobile-mode">Record tab</button>
      <button id="record" hidden>Record</button>
    `;
    controls = {
      playButton: document.querySelector('#play'),
      speedButton: document.querySelector('#speed'),
      scrollMenu: document.querySelector('#speed-menu'),
      desktopRecordModeButton: document.querySelector('#desktop-mode'),
      mobileRecordModeButton: document.querySelector('#mobile-mode'),
      recordButton: document.querySelector('#record'),
    };
    Object.values(controls).forEach((element, index) => {
      element.getBoundingClientRect = () => ({
        left: 40 + (index * 80),
        top: 40,
        right: 100 + (index * 80),
        bottom: 84,
        width: 60,
        height: 44,
      });
    });
  });

  afterEach(() => {
    coordinator?.destroy();
    coordinator = null;
    document.body.innerHTML = '';
  });

  it('persists Skip and does not schedule the main tour again', () => {
    const frames = createFrameQueue();
    let mainSeen = false;
    const options = {
      ...controls,
      copy,
      hasSeenMain: () => mainSeen,
      markMainSeen: () => { mainSeen = true; },
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    };
    coordinator = initFirstVisitTours(options);
    frames.flush();
    expect(document.querySelector('.first-visit-tour-popup').textContent).toContain('Scroll help');

    document.querySelector('.first-visit-tour-skip').click();
    expect(mainSeen).toBe(true);
    coordinator.destroy();
    coordinator = initFirstVisitTours(options);
    frames.flush();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
  });

  it('shows and persists the Record button tour after the first desktop Record mode click', async () => {
    const frames = createFrameQueue();
    let recordModeActive = false;
    let recordTourSeen = false;
    controls.desktopRecordModeButton.addEventListener('click', () => {
      recordModeActive = true;
      controls.recordButton.hidden = false;
    });
    coordinator = initFirstVisitTours({
      ...controls,
      copy,
      hasSeenMain: () => true,
      hasSeenRecordButton: () => recordTourSeen,
      isRecordModeActive: () => recordModeActive,
      beforeRecordButtonTour: async () => true,
      markRecordButtonSeen: () => { recordTourSeen = true; },
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      isMobile: () => false,
    });

    controls.desktopRecordModeButton.click();
    await Promise.resolve();
    frames.flush();
    expect(document.querySelector('.first-visit-tour-popup').textContent)
      .toContain('Record button help');
    document.querySelector('.first-visit-tour-skip').click();
    expect(recordTourSeen).toBe(true);

    controls.desktopRecordModeButton.click();
    await Promise.resolve();
    frames.flush();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
  });

  it('does not show the Record button tour on mobile after the mobile Record tab click', async () => {
    const frames = createFrameQueue();
    let recordModeActive = false;
    let recordTourSeen = false;
    controls.mobileRecordModeButton.addEventListener('click', () => {
      recordModeActive = true;
      controls.recordButton.hidden = false;
    });
    coordinator = initFirstVisitTours({
      ...controls,
      copy,
      hasSeenMain: () => true,
      hasSeenRecordButton: () => recordTourSeen,
      isRecordModeActive: () => recordModeActive,
      beforeRecordButtonTour: async () => true,
      markRecordButtonSeen: () => { recordTourSeen = true; },
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      isMobile: () => true,
    });

    controls.mobileRecordModeButton.click();
    await Promise.resolve();
    frames.flush();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
  });

  it('runs Scroll, mode, and Play actions in an order that keeps every target visible', () => {
    const frames = createFrameQueue();
    const playAction = vi.fn();
    const scrollAction = vi.fn(() => controls.scrollMenu.classList.add('open'));
    const modeAction = vi.fn();
    let mainSeen = false;
    controls.playButton.addEventListener('click', playAction);
    controls.speedButton.addEventListener('click', scrollAction);
    controls.scrollMenu.addEventListener('click', modeAction);
    coordinator = initFirstVisitTours({
      ...controls,
      copy,
      hasSeenMain: () => mainSeen,
      markMainSeen: () => { mainSeen = true; },
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    frames.flush();

    controls.speedButton.click();
    expect(scrollAction).toHaveBeenCalledOnce();
    expect(document.querySelector('.first-visit-tour-popup').textContent)
      .toContain('Scroll modes help');

    controls.scrollMenu.click();
    expect(modeAction).toHaveBeenCalledOnce();
    expect(document.querySelector('.first-visit-tour-popup').textContent).toContain('Play help');

    controls.playButton.click();
    expect(playAction).toHaveBeenCalledOnce();
    expect(mainSeen).toBe(true);
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
  });

  it('waits for successful media preflight before showing the Record button hint', async () => {
    const frames = createFrameQueue();
    let mediaReady = false;
    controls.desktopRecordModeButton.addEventListener('click', () => {
      controls.recordButton.hidden = false;
    });
    coordinator = initFirstVisitTours({
      ...controls,
      copy,
      hasSeenMain: () => true,
      isRecordModeActive: () => true,
      beforeRecordButtonTour: async () => mediaReady,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    controls.desktopRecordModeButton.click();
    await Promise.resolve();
    frames.flush();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();

    mediaReady = true;
    controls.desktopRecordModeButton.click();
    await Promise.resolve();
    frames.flush();
    expect(document.querySelector('.first-visit-tour-popup').textContent)
      .toContain('Record button help');
  });

  it('cancels pending frames during teardown', () => {
    const frames = createFrameQueue();
    coordinator = initFirstVisitTours({
      ...controls,
      copy,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    coordinator.destroy();
    frames.flush();
    expect(frames.cancelFrame).toHaveBeenCalledOnce();
    expect(document.querySelector('.first-visit-tour-overlay')).toBeNull();
  });
});
