// home.ui.js — DOM wiring for the home composer (the only layer that touches
// the DOM). Reads copy from data-* attributes so strings stay in 11ty data.

import { startFromScript } from './home.logic.js';
import { initMobileNav } from './mobile-nav.ui.js';
import { initLanguageSwitcher } from './language-switcher.ui.js';
import { readTextFile } from '../../utils/read-text-file.js';
import { initFileDragDrop } from '../../utils/drag-drop.js';
import { prefetchPageAssets, fetchPageHtml } from '../../utils/prefetch-page.js';

// The hero demo video is pure decoration, so its bytes load dead last: the
// small poster paints as soon as the video nears the viewport, but the video
// itself waits until the teleprompter warm-up has settled — otherwise it
// competes for bandwidth with the JS/HTML the Start button needs. On
// data-saver / ≤3g connections the poster simply stays and the video never
// downloads.
const WARM_VIDEO_FALLBACK_MS = 15000;

function connectionAllowsVideo(connection) {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/^(?:slow-2g|2g|3g)$/.test(connection.effectiveType || '');
}

function initHeroVideo() {
  const video = document.getElementById('heroPreviewVideo');
  if (!video || !video.dataset.src) return null;

  let nearViewport = false;
  let warmSettled = false;
  let overlayOpen = false;

  const playSafely = () => {
    const played = video.play();
    if (played && played.catch) played.catch(() => {});
  };

  const maybeLoad = () => {
    if (video.dataset.loaded || !nearViewport || !warmSettled || overlayOpen) return;
    if (!connectionAllowsVideo(navigator.connection)) return;
    video.dataset.loaded = '1';
    // Force muted at the property level (not just the attribute) so the browser
    // always permits the autoplay below; `loop` on the element replays it.
    video.muted = true;
    video.src = video.dataset.src;
    playSafely();
  };

  const reveal = () => {
    if (nearViewport) return;
    nearViewport = true;
    if (video.dataset.poster) video.poster = video.dataset.poster;
    maybeLoad();
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            reveal();
            observer.disconnect();
          }
        });
      },
      { rootMargin: '300px' },
    );
    observer.observe(video);
  } else {
    reveal();
  }

  // If the warm signal never arrives (warm failed silently, or the composer
  // is missing), don't hold the video hostage forever on fast connections.
  window.setTimeout(() => {
    warmSettled = true;
    maybeLoad();
  }, WARM_VIDEO_FALLBACK_MS);

  return {
    onWarmSettled() {
      warmSettled = true;
      maybeLoad();
    },
    // While the teleprompter overlay covers the page the video must not eat
    // bandwidth: pause if playing, defer a not-yet-started load until close.
    onOverlayToggle(open) {
      overlayOpen = open;
      if (!video.dataset.loaded) {
        if (!open) maybeLoad();
        return;
      }
      if (open) video.pause();
      else playSafely();
    },
  };
}

