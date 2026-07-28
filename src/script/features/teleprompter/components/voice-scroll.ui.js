// voice-scroll.ui.js — Voice scroll UI layer. The ONLY layer that touches DOM.
// Handles: PID scroll loop, word span wrapping, text highlight, viewport-only
// manual scroll detection, explicit word re-anchor, optimistic creep updates.
//
// Ported from deepgram-teleprompter/public/app.js (sections 2–3).
// Works across all 3 modes: Camera OFF / Camera ON / Notch.
//
// CSS classes used:
// - .vs-w — word span wrapper
// - .vs-separator — punctuation/spacing associated with the preceding word
// - .vs-line — paragraph/line wrapper
// - .vs-spoken — word that has been read (past)
// - .vs-active — word chosen as the current reading anchor
// - .voice-scroll-active — class on #app when voice scroll is on
// - .reading-line — visual reading line indicator

import {
  TPCOM_PID, CREEP, MANUAL_SCROLL_THRESHOLD,
  createPIDController,
  segmentParts, normalize, foldDiacritics, viKey,
} from './voice-scroll.model.js';

import {
  createVoiceScrollController,
} from './voice-scroll.logic.js';

const BLOCK_TEXT_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'UL',
]);

/**
 * Wraps each word in the existing rich-text DOM with <span class="vs-w">
 * elements for positional tracking. Keeping the current element tree is
 * important for Notch: its font/color/alignment live on the nested
 * `.notch-text` element, and selection-level formatting lives on descendants.
 * @param {HTMLElement} surface - The prompter surface element
 * @returns {{ parts: Array, words: Array, originalHTML: string }}
 */
function wrapSurfaceWords(surface) {
  const originalHTML = surface.innerHTML;
  const text = surface.innerText || '';
  const parts = segmentParts(text);
  const words = [];
  let trailingWord = null;

  function markBreakAfterLastWord() {
    if (words.length) words[words.length - 1].breakAfter = true;
    trailingWord = null;
  }

  function wrapTextNode(textNode) {
    const fragment = document.createDocumentFragment();

    segmentParts(textNode.nodeValue || '').forEach((part) => {
      if (!part.isWord) {
        const separator = document.createElement('span');
        separator.className = 'vs-separator';
        separator.textContent = part.text;
        fragment.appendChild(separator);
        if (trailingWord) trailingWord.trailingEls.push(separator);
        // Mark clause boundaries (punctuation)
        if (words.length && /[.!?,;:…—–]/.test(part.text)) {
          words[words.length - 1].breakAfter = true;
        }
        if (/[\r\n]/.test(part.text)) markBreakAfterLastWord();
        return;
      }
      const norm = normalize(part.text);
      const fold = foldDiacritics(norm);
      const vkey = viKey(norm);
      const span = document.createElement('span');
      span.className = 'vs-w';
      span.textContent = part.text;
      span.dataset.index = String(words.length);
      fragment.appendChild(span);
      trailingWord = {
        raw: part.text,
        display: part.text,
        norm,
        fold,
        vkey,
        el: span,
        trailingEls: [],
        breakAfter: false,
      };
      words.push(trailingWord);
    });

    textNode.replaceWith(fragment);
  }

  function walk(container) {
    Array.from(container.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        wrapTextNode(node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const element = /** @type {HTMLElement} */ (node);
      if (element.tagName === 'BR' || element.tagName === 'HR') {
        markBreakAfterLastWord();
        return;
      }

      const wordCountBefore = words.length;
      walk(element);
      if (words.length > wordCountBefore && BLOCK_TEXT_TAGS.has(element.tagName)) {
        markBreakAfterLastWord();
      }
    });
  }

  walk(surface);
  markBreakAfterLastWord();

  return { parts, words, originalHTML };
}

