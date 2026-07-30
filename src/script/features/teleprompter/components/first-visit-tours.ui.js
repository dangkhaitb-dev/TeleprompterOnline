// Coordinates the two one-time Teleprompter tours. Persistence stays injected
// so this UI component never touches browser storage directly.

import { createFirstVisitTour } from './first-visit-tour.ui.js';

export function initFirstVisitTours({
  documentRoot = document,
  copy,
  playButton,
  speedButton,
  scrollMenu,
  desktopRecordModeButton,
  mobileRecordModeButton,
  recordButton,
  isRecordModeActive = () => false,
  beforeRecordButtonTour = () => true,
  hasSeenMain = () => false,
  hasSeenScrollModes = () => false,
  hasSeenRecordButton = () => false,
  markMainSeen = () => {},
  markScrollModesSeen = () => {},
  markRecordButtonSeen = () => {},
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frame) => window.cancelAnimationFrame(frame),
  createTour = createFirstVisitTour,
} = {}) {
  let destroyed = false;
  let mainFrame = 0;
  let scrollModesFrame = 0;
  let recordFrame = 0;
  let mainTour = null;
  let scrollModesTour = null;
  let recordTour = null;
  let recordAttempt = 0;

  function startMainTour() {
    mainFrame = 0;
    if (destroyed || !copy || hasSeenMain()) return;
    mainTour = createTour({
      root: documentRoot,
      ariaLabel: copy.label,
      skipLabel: copy.skip,
      steps: [
        { target: playButton, text: copy.play },
        { target: speedButton, text: copy.scrollMode },
      ],
      onComplete: () => {
        markMainSeen();
        if (scrollMenu?.classList.contains('open')) scheduleScrollModesTour();
      },
    });
    mainTour.start();
  }

  function scheduleScrollModesTour() {
    if (destroyed || !copy || hasSeenScrollModes() || scrollModesTour) return;
    if (scrollModesFrame) cancelFrame(scrollModesFrame);
    scrollModesFrame = requestFrame(() => {
      scrollModesFrame = 0;
      if (destroyed || !hasSeenMain() || !scrollMenu?.classList.contains('open')) return;
      scrollModesTour = createTour({
        root: documentRoot,
        ariaLabel: copy.label,
        skipLabel: copy.skip,
        steps: [{ target: scrollMenu, text: copy.scrollModes }],
        onComplete: markScrollModesSeen,
      });
      scrollModesTour.start();
    });
  }

  function startRecordButtonTour() {
    if (recordFrame) cancelFrame(recordFrame);
    recordFrame = requestFrame(() => {
      recordFrame = 0;
      if (
        destroyed
        || !hasSeenMain()
        || !isRecordModeActive()
        || recordButton?.hidden
      ) return;
      recordTour = createTour({
        root: documentRoot,
        ariaLabel: copy.label,
        skipLabel: copy.skip,
        steps: [{ target: recordButton, text: copy.recordButton }],
        onComplete: () => {
          markRecordButtonSeen();
        },
      });
      recordTour.start();
    });
  }

  function scheduleRecordButtonTour() {
    if (destroyed || !copy || hasSeenRecordButton() || recordTour) return;
    recordAttempt += 1;
    const attempt = recordAttempt;
    Promise.resolve(beforeRecordButtonTour()).then((ready) => {
      if (destroyed || attempt !== recordAttempt || ready === false) return;
      startRecordButtonTour();
    }).catch(() => {});
  }

  speedButton?.addEventListener('click', scheduleScrollModesTour);
  desktopRecordModeButton?.addEventListener('click', scheduleRecordButtonTour);
  mobileRecordModeButton?.addEventListener('click', scheduleRecordButtonTour);
  if (copy && !hasSeenMain()) mainFrame = requestFrame(startMainTour);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      recordAttempt += 1;
      speedButton?.removeEventListener('click', scheduleScrollModesTour);
      desktopRecordModeButton?.removeEventListener('click', scheduleRecordButtonTour);
      mobileRecordModeButton?.removeEventListener('click', scheduleRecordButtonTour);
      if (mainFrame) cancelFrame(mainFrame);
      if (scrollModesFrame) cancelFrame(scrollModesFrame);
      if (recordFrame) cancelFrame(recordFrame);
      mainTour?.destroy();
      scrollModesTour?.destroy();
      recordTour?.destroy();
    },
  };
}