export function initHomeUI() {
  const form = document.getElementById('composerForm');
  const textarea = document.getElementById('paste-textarea');
  const fileInput = document.getElementById('file-input');
  const uploadBtn = document.getElementById('upload-btn');
  const startBtn = document.getElementById('start-btn');
  const errorBox = document.getElementById('paste-error-box');
  const dragOverlay = document.getElementById('drag-overlay');

  initMobileNav();
  initLanguageSwitcher();
  const heroVideo = initHeroVideo();

  if (!form || !textarea) {
    // No composer means no warm-up will ever run; release the video now.
    if (heroVideo) heroVideo.onWarmSettled();
    return;
  }

  // Warm everything the in-page teleprompter overlay needs — markup (shared
  // HTML cache), plus the overlay JS+CSS chunks — so opening it on submit is
  // instant and costs zero server round-trips. Deliberately deferred: runs
  // once, on whichever intent signal lands first (idle after the page settles,
  // or focus/hover on the composer), never during the page's own load.
  let teleprompterWarmed = false;
  const warmTeleprompter = () => {
    if (teleprompterWarmed) return;
    teleprompterWarmed = true;
    // allSettled: the hero video is gated on the warm finishing (success or
    // not), so it starts downloading only once this critical path is done.
    Promise.allSettled([
      prefetchPageAssets('/teleprompter'),
      import('../teleprompter/teleprompter-overlay.ui.js').then((overlay) =>
        overlay.preloadTeleprompterOverlay(),
      ),
    ]).then(() => {
      if (heroVideo) heroVideo.onWarmSettled();
    });
  };
  // FCP/LCP of the home page win outright: the warm's chunk/markup fetches
  // must never contend with the critical paint. So the automatic warm is armed
  // only *after* the load event (past LCP in practice), then still waits for an
  // idle gap. The previous timeout-based scheduling could fire mid-load on slow
  // networks — exactly when it would hurt LCP most. User intent (focus/hover)
  // still warms immediately: at that point the user is about to open the studio.
  const scheduleIdleWarm = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(warmTeleprompter, { timeout: 3000 });
    } else {
      window.setTimeout(warmTeleprompter, 1500);
    }
  };
  if (document.readyState === 'complete') scheduleIdleWarm();
  else window.addEventListener('load', scheduleIdleWarm, { once: true });
  textarea.addEventListener('focus', warmTeleprompter, { once: true });
  textarea.addEventListener('pointerenter', warmTeleprompter, { once: true });

  const messages = {
    empty: form.dataset.msgEmpty || 'Add a script first.',
    read: form.dataset.msgRead || 'Could not read that file.',
  };

  const showError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
  };
  const clearError = () => {
    if (errorBox) errorBox.hidden = true;
  };

  const loadFileIntoTextarea = async (file) => {
    try {
      textarea.value = await readTextFile(file);
      textarea.focus();
      clearError();
    } catch {
      showError(messages.read);
    }
  };

  textarea.addEventListener('input', clearError);

  // Validate the script and open the teleprompter as an in-page overlay — no
  // navigation, so a warmed open is instant. The start button carries a
  // loading state for the cold-cache case where the chunk/markup still loads.
  let opening = false;
  const submitScript = async () => {
    if (opening) return;
    const result = startFromScript(textarea.value);
    if (!result.ok) {
      showError(messages.empty);
      textarea.focus();
      return;
    }
    opening = true;
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.classList.add('is-loading');
    }
    // Stop the hero video from buffering right when the overlay's own
    // downloads need the bandwidth most.
    if (heroVideo) heroVideo.onOverlayToggle(true);
    // Kick the markup fetch off now, in parallel with the JS chunks below —
    // fetchPageHtml memoizes in-flight, so the overlay's own call joins this
    // request instead of starting it only after the chunks finish. 'high'
    // priority: the user is waiting on this click, unlike the idle-time warm.
    fetchPageHtml('/teleprompter', { priority: 'high' });
    try {
      const { openTeleprompterOverlay } = await import(
        '../teleprompter/teleprompter-overlay.ui.js'
      );
      await openTeleprompterOverlay(result.workspace.id, {
        onClosed: () => {
          if (heroVideo) heroVideo.onOverlayToggle(false);
        },
      });
    } catch {
      // Overlay unavailable (chunk failed to load): fall back to navigation.
      window.location.href = `/teleprompter?ws=${encodeURIComponent(result.workspace.id)}`;
    } finally {
      opening = false;
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.classList.remove('is-loading');
      }
    }
  };

  textarea.addEventListener('paste', () => {
    // The pasted text only lands on the next tick.
    setTimeout(() => {
      submitScript();
    }, 0);
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    form.requestSubmit();
  });

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) await loadFileIntoTextarea(file);
      fileInput.value = '';
    });
  }

  // The overlay ships with the `hidden` attribute so it never flashes before
  // the JS-injected CSS applies. Styles are loaded by now, so hand visibility
  // over to the CSS opacity state (toggled per-drag via `is-active`).
  if (dragOverlay) dragOverlay.hidden = false;

  initFileDragDrop({
    onToggle: (active) => {
      if (!dragOverlay) return;
      dragOverlay.classList.toggle('is-active', active);
      dragOverlay.setAttribute('aria-hidden', String(!active));
    },
    onFile: loadFileIntoTextarea,
  });

  // Fires for the submit button and Enter (via requestSubmit).
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitScript();
  });
}
