// recording-preview.js — shared modal player for a recorded take. Plays a
// video/audio blob back in-place (instead of jumping to the teleprompter).
// Focus-trapped, Escape/backdrop/close-button = dismiss. One-shot: resolves and
// self-removes, revoking the object URL and pausing playback on close. Pages
// import styles/components/recording-preview.css.

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const AUDIO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>';

// opts = { title, badge, dateLabel, durationLabel, kind, blob, closeAria, container }
export function showRecordingPreview({
  title = '',
  badge = '',
  dateLabel = '',
  durationLabel = '',
  kind = 'video',
  blob = null,
  closeAria = 'Close',
  container = document.body,
} = {}) {
  return new Promise((resolve) => {
    if (!blob) {
      resolve(false);
      return;
    }
    const isAudio = kind === 'audio';
    const url = URL.createObjectURL(blob);

    const overlay = document.createElement('div');
    overlay.className = 'rec-preview-overlay';
    const meta = [badge, dateLabel, durationLabel].filter(Boolean).join(' · ');
    overlay.innerHTML = `
      <div class="rec-preview-box" role="dialog" aria-modal="true" aria-labelledby="rec-preview-title">
        <div class="rec-preview-head">
          <div class="rec-preview-heading">
            <h2 class="rec-preview-title" id="rec-preview-title"></h2>
            <p class="rec-preview-meta"></p>
          </div>
          <button class="rec-preview-close" type="button">${CLOSE_ICON}</button>
        </div>
        <div class="rec-preview-stage${isAudio ? ' is-audio' : ''}"></div>
      </div>`;
    overlay.querySelector('.rec-preview-title').textContent = title;
    overlay.querySelector('.rec-preview-meta').textContent = meta;
    const closeBtn = overlay.querySelector('.rec-preview-close');
    closeBtn.setAttribute('aria-label', closeAria);

    const stage = overlay.querySelector('.rec-preview-stage');
    let media;
    if (isAudio) {
      stage.innerHTML = `<span class="rec-preview-audio-icon" aria-hidden="true">${AUDIO_ICON}</span>`;
      media = document.createElement('audio');
      media.className = 'rec-preview-audio';
    } else {
      media = document.createElement('video');
      media.className = 'rec-preview-video';
      media.playsInline = true;
    }
    media.controls = true;
    media.autoplay = true;
    media.src = url;
    stage.appendChild(media);

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      try {
        media.pause();
      } catch {
        // pausing a not-yet-ready element can throw — safe to ignore on teardown
      }
      media.removeAttribute('src');
      URL.revokeObjectURL(url);
      overlay.remove();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      } else if (event.key === 'Tab') {
        trapFocus(event, [closeBtn, media]);
      }
    };

    closeBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target === overlay) close(false);
    });
    // Autoplay is best-effort — browsers may block it; controls stay available.
    media.addEventListener('canplay', () => {
      const attempt = media.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
    }, { once: true });
    document.addEventListener('keydown', onKey, true);

    container.appendChild(overlay);
    closeBtn.focus();
  });
}

function trapFocus(event, focusables) {
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
