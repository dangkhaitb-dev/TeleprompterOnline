// voice-scroll.ui.js — Voice scroll UI layer. The ONLY layer that touches DOM.
// Handles: PID scroll loop, word span wrapping, text highlight, manual scroll
// detection + re-anchor, optimistic creep visual updates.
//
// Ported from deepgram-teleprompter/public/app.js (sections 2–3).
// Works across all 3 modes: Camera OFF / Camera ON / Notch.
//
// CSS classes used:
// - .vs-w — word span wrapper
// - .vs-line — paragraph/line wrapper
// - .vs-spoken — word that has been read (past)
// - .vs-active — word currently being read
// - .voice-scroll-active — class on #app when voice scroll is on
// - .reading-line — visual reading line indicator

import {
  TPCOM_PID, CREEP, MANUAL_SCROLL_THRESHOLD, REANCHOR_DELAY_MS,
  createPIDController,
  segmentParts, normalize, foldDiacritics, viKey,
} from './voice-scroll.model.js';

import {
  createVoiceScrollController,
} from './voice-scroll.logic.js';

/**
 * Wraps each word in the surface text with <span class="vs-w"> elements
 * for positional tracking. Preserves original HTML for later restoration.
 * @param {HTMLElement} surface - The prompter surface element
 * @returns {{ parts: Array, words: Array, originalHTML: string }}
 */
function wrapSurfaceWords(surface) {
  const originalHTML = surface.innerHTML;
  const text = surface.innerText || '';
  const parts = segmentParts(text);
  
  // Clear and rebuild with word spans
  surface.innerHTML = '';
  const words = [];
  const lines = text.replace(/\r/g, '').split('\n');
  
  lines.forEach((line) => {
    const p = document.createElement('p');
    p.className = 'vs-line';
    
    segmentParts(line).forEach((part) => {
      if (!part.isWord) {
        p.appendChild(document.createTextNode(part.text));
        // Mark clause boundaries (punctuation)
        if (words.length && /[.!?,;:…—–]/.test(part.text)) {
          words[words.length - 1].breakAfter = true;
        }
        return;
      }
      const norm = normalize(part.text);
      const fold = foldDiacritics(norm);
      const vkey = viKey(norm);
      const span = document.createElement('span');
      span.className = 'vs-w';
      span.textContent = part.text;
      span.dataset.index = String(words.length);
      p.appendChild(span);
      words.push({ raw: part.text, display: part.text, norm, fold, vkey, el: span, breakAfter: false });
    });
    
    if (words.length) words[words.length - 1].breakAfter = true;
    surface.appendChild(p);
  });
  
  return { parts, words, originalHTML };
}

function createScrollEngine(getSurface, pid) {
  let animId = null;
  
  function tick(timestamp) {
    const surface = getSurface();
    if (!surface) { animId = null; return; }
    
    const { position, settled } = pid.tick(timestamp);
    surface.scrollTop = Math.round(position);
    
    if (!settled) {
      animId = requestAnimationFrame(tick);
    } else {
      animId = null;
    }
  }
  
  function ensureRunning() {
    if (animId === null) {
      animId = requestAnimationFrame(tick);
    }
  }
  
  function stop() {
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }
  
  return { ensureRunning, stop, isRunning: () => animId !== null };
}

function paintWords(words, displayIndex, prevDisplayIndex) {
  if (displayIndex === prevDisplayIndex || !words[displayIndex]) return;
  // Mark all words up to displayIndex as 'spoken'
  if (displayIndex > prevDisplayIndex) {
    for (let i = prevDisplayIndex + 1; i <= displayIndex; i++) {
      if (words[i]) words[i].el.classList.add('vs-spoken');
    }
  }
  // Remove 'active' from previous, add 'spoken'
  if (prevDisplayIndex >= 0 && words[prevDisplayIndex]) {
    words[prevDisplayIndex].el.classList.remove('vs-active');
    words[prevDisplayIndex].el.classList.add('vs-spoken');
  }
  // Set new active word
  const el = words[displayIndex].el;
  el.classList.remove('vs-spoken');
  el.classList.add('vs-active');
}

