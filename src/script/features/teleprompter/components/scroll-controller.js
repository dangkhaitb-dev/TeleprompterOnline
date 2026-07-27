// scroll-controller.js — rAF auto-scroll engine + manual scroll for the active
// prompter surface. Ported from recorder.js (scrollStep/startScroll/stopScroll,
// manualScroll, scrollToNextSection). The delta math lives in the model; DOM
// scrollTop mutation happens here (component layer).

import {
  WPM_DEFAULT,
  wpmToPxPerSec,
  pxPerSecForDuration,
  scrollDelta,
  paragraphStartIndices,
} from '../teleprompter.model.js';

// Measure paragraph offsetTops by mirroring the surface layout into a hidden div.
function paragraphTops(surface, mirrorRef, portal) {
  const text = surface.innerText || '';
  let mirror = mirrorRef.el;
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.className = 'tp-para-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    portal.appendChild(mirror);
    mirrorRef.el = mirror;
  }
  const cs = getComputedStyle(surface);
  [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
    'letterSpacing', 'textTransform', 'wordSpacing', 'textIndent',
    'textAlign', 'tabSize',
  ].forEach((p) => { mirror.style[p] = cs[p]; });
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.wordBreak = cs.wordBreak;
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  mirror.style.width = `${Math.max(0, surface.clientWidth - padX)}px`;

  const starts = paragraphStartIndices(text);
  // Build with safe text nodes + marker <i> elements (no HTML injection).
  mirror.textContent = '';
  let prev = 0;
  starts.forEach((s) => {
    mirror.appendChild(document.createTextNode(text.slice(prev, s)));
    const marker = document.createElement('i');
    marker.dataset.p = '';
    mirror.appendChild(marker);
    prev = s;
  });
  mirror.appendChild(document.createTextNode(text.slice(prev)));
  return Array.from(mirror.querySelectorAll('i[data-p]')).map((el) => el.offsetTop);
}

