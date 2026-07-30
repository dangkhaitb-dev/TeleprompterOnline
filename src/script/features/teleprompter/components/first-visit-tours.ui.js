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
  hasSeenRecordButton = () => false,
  markMainSeen = () => {},
  markRecordButtonSeen = () => {},
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frame) => window.cancelAnimationFrame(frame),
  createTour = createFirstVisitTour,
  isMobile = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches,
} = {}) {
  let destroyed = false;
  let mainFrame = 0;
  let recordFrame = 0;
  let mainTour = null;
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
        { target: speedButton, text: copy.scrollMode },
        {
          target: () => (scrollMenu?.classList.contains('open') ? scrollMenu : speedButton),
          text: copy.scrollModes,
        },
        { target: playButton, text: copy.play },
      ],
      onComplete: markMainSeen,
    });
    mainTour.start();
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
    if (destroyed || !copy || hasSeenRecordButton() || recordTour || isMobile()) return;
    recordAttempt += 1;
    const attempt = recordAttempt;
    Promise.resolve(beforeRecordButtonTour()).then((ready) => {
      if (destroyed || attempt !== recordAttempt || ready === false) return;
      startRecordButtonTour();
    }).catch(() => {});
  }

  desktopRecordModeButton?.addEventListener('click', scheduleRecordButtonTour);
  mobileRecordModeButton?.addEventListener('click', scheduleRecordButtonTour);
  if (copy && !hasSeenMain()) mainFrame = requestFrame(startMainTour);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      recordAttempt += 1;
      desktopRecordModeButton?.removeEventListener('click', scheduleRecordButtonTour);
      mobileRecordModeButton?.removeEventListener('click', scheduleRecordButtonTour);
      if (mainFrame) cancelFrame(mainFrame);
      if (recordFrame) cancelFrame(recordFrame);
      mainTour?.destroy();
      recordTour?.destroy();
    },
  };
}
