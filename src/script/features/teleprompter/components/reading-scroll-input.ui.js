// reading-scroll-input.ui.js — captures manual reading gestures for whichever
// surface currently owns the teleprompter session. The Notch is a sibling of
// the studio stage, so capture must be scoped to the active surface as well as
// the stage.

export function createReadingScrollInput({
  documentRoot = document,
  getSurface,
  getStage,
  isReadingActive,
  onManualScroll,
  onManualScrollEnd,
} = {}) {
  let enabled = false;
  let touchActive = false;
  let lastTouchY = null;

  const readingIsActive = () => (
    typeof isReadingActive !== 'function' || isReadingActive()
  );

  function isReadingTarget(target) {
    const surface = getSurface?.();
    const stage = getStage?.();
    return Boolean(
      target
      && ((surface && (surface === target || surface.contains(target)))
        || (stage && (stage === target || stage.contains(target)))),
    );
  }

  function forward(delta) {
    if (!Number.isFinite(delta) || delta === 0) return;
    onManualScroll?.(delta);
  }

  function handleWheel(event) {
    if (!enabled || !readingIsActive() || !isReadingTarget(event.target)) return;
    event.preventDefault();
    forward(event.deltaY);
  }

  function handleTouchStart(event) {
    if (!enabled || !readingIsActive() || !isReadingTarget(event.target)) return;
    const touch = event.touches[0];
    if (!touch) return;
    touchActive = true;
    lastTouchY = touch.clientY;
  }

  function handleTouchMove(event) {
    if (!touchActive || lastTouchY == null) return;
    const touch = event.touches[0];
    if (!touch) return;
    const nextY = touch.clientY;
    forward(lastTouchY - nextY);
    lastTouchY = nextY;
    event.preventDefault();
  }

  function finishTouch() {
    if (!touchActive) return;
    touchActive = false;
    lastTouchY = null;
    onManualScrollEnd?.();
  }

  function setActive(nextActive) {
    const next = Boolean(nextActive);
    if (next === enabled) return;
    enabled = next;
    if (enabled) {
      documentRoot.addEventListener('wheel', handleWheel, { capture: true, passive: false });
      documentRoot.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
      documentRoot.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
      documentRoot.addEventListener('touchend', finishTouch, { capture: true });
      documentRoot.addEventListener('touchcancel', finishTouch, { capture: true });
      return;
    }
    finishTouch();
    documentRoot.removeEventListener('wheel', handleWheel, { capture: true });
    documentRoot.removeEventListener('touchstart', handleTouchStart, { capture: true });
    documentRoot.removeEventListener('touchmove', handleTouchMove, { capture: true });
    documentRoot.removeEventListener('touchend', finishTouch, { capture: true });
    documentRoot.removeEventListener('touchcancel', finishTouch, { capture: true });
  }

  return {
    setActive,
    destroy() { setActive(false); },
  };
}