function createScrollEngine(getSurface, pid) {
  let animId = null;
  let transition = null;

  function tick(timestamp) {
    const surface = getSurface();
    if (!surface) {
      animId = null;
      transition = null;
      return;
    }

    if (transition) {
      if (transition.startedAt === null) transition.startedAt = timestamp;
      const progress = Math.min(1, (timestamp - transition.startedAt) / transition.duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const position = transition.from + (transition.to - transition.from) * eased;
      surface.scrollTop = Math.round(position);
      pid.syncTo(position);

      if (progress < 1) {
        animId = requestAnimationFrame(tick);
      } else {
        surface.scrollTop = Math.round(transition.to);
        pid.syncTo(transition.to);
        transition = null;
        animId = null;
      }
      return;
    }

    const { position, settled } = pid.tick(timestamp);
    surface.scrollTop = Math.round(position);

    if (!settled) {
      animId = requestAnimationFrame(tick);
    } else {
      animId = null;
    }
  }

  function ensureRunning() {
    // Fresh speech takes ownership from an explicit click transition.
    transition = null;
    if (animId === null) {
      animId = requestAnimationFrame(tick);
    }
  }

  function animateTo(target, duration) {
    const surface = getSurface();
    if (!surface) return;
    if (animId !== null) cancelAnimationFrame(animId);

    const from = surface.scrollTop;
    if (Math.abs(target - from) < 1) {
      surface.scrollTop = Math.round(target);
      pid.syncTo(target);
      animId = null;
      transition = null;
      return;
    }

    pid.syncTo(from);
    transition = {
      from,
      to: target,
      duration: Math.max(1, duration),
      startedAt: null,
    };
    animId = requestAnimationFrame(tick);
  }

  function stop() {
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    transition = null;
  }

  return {
    ensureRunning,
    animateTo,
    stop,
    isRunning: () => animId !== null,
  };
}

function setSpokenAppearance(word, spoken) {
  if (!word) return;
  word.el.classList.toggle('vs-spoken', spoken);
  word.trailingEls?.forEach((el) => el.classList.toggle('vs-spoken', spoken));
}

function isSameVisualRow(left, right) {
  if (!left?.el || !right?.el) return false;
  return left.el.parentElement === right.el.parentElement
    && left.el.offsetTop === right.el.offsetTop;
}

function getVisualRowBounds(words, index) {
  let start = index;
  let end = index;

  while (start > 0 && isSameVisualRow(words[start - 1], words[start])) start -= 1;
  while (end + 1 < words.length && isSameVisualRow(words[end], words[end + 1])) end += 1;

  return { start, end };
}

export function paintWords(words, displayIndex, prevDisplayIndex) {
  if (displayIndex === prevDisplayIndex || !words[displayIndex]) return;

  // Dim complete visual rows only. If the current cursor is still anywhere
  // inside a wrapped row, every word in that row remains fully readable.
  // Include the whole rows around both cursors so forward movement and
  // backward re-anchoring update every affected word together.
  const changedFrom = prevDisplayIndex < 0
    ? 0
    : Math.min(displayIndex, prevDisplayIndex);
  const changedTo = Math.max(displayIndex, prevDisplayIndex);
  let rowStart = getVisualRowBounds(words, changedFrom).start;
  const lastAffectedRowEnd = getVisualRowBounds(words, changedTo).end;

  while (rowStart <= lastAffectedRowEnd) {
    const rowEnd = getVisualRowBounds(words, rowStart).end;
    const rowIsSpoken = rowEnd < displayIndex;
    for (let i = rowStart; i <= rowEnd; i++) {
      setSpokenAppearance(words[i], rowIsSpoken);
    }
    rowStart = rowEnd + 1;
  }

  // Clean up the legacy active marker without assigning it to the new word.
  if (prevDisplayIndex >= 0 && words[prevDisplayIndex]) {
    words[prevDisplayIndex].el.classList.remove('vs-active');
  }
  const el = words[displayIndex].el;
  el.classList.remove('vs-active');
}

// Standalone fallback when the host does not provide its adjustable eye-line.
const READING_RATIO = 1 / 3;
const WORD_ACTIVE_FEEDBACK_MS = 700;
const WORD_SCROLL_ANIMATION_MS = 360;

function readingLineOffset(surface, getReadingLineOffset) {
  const fallback = surface.clientHeight * READING_RATIO;
  const raw = getReadingLineOffset?.(surface);
  if (raw == null) return fallback;
  const provided = Number(raw);
  if (!Number.isFinite(provided)) return fallback;
  return Math.max(0, Math.min(surface.clientHeight, provided));
}

function scrollTarget(el, surface, getReadingLineOffset) {
  return Math.max(
    0,
    el.offsetTop - readingLineOffset(surface, getReadingLineOffset) + el.offsetHeight / 2,
  );
}

function createCreepEngine(
  getSurface,
  getReadingLineOffset,
  pid,
  scrollEngine,
  controller,
) {
  let creepRaf = null;
  
  function tick() {
    creepRaf = null;
    // A direct word selection owns the reading position until fresh speech
    // confirms that anchor. Even a stale creep callback that was already queued
    // before the click must not install another automatic scroll target.
    if (controller.isUserOverrideActive?.()) return;
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
        pid.setTarget(
          scrollTarget(words[target].el, surface, getReadingLineOffset),
          false,
        );
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
 *   getReadingLineOffset?: (surface: HTMLElement) => number | null,
 *   onPhaseChange?: (phase: string) => void,
 *   onError?: (error: string) => void,
 *   onTranscript?: (details: Object) => void,
 * }} opts
 * @returns {{ start: Function, stop: Function, isActive: Function, destroy: Function }}
 */
export function initVoiceScrollUI({
  getSurface,
  getReadingLineOffset,
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
  let paintedIndex = -1;
  let scrollHandler = null;
  let wordPointerDownHandler = null;
  let wordClickHandler = null;
  let wordActiveTimer = null;
  let active = false;
  let mountedSurface = null;

  function wordIndexFromEvent(event) {
    const surface = mountedSurface;
    const target = event.target instanceof Element ? event.target.closest('.vs-w') : null;
    if (!surface || !target || !surface.contains(target)) return -1;
    const index = Number.parseInt(target.dataset.index || '', 10);
    return Number.isInteger(index) && words[index]?.el === target ? index : -1;
  }

  function activateWord(index) {
    const surface = mountedSurface;
    if (!active || !controller || !surface || !words[index]) return;

    // User input has the highest scroll priority. Tear down the current Auto
    // frame and momentum first, then start one fresh transition from the exact
    // DOM position to the selected word. This prevents an in-flight PID target
    // from competing with the user's replacement target.
    if (creep) creep.stop();
    scrollEng.stop();
    pid.syncTo(surface.scrollTop);
    displayIndex = index;
    controller.setCursorTo(index, { userInitiated: true });
    // A direct word selection is an explicit reading-position change: dim
    // every complete visual row above the selected row. Manual scrolling uses
    // a separate path below and intentionally never paints spoken state.
    paintWords(words, displayIndex, paintedIndex);
    paintedIndex = displayIndex;

    words.forEach((word, wordIndex) => {
      word.el.classList.toggle('vs-active', wordIndex === index);
    });
    clearTimeout(wordActiveTimer);
    wordActiveTimer = setTimeout(() => {
      words[index]?.el.classList.remove('vs-active');
      wordActiveTimer = null;
    }, WORD_ACTIVE_FEEDBACK_MS);

    scrollEng.animateTo(
      scrollTarget(words[index].el, surface, getReadingLineOffset),
      WORD_SCROLL_ANIMATION_MS,
    );
  }
  
  async function start() {
    const surface = getSurface();
    if (!surface || active) return false;
    mountedSurface = surface;
    
    // 1. Wrap words in spans for tracking
    const wrapped = wrapSurfaceWords(surface);
    words = wrapped.words;
    originalHTML = wrapped.originalHTML;
    displayIndex = -1;
    paintedIndex = -1;
    
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
    surface.style.paddingTop = `${readingLineOffset(surface, getReadingLineOffset)}px`;
    
    // 3. Create controller
    controller = createVoiceScrollController({
      onCursorMove: ({ cursor: newCursor }) => {
        if (!words[newCursor]) return;
        displayIndex = newCursor;
        
        // Only a confirmed ASR cursor move (or an explicit word click above)
        // may advance the independently tracked row-dimming state.
        paintWords(words, displayIndex, paintedIndex);
        paintedIndex = displayIndex;
        
        // Scroll to word
        const surface = getSurface();
        if (!surface) return;
        const target = scrollTarget(words[newCursor].el, surface, getReadingLineOffset);
        
        // Recognition moves sequentially forward only. If the user manually
        // placed the viewport below this word, do not pull it backward.
        if (surface.scrollTop > target) return;
        
        pid.setTarget(target, false);
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
    creep = createCreepEngine(
      getSurface,
      getReadingLineOffset,
      pid,
      scrollEng,
      controller,
    );
    
    // 5. Set up manual scroll detection
    scrollHandler = () => {
      if (!controller || !controller.isActive()) return;
      const surface = getSurface();
      if (!surface) return;
      if (Math.abs(surface.scrollTop - Math.round(pid.current())) > MANUAL_SCROLL_THRESHOLD) {
        pid.syncTo(surface.scrollTop);
        if (creep) creep.stop();
        // Manual scrolling changes only the viewport. The speech matcher and
        // spoken-row state continue from the last confirmed ASR cursor; only an
        // explicit word click is allowed to re-anchor them.
      }
    };
    const surface2 = getSurface();
    if (surface2) {
      surface2.addEventListener('scroll', scrollHandler, { passive: true });

      // Auto mode turns every wrapped word into a direct reading anchor. Keep
      // pointer-down from moving the contenteditable caret, then re-anchor the
      // speech matcher and scroll position on click.
      wordPointerDownHandler = (event) => {
        if (wordIndexFromEvent(event) >= 0) event.preventDefault();
      };
      wordClickHandler = (event) => {
        const index = wordIndexFromEvent(event);
        if (index < 0) return;
        event.preventDefault();
        // The word owns this click. Keep direct re-anchoring isolated from
        // ancestor stage gestures; the Record stage also ignores Auto clicks
        // defensively so this interaction behaves exactly like Play.
        event.stopPropagation();
        activateWord(index);
      };
      surface2.addEventListener('pointerdown', wordPointerDownHandler);
      surface2.addEventListener('click', wordClickHandler);
    }
    
    // 6. Start voice recognition
    const scriptText = surface.innerText || '';
    const startingController = controller;
    const started = await startingController.start(words, scriptText);
    if (!started || controller !== startingController) {
      // stop() also restores the original rich HTML and removes listeners.
      if (controller === startingController) stop();
      return false;
    }
    
    // 7. Preserve the viewport on startup. Scrolling begins only after speech
    // produces a confirmed cursor move; the previous first-word nudge caused
    // an unnecessary second startup animation.
    pid.syncTo(getSurface()?.scrollTop || 0);
    
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
    if (surface && wordPointerDownHandler) {
      surface.removeEventListener('pointerdown', wordPointerDownHandler);
    }
    if (surface && wordClickHandler) {
      surface.removeEventListener('click', wordClickHandler);
    }
    wordPointerDownHandler = null;
    wordClickHandler = null;
    clearTimeout(wordActiveTimer);
    wordActiveTimer = null;
    
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
    paintedIndex = -1;
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
