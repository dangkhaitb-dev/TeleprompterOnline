const POPUP_GAP = 12;
const VIEWPORT_MARGIN = 16;
const ARROW_EDGE_MARGIN = 20;
const FALLBACK_POPUP_WIDTH = 320;
const FALLBACK_POPUP_HEIGHT = 140;

function getDocument(root) {
  if (root?.nodeType === 9) return root;
  return root?.ownerDocument || null;
}

function getViewport(documentRoot) {
  const view = documentRoot.defaultView;
  return {
    height: view?.innerHeight || documentRoot.documentElement?.clientHeight || 0,
    width: view?.innerWidth || documentRoot.documentElement?.clientWidth || 0,
  };
}

function getVisibleRect(target, documentRoot, viewport) {
  if (!target || typeof target.getBoundingClientRect !== 'function' || !target.isConnected) {
    return null;
  }

  const view = documentRoot.defaultView;
  const styles = view?.getComputedStyle?.(target);
  if (target.hidden || styles?.display === 'none' || styles?.visibility === 'hidden') return null;

  const rect = target.getBoundingClientRect();
  const width = Number.isFinite(rect.width) ? rect.width : rect.right - rect.left;
  const height = Number.isFinite(rect.height) ? rect.height : rect.bottom - rect.top;
  if (
    !Number.isFinite(rect.left)
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.right)
    || !Number.isFinite(rect.bottom)
    || width <= 0
    || height <= 0
    || rect.right <= 0
    || rect.bottom <= 0
    || rect.left >= viewport.width
    || rect.top >= viewport.height
  ) return null;

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width,
    height,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function resolveTarget(target) {
  if (typeof target !== 'function') return target;
  try {
    return target();
  } catch {
    return null;
  }
}

export function createFirstVisitTour({
  root = document,
  steps = [],
  skipLabel = 'Skip',
  ariaLabel,
  onComplete,
} = {}) {
  const documentRoot = getDocument(root);
  const mount = root?.nodeType === 9 ? root.body : root;
  const tourSteps = Array.isArray(steps) ? steps.slice() : [];
  let active = false;
  let completed = false;
  let destroyed = false;
  let currentStep = 0;
  let overlay = null;
  let popup = null;
  let text = null;
  let skip = null;

  function positionCurrentStep() {
    if (!active || !popup) return;
    const viewport = getViewport(documentRoot);
    const target = resolveTarget(tourSteps[currentStep]?.target);
    const targetRect = getVisibleRect(target, documentRoot, viewport);

    if (!targetRect) {
      popup.style.left = '50%';
      popup.style.top = '50%';
      popup.style.transform = 'translate(-50%, -50%)';
      popup.dataset.placement = 'center';
      popup.style.removeProperty('--first-visit-tour-arrow-left');
      return;
    }

    popup.style.transform = '';
    const popupRect = popup.getBoundingClientRect();
    const availableWidth = Math.max(0, viewport.width - (VIEWPORT_MARGIN * 2));
    const popupWidth = popupRect.width || Math.min(FALLBACK_POPUP_WIDTH, availableWidth);
    const popupHeight = popupRect.height || FALLBACK_POPUP_HEIGHT;
    const centeredLeft = targetRect.left + ((targetRect.width - popupWidth) / 2);
    const left = clamp(
      centeredLeft,
      VIEWPORT_MARGIN,
      viewport.width - popupWidth - VIEWPORT_MARGIN,
    );

    let top;
    let placement;
    if (targetRect.bottom + POPUP_GAP + popupHeight <= viewport.height - VIEWPORT_MARGIN) {
      top = targetRect.bottom + POPUP_GAP;
      placement = 'below';
    } else if (targetRect.top - POPUP_GAP - popupHeight >= VIEWPORT_MARGIN) {
      top = targetRect.top - POPUP_GAP - popupHeight;
      placement = 'above';
    } else {
      const isMobile = viewport.width <= 600;
      if (isMobile) {
        const targetCenterY = targetRect.top + (targetRect.height / 2);
        if (targetCenterY > viewport.height / 2) {
          top = VIEWPORT_MARGIN;
          placement = 'above-clamped';
        } else {
          top = viewport.height - popupHeight - VIEWPORT_MARGIN;
          placement = 'below-clamped';
        }
      } else {
        top = clamp(
          (viewport.height - popupHeight) / 2,
          VIEWPORT_MARGIN,
          viewport.height - popupHeight - VIEWPORT_MARGIN,
        );
        placement = 'center';
      }
    }

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
    popup.dataset.placement = placement;
    const arrowLeft = clamp(
      targetRect.left + (targetRect.width / 2) - left,
      ARROW_EDGE_MARGIN,
      popupWidth - ARROW_EDGE_MARGIN,
    );
    popup.style.setProperty('--first-visit-tour-arrow-left', `${Math.round(arrowLeft)}px`);
  }

  function renderCurrentStep() {
    const step = tourSteps[currentStep];
    text.textContent = String(step?.text ?? '');
    overlay.dataset.stepIndex = String(currentStep);
    positionCurrentStep();
  }

  function removeTour() {
    if (!active) return;
    documentRoot.removeEventListener('click', advance);
    skip.removeEventListener('click', skipTour);
    documentRoot.removeEventListener('keydown', handleKeydown);
    documentRoot.defaultView?.removeEventListener('resize', positionCurrentStep);
    documentRoot.defaultView?.removeEventListener('scroll', positionCurrentStep, true);
    overlay.remove();
    active = false;
    overlay = null;
    popup = null;
    text = null;
    skip = null;
  }

  function complete() {
    if (completed) return;
    completed = true;
    removeTour();
    if (typeof onComplete === 'function') onComplete();
  }

  function advance() {
    if (completed) return;
    if (currentStep >= tourSteps.length - 1) {
      complete();
      return;
    }
    currentStep += 1;
    renderCurrentStep();
  }

  function skipTour(event) {
    event.stopPropagation();
    event.preventDefault();
    complete();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      complete();
    }
  }

  function start() {
    if (active || completed || destroyed || !documentRoot || !mount) return;
    if (tourSteps.length === 0) {
      completed = true;
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    overlay = documentRoot.createElement('div');
    overlay.className = 'first-visit-tour-overlay';

    popup = documentRoot.createElement('section');
    popup.className = 'first-visit-tour-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-live', 'polite');
    if (ariaLabel) popup.setAttribute('aria-label', String(ariaLabel));

    const arrow = documentRoot.createElement('span');
    arrow.className = 'first-visit-tour-arrow';
    arrow.setAttribute('aria-hidden', 'true');

    text = documentRoot.createElement('p');
    text.className = 'first-visit-tour-text';

    skip = documentRoot.createElement('button');
    skip.className = 'first-visit-tour-skip';
    skip.type = 'button';
    skip.textContent = String(skipLabel);

    popup.append(arrow, text, skip);
    overlay.append(popup);
    mount.append(overlay);
    active = true;
    currentStep = 0;

    // Bubble phase is intentional: the clicked control performs its normal
    // action first, then the same click advances this non-modal tour.
    documentRoot.addEventListener('click', advance);
    skip.addEventListener('click', skipTour);
    documentRoot.addEventListener('keydown', handleKeydown);
    documentRoot.defaultView?.addEventListener('resize', positionCurrentStep);
    documentRoot.defaultView?.addEventListener('scroll', positionCurrentStep, true);

    renderCurrentStep();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    removeTour();
  }

  return { start, destroy };
}