// Reading line at 1/3 from top (teleprompter.com standard)
const READING_RATIO = 1 / 3;

function scrollTarget(el, surface) {
  return Math.max(0, el.offsetTop - surface.clientHeight * READING_RATIO + el.offsetHeight / 2);
}

function findWordAtReadingLine(words, surface) {
  let lo = 0, hi = words.length - 1, idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (scrollTarget(words[mid].el, surface) <= surface.scrollTop + 1) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}

function createCreepEngine(getSurface, pid, scrollEngine, controller) {
  let creepRaf = null;
  
  function tick() {
    creepRaf = null;
    const info = controller.getCreepInfo();
    if (info.cursor < 0) return;
    const now = performance.now();
    if (now - info.lastResultAt > CREEP.SILENCE_MS) return;  // silence -> stop
    
    const elapsed = (now - info.anchorAt) / 1000;
    const stalled = (now - info.anchorAt) > CREEP.STALL_MS;
    const cap = stalled ? CREEP.MAX_AHEAD_STALLED : CREEP.MAX_AHEAD;
    const ahead = Math.min(cap, Math.floor(elapsed * (info.wpm / 60) * CREEP.RATE));
    const target = Math.min(info.wordsLength - 1, info.cursor + ahead);
    
    const words = controller.getWords();
    if (target > info.creepIndex && words[target]) {
      controller.updateCreepIndex(target);
      const surface = getSurface();
      if (surface) {
        // Update PID target without snap (smooth continuation)
        pid.setTarget(scrollTarget(words[target].el, surface), false);
        scrollEngine.ensureRunning();
      }
    }
    
    if (target < info.cursor + cap) {
      creepRaf = requestAnimationFrame(tick);
    }
  }
  
  function start() {
    if (creepRaf === null) creepRaf = requestAnimationFrame(tick);
  }
  
  function stop() {
    if (creepRaf !== null) { cancelAnimationFrame(creepRaf); creepRaf = null; }
  }
  
  return { start, stop };
}

/**
 * Initialize voice scroll UI for the teleprompter.
 * Call this when the Auto Scroll button is pressed.
 * @param {{
 *   getSurface: () => HTMLElement,
 *   onPhaseChange?: (phase: string) => void,
 *   onError?: (error: string) => void,
 *   onTranscript?: (details: Object) => void,
 * }} opts
 * @returns {{ start: Function, stop: Function, isActive: Function, destroy: Function }}
 */