// getSurface: () => active scrollable element. onStopAtEnd: called when the
// scroll reaches the bottom (so the play icon flips back)
export function createScrollController({ getSurface, onStateChange, portal = document.body } = {}) {
  let pxPerSec = wpmToPxPerSec(WPM_DEFAULT);
  let scrolling = false;
  let lastFrame = 0;
  let scrollPosition = 0;
  let scrollTarget = 0;
  let manualScrollActive = false;
  let animId = null;
  let target = null;
  const mirrorRef = { el: null };

  const notify = () => { if (typeof onStateChange === 'function') onStateChange(scrolling); };

  // scrollHeight/clientHeight force a synchronous reflow whenever layout is
  // dirty (the record timer rewrites its label 4×/s during recording), so the
  // per-frame loop must not read them every tick. The content doesn't change
  // while reading — refresh the cached extent periodically and on surface swap.
  const MAX_SCROLL_REFRESH_TICKS = 30; // ~0.5s at 60fps
  let cachedMaxScroll = 0;
  let cachedSurface = null;
  let ticksUntilMeasure = 0;

  function measureMaxScroll(surface) {
    cachedSurface = surface;
    cachedMaxScroll = surface.scrollHeight - surface.clientHeight;
    ticksUntilMeasure = MAX_SCROLL_REFRESH_TICKS;
    return cachedMaxScroll;
  }

  function currentMaxScroll(surface) {
    if (surface !== cachedSurface || ticksUntilMeasure <= 0) return measureMaxScroll(surface);
    ticksUntilMeasure -= 1;
    return cachedMaxScroll;
  }

  function tick(timestamp) {
    const surface = getSurface && getSurface();
    if (!surface) {
      animId = null;
      lastFrame = 0;
      return;
    }

    const maxScroll = currentMaxScroll(surface);
    const elapsed = lastFrame ? Math.min(timestamp - lastFrame, 100) : 0;
    lastFrame = timestamp;

    if (scrolling && !manualScrollActive) {
      scrollTarget = Math.min(maxScroll, scrollTarget + scrollDelta(elapsed, pxPerSec));
    }

    const diff = scrollTarget - scrollPosition;
    const ease = 0.15; // Smooth scroll interpolation rate (0.15 is very natural)

    if (Math.abs(diff) < 0.5) {
      scrollPosition = scrollTarget;
      manualScrollActive = false; // Release the manual scroll block
    } else {
      scrollPosition += diff * ease;
    }

    surface.scrollTop = scrollPosition;

    if (scrolling && scrollPosition >= maxScroll) {
      stop();
    }

    const needsManualAnim = Math.abs(scrollTarget - scrollPosition) >= 0.5;
    if (scrolling || needsManualAnim) {
      animId = requestAnimationFrame(tick);
    } else {
      animId = null;
      lastFrame = 0;
    }
  }

  function start(surface) {
    if (scrolling) return;
    target = surface || (getSurface && getSurface());
    if (!target) return;
    scrolling = true;
    manualScrollActive = false;

    // The caller just rebuilt the surface (eye-line padding, scroll tail) —
    // seed the cached extent from the fresh layout.
    measureMaxScroll(target);
    scrollPosition = target.scrollTop;
    scrollTarget = target.scrollTop;

    notify();

    if (animId === null) {
      lastFrame = 0;
      animId = requestAnimationFrame(tick);
    }
  }

  function stop() {
    if (!scrolling) return;
    scrolling = false;
    notify();
  }

  function toggle() {
    if (scrolling) stop();
    else start(getSurface && getSurface());
  }

  function setWpm(wpm) {
    pxPerSec = wpmToPxPerSec(wpm);
  }

  function setDuration(durationSeconds, surface = getSurface && getSurface()) {
    if (!surface) return;
    const maxScroll = measureMaxScroll(surface);
    pxPerSec = pxPerSecForDuration(maxScroll - surface.scrollTop, durationSeconds);
  }

  function manualScroll(delta) {
    const surface = getSurface && getSurface();
    if (!surface) return;
    const maxScroll = currentMaxScroll(surface);

    // Only sync to the DOM scrollTop if the animation loop is not currently running.
    // This avoids layout-lag resetting scrollTarget during rapid key repeats.
    if (animId === null) {
      scrollPosition = surface.scrollTop;
      scrollTarget = surface.scrollTop;
    }

    scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget + delta));
    manualScrollActive = true; // Block auto-scroll accumulation while animating

    if (animId === null) {
      lastFrame = 0;
      animId = requestAnimationFrame(tick);
    }
  }

  function scrollToTop() {
    const surface = getSurface && getSurface();
    if (!surface) return;
    scrollTarget = 0;
    scrollPosition = 0;
    manualScrollActive = false;
    surface.scrollTop = 0;
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    lastFrame = 0;
    // Auto-scroll was running: keep it running from the top. Leaving animId
    // cancelled while `scrolling` stays true would freeze the engine in a
    // scrolling-but-dead state until the next toggle.
    if (scrolling) animId = requestAnimationFrame(tick);
  }

  function scrollToNextSection() {
    const surface = getSurface && getSurface();
    if (!surface) return;
    // Discrete action — measure fresh (the mirror walk below reflows anyway).
    const maxScroll = measureMaxScroll(surface);
    const cur = surface.scrollTop;
    let dest;
    try {
      const tops = paragraphTops(surface, mirrorRef, portal);
      const next = tops.find((t) => t > cur + 6);
      dest = next != null ? next : maxScroll;
    } catch {
      dest = cur + Math.round(surface.clientHeight * 0.5);
    }
    dest = Math.max(0, Math.min(maxScroll, dest));

    // Only sync if not actively animating
    if (animId === null) {
      scrollPosition = surface.scrollTop;
    }

    scrollTarget = dest;
    manualScrollActive = true; // Block auto-scroll accumulation while animating

    if (animId === null) {
      lastFrame = 0;
      animId = requestAnimationFrame(tick);
    }
  }

  function destroy() {
    stop();
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    if (mirrorRef.el) {
      mirrorRef.el.remove();
      mirrorRef.el = null;
    }
  }

  return {
    start,
    stop,
    toggle,
    setWpm,
    setDuration,
    manualScroll,
    scrollToTop,
    scrollToNextSection,
    isScrolling: () => scrolling,
    getTarget: () => target,
    destroy,
  };
}