export function initVoiceScrollUI({
  getSurface,
  onPhaseChange,
  onError,
  onTranscript,
} = {}) {
  const pid = createPIDController(TPCOM_PID);
  const scrollEng = createScrollEngine(getSurface, pid);
  let controller = null;
  let creep = null;
  let words = [];
  let originalHTML = '';
  let displayIndex = -1;
  let reanchorTimer = null;
  let scrollHandler = null;
  let active = false;
  let mountedSurface = null;
  
  async function start() {
    const surface = getSurface();
    if (!surface || active) return false;
    mountedSurface = surface;
    
    // 1. Wrap words in spans for tracking
    const wrapped = wrapSurfaceWords(surface);
    words = wrapped.words;
    originalHTML = wrapped.originalHTML;
    displayIndex = -1;
    
    if (!words.length) {
      // Restore and bail
      surface.innerHTML = originalHTML;
      mountedSurface = null;
      return false;
    }
    
    // 2. Prepare scroll surface (padding for eye-line)
    const surfaceHeight = surface.clientHeight;
    const trailing = Math.max(0, surfaceHeight * 0.8);
    surface.style.setProperty('--tp-scroll-tail', `${trailing}px`);
    surface.style.paddingTop = `${surfaceHeight * READING_RATIO}px`;
    
    // 3. Create controller
    controller = createVoiceScrollController({
      onCursorMove: ({ cursor: newCursor, isGlobal }) => {
        if (!words[newCursor]) return;
        const prevDisplay = displayIndex;
        displayIndex = newCursor;
        
        // Paint highlight
        paintWords(words, displayIndex, prevDisplay);
        
        // Scroll to word
        const surface = getSurface();
        if (!surface) return;
        const target = scrollTarget(words[newCursor].el, surface);
        
        // Forward-only guard (except global rescue)
        const snap = isGlobal && newCursor < prevDisplay;
        if (!isGlobal && surface.scrollTop > target) return;
        
        pid.setTarget(target, snap, snap ? surface.scrollTop : null);
        scrollEng.ensureRunning();
        
        // Start creep
        if (creep) creep.start();
      },
      onPhaseChange: (_phase) => {
        onPhaseChange?.(_phase);
      },
      onError: (err) => {
        console.warn('[VoiceScroll]', err);
        stop();
        onError?.(err);
      },
      onTranscript,
    });
    
    // 4. Create creep engine
    creep = createCreepEngine(getSurface, pid, scrollEng, controller);
    
    // 5. Set up manual scroll detection
    scrollHandler = () => {
      if (!controller || !controller.isActive()) return;
      const surface = getSurface();
      if (!surface) return;
      if (Math.abs(surface.scrollTop - Math.round(pid.current())) > MANUAL_SCROLL_THRESHOLD) {
        pid.syncTo(surface.scrollTop);
        if (creep) creep.stop();
        if (controller.getPhase() === 'listening') {
          clearTimeout(reanchorTimer);
          reanchorTimer = setTimeout(() => {
            const surface = getSurface();
            if (!surface || !controller.isActive()) return;
            const idx = findWordAtReadingLine(words, surface);
            controller.setCursorTo(idx);
            // Repaint from new position
            displayIndex = idx;
            words.forEach((w, i) => {
              w.el.classList.toggle('vs-spoken', i < idx);
              w.el.classList.toggle('vs-active', i === idx);
            });
          }, REANCHOR_DELAY_MS);
        }
      }
    };
    const surface2 = getSurface();
    if (surface2) surface2.addEventListener('scroll', scrollHandler, { passive: true });
    
    // 6. Start voice recognition
    const scriptText = surface.innerText || '';
    const startingController = controller;
    const started = await startingController.start(words, scriptText);
    if (!started || controller !== startingController) {
      // stop() also restores the original rich HTML and removes listeners.
      if (controller === startingController) stop();
      return false;
    }
    
    // 7. Initial nudge: scroll first word to reading line
    if (words[0]) {
      pid.setTarget(scrollTarget(words[0].el, getSurface()), true, 0);
      scrollEng.ensureRunning();
    }
    
    active = true;
    return true;
  }
  
  function stop() {
    active = false;
    
    // Stop controller
    if (controller) { controller.stop(); controller = null; }
    
    // Stop creep
    if (creep) { creep.stop(); creep = null; }
    
    // Stop scroll engine
    scrollEng.stop();
    pid.reset(0);
    
    // Remove scroll listener
    const surface = mountedSurface || getSurface();
    if (surface && scrollHandler) {
      surface.removeEventListener('scroll', scrollHandler);
    }
    scrollHandler = null;
    
    // Clear reanchor timer
    clearTimeout(reanchorTimer);
    reanchorTimer = null;
    
    // Restore original surface HTML
    if (surface && originalHTML) {
      // Preserve scroll position during restore
      const scrollPos = surface.scrollTop;
      surface.innerHTML = originalHTML;
      surface.scrollTop = scrollPos;
      surface.style.removeProperty('--tp-scroll-tail');
      surface.style.paddingTop = '';
    }
    
    words = [];
    displayIndex = -1;
    originalHTML = '';
    mountedSurface = null;
  }
  
  function destroy() {
    stop();
  }
  
  return {
    start,
    stop,
    isActive: () => active,
    destroy,
  };
}
