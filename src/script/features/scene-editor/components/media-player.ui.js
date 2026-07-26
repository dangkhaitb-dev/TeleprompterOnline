import '../../../../styles/components/media-player.css';

const PLAY_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path fill="currentColor" d="m20.086 13.77-6.044 3.902c-.047 0-.047.053-.095.053l-6.044 3.9c-.285.215-.666.375-1.047.375-1 0-1.856-.909-1.856-2.084V4.045c0-.374.095-.695.238-1.016.523-.962 1.618-1.336 2.522-.748l6.14 3.955 6.091 3.954c.286.16.524.428.714.748.571 1.016.286 2.298-.619 2.832"></path>
  </svg>
`;

const PAUSE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <rect x="6" y="4" width="4" height="16" rx="1.5" fill="currentColor"/>
    <rect x="14" y="4" width="4" height="16" rx="1.5" fill="currentColor"/>
  </svg>
`;

const SPEAKER_ON_ICON = `
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 6.13521C12 5.28737 11.0111 4.82422 10.3598 5.36699L6 9.00017H5C3.34315 9.00017 2 10.3433 2 12.0002C2 13.657 3.34315 15.0002 5 15.0002H6L10.3598 18.6334C11.0111 19.1761 12 18.713 12 17.8651V6.13521Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M19.07 4.93018C20.9447 6.80545 21.9979 9.34853 21.9979 12.0002C21.9979 14.6518 20.9447 17.1949 19.07 19.0702M15.54 8.46018C16.4774 9.39781 17.004 10.6694 17.004 11.9952C17.004 13.321 16.4774 14.5925 15.54 15.5302" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
`;

const SPEAKER_MUTE_ICON = `
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 6.13521C12 5.28737 11.0111 4.82422 10.3598 5.36699L6 9.00017H5C3.34315 9.00017 2 10.3433 2 12.0002C2 13.657 3.34315 15.0002 5 15.0002H6L10.3598 18.6334C11.0111 19.1761 12 18.713 12 17.8651V6.13521Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M16 9.5L21 14.5M21 9.5L16 14.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
`;

function fmtTime(sec) {
  if (isNaN(sec) || !isFinite(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function createMediaPlayer({ signal }) {
  const el = document.createElement('div');
  el.className = 'se-media-controls';
  el.innerHTML = `
    <div class="se-media-progress">
      <div class="se-media-progress-track">
        <div class="se-media-progress-filled" style="width: 0%"></div>
      </div>
      <input type="range" class="se-media-progress-input" min="0" max="100" step="0.1" value="0">
    </div>
    <div class="se-media-bar">
      <button class="se-media-play-btn" type="button" aria-label="Play">
        ${PLAY_ICON}
      </button>
      <div class="se-media-volume">
        <button class="se-media-volume-btn" type="button" aria-label="Volume">
          ${SPEAKER_ON_ICON}
        </button>
        <div class="se-media-volume-slider-wrap">
          <div class="se-media-volume-track">
            <div class="se-media-volume-filled" style="width: calc(100% - 4px)"></div>
            <div class="se-media-volume-knob" style="left: calc(100% - 4px)"></div>
          </div>
          <input type="range" class="se-media-volume-input" min="0" max="100" step="1" value="100">
        </div>
      </div>
      <div class="se-media-time">
        <span class="se-media-time-current">00:00</span>
        <span class="se-media-time-sep">/</span>
        <span class="se-media-time-total">00:00</span>
      </div>
    </div>
  `;

  // Select DOM children
  const playBtn = el.querySelector('.se-media-play-btn');
  const progressInput = el.querySelector('.se-media-progress-input');
  const progressFilled = el.querySelector('.se-media-progress-filled');
  const volumeBtn = el.querySelector('.se-media-volume-btn');
  const volumeInput = el.querySelector('.se-media-volume-input');
  const volumeFilled = el.querySelector('.se-media-volume-filled');
  const volumeKnob = el.querySelector('.se-media-volume-knob');
  const timeCurrent = el.querySelector('.se-media-time-current');
  const timeTotal = el.querySelector('.se-media-time-total');

  let activeMedia = null;
  let isDraggingProgress = false;
  let hideTimer = null;
  let lastVolume = 1.0;
  let mediaClickTarget = null;
  let currentDuration = 0;
  let desiredVolume = 1.0;
  let needsAudioGain = false;
  let audioContext = null;
  let audioSource = null;
  let audioGain = null;

  function mediaAcceptsVolume(media) {
    const original = media.volume;
    const probe = original === 0.5 ? 0.25 : 0.5;
    try {
      media.volume = probe;
      const accepted = Math.abs(media.volume - probe) < 0.01;
      media.volume = original;
      return accepted;
    } catch {
      return false;
    }
  }

  // iOS keeps HTMLMediaElement.volume fixed at 1. Route audio through a gain
  // node when necessary so the custom slider still has a real effect.
  function ensureAudioGain() {
    if (!needsAudioGain || !activeMedia) return null;
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      try {
        audioContext = new AudioContextClass();
      } catch {
        return null;
      }
    }
    if (!audioSource) {
      try {
        const nextSource = audioContext.createMediaElementSource(activeMedia);
        const nextGain = audioContext.createGain();
        nextSource.connect(nextGain);
        nextGain.connect(audioContext.destination);
        audioSource = nextSource;
        audioGain = nextGain;
      } catch {
        return null;
      }
    }
    audioGain.gain.value = desiredVolume;
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioGain;
  }

  function applyVolume(volume) {
    desiredVolume = Math.max(0, Math.min(1, volume));
    if (needsAudioGain) {
      const gain = ensureAudioGain();
      if (gain) gain.gain.value = desiredVolume;
    } else if (activeMedia) {
      activeMedia.volume = desiredVolume;
    }
    updateVolumeState();
  }

  function getDuration() {
    if (currentDuration && isFinite(currentDuration) && currentDuration > 0) {
      return currentDuration;
    }
    if (activeMedia && activeMedia.duration && isFinite(activeMedia.duration)) {
      return activeMedia.duration;
    }
    return 0;
  }

  // Auto-hide controls handler
  function showControls() {
    el.classList.add('visible');
    clearTimeout(hideTimer);
    if (activeMedia && !activeMedia.paused && !isDraggingProgress) {
      hideTimer = setTimeout(() => {
        el.classList.remove('visible');
      }, 2500);
    }
  }

  // Keyboard shortcut listener (spacebar inside controls/viewer container)
  function handleKeyDown(e) {
    if (e.code === 'Space' && activeMedia) {
      // Prevent page scrolling
      e.preventDefault();
      togglePlay();
    }
  }

  function togglePlay() {
    if (!activeMedia) return;
    if (activeMedia.paused) {
      ensureAudioGain();
      activeMedia.play().catch(err => console.log('Playback failed:', err));
    } else {
      activeMedia.pause();
    }
    showControls();
  }

  function toggleMute() {
    if (!activeMedia) return;
    if (desiredVolume > 0) {
      lastVolume = desiredVolume;
      applyVolume(0);
    } else {
      applyVolume(lastVolume > 0.05 ? lastVolume : 1.0);
    }
    showControls();
  }

  // Update DOM representation of play state
  function updatePlayState() {
    if (!activeMedia) return;
    if (activeMedia.paused) {
      playBtn.innerHTML = PLAY_ICON;
    } else {
      playBtn.innerHTML = PAUSE_ICON;
    }
    showControls();
  }

  // Update volume controls
  function updateVolumeState() {
    if (!activeMedia) return;
    const vol = desiredVolume;
    volumeInput.value = Math.round(vol * 100);
    // Knob is 8px wide; inset its centre (and the fill's edge) by the 4px radius
    // so the knob stays inside the track and the fill ends exactly under it.
    const knobPos = `calc(4px + ${vol} * (100% - 8px))`;
    volumeFilled.style.width = knobPos;
    volumeKnob.style.left = knobPos;

    if (vol === 0) {
      volumeBtn.innerHTML = SPEAKER_MUTE_ICON;
    } else {
      volumeBtn.innerHTML = SPEAKER_ON_ICON;
    }
  }

  // Update progress bar & text
  function updateProgress() {
    if (!activeMedia || isDraggingProgress) return;
    const current = activeMedia.currentTime;
    const duration = getDuration();
    const pct = duration > 0 ? (current / duration) * 100 : 0;

    progressInput.value = pct.toFixed(1);
    progressFilled.style.width = `${pct}%`;
    timeCurrent.textContent = fmtTime(current);
  }

  // Event handlers for media element
  const mediaListeners = {
    play: () => {
      updatePlayState();
    },
    pause: () => {
      updatePlayState();
    },
    timeupdate: () => {
      updateProgress();
    },
    durationchange: () => {
      if (activeMedia && isFinite(activeMedia.duration) && activeMedia.duration > 0) {
        currentDuration = activeMedia.duration;
      }
      timeTotal.textContent = fmtTime(getDuration());
    },
    loadedmetadata: () => {
      if (activeMedia && isFinite(activeMedia.duration) && activeMedia.duration > 0) {
        currentDuration = activeMedia.duration;
      }
      timeTotal.textContent = fmtTime(getDuration());
      updateProgress();
    },
    volumechange: () => {
      updateVolumeState();
    },
    ended: () => {
      updatePlayState();
    }
  };

  // Wire up interface events
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  }, { signal });

  volumeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute();
  }, { signal });

  // Volume slider interaction
  volumeInput.addEventListener('input', (e) => {
    if (!activeMedia) return;
    applyVolume(parseFloat(e.target.value) / 100);
    showControls();
  }, { signal });

  // Progress seek slider interaction
  progressInput.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    isDraggingProgress = true;
  }, { signal });

  const stopDrag = () => {
    isDraggingProgress = false;
  };
  window.addEventListener('mouseup', stopDrag, { signal });
  window.addEventListener('touchend', stopDrag, { signal });
  window.addEventListener('pointerup', stopDrag, { signal });
  window.addEventListener('pointercancel', stopDrag, { signal });

  // Coalesce drag seeks to one currentTime write per frame — every assignment
  // cancels the in-flight decode, so per-event seeking churns the decoder.
  let pendingSeekTime = null;
  let seekRaf = 0;
  const requestSeek = (time) => {
    pendingSeekTime = time;
    if (seekRaf) return;
    seekRaf = requestAnimationFrame(() => {
      seekRaf = 0;
      if (activeMedia && pendingSeekTime != null) activeMedia.currentTime = pendingSeekTime;
      pendingSeekTime = null;
    });
  };
  signal?.addEventListener?.('abort', () => {
    if (seekRaf) cancelAnimationFrame(seekRaf);
    seekRaf = 0;
  });

  progressInput.addEventListener('input', (e) => {
    if (!activeMedia) return;
    const pct = parseFloat(e.target.value);
    progressFilled.style.width = `${pct}%`;
    const duration = getDuration();
    timeCurrent.textContent = fmtTime((pct / 100) * duration);
    // Safari on iOS does not consistently emit `change` after a range drag.
    // Seek during `input` so both touch and pointer interactions work.
    if (duration > 0) requestSeek((pct / 100) * duration);
  }, { signal });

  progressInput.addEventListener('change', (e) => {
    if (!activeMedia) {
      isDraggingProgress = false;
      return;
    }
    const pct = parseFloat(e.target.value);
    const duration = getDuration();
    activeMedia.currentTime = (pct / 100) * duration;
    isDraggingProgress = false;
    showControls();
  }, { signal });

  // Setup parent event hooks
  let parentEl = null;

  const handleMediaClick = (e) => {
    // Only toggle play if they clicked the media screen, not the controls themselves
    if (el.contains(e.target)) return;
    togglePlay();
  };

  return {
    el,
    attachMedia(mediaElement, fallbackDurationSec = null) {
      if (activeMedia) {
        this.detachMedia();
      }

      activeMedia = mediaElement;
      // Keep one control surface on every platform. Mixing iOS' native audio
      // controls with the custom overlay caused WebKit's control shadow tree
      // to sit underneath/inside the preview and made play/pause untappable.
      activeMedia.controls = false;
      activeMedia.playsInline = true;
      currentDuration = fallbackDurationSec || 0;
      desiredVolume = activeMedia.volume;
      needsAudioGain = activeMedia.tagName === 'AUDIO'
        && !mediaAcceptsVolume(activeMedia);
      el.hidden = false;

      // Setup listeners on media
      Object.entries(mediaListeners).forEach(([evt, listener]) => {
        activeMedia.addEventListener(evt, listener);
      });

      // Bind play/pause to clicking the media display itself
      if (activeMedia.tagName === 'VIDEO') {
        activeMedia.style.cursor = 'pointer';
        activeMedia.addEventListener('click', handleMediaClick);
        mediaClickTarget = activeMedia;
      } else {
        const audioWrap = activeMedia.closest('.se-audio-preview');
        if (audioWrap) {
          audioWrap.style.cursor = 'pointer';
          audioWrap.addEventListener('click', handleMediaClick);
          mediaClickTarget = audioWrap;
        }
      }

      // Synchronize states
      updatePlayState();
      updateVolumeState();
      timeTotal.textContent = fmtTime(getDuration());
      updateProgress();

      // Hook hover auto-hiding to the viewer container
      parentEl = activeMedia.closest('.se-viewer');
      if (parentEl) {
        parentEl.addEventListener('mousemove', showControls);
        parentEl.addEventListener('mouseleave', () => {
          if (activeMedia && !activeMedia.paused) {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
              el.classList.remove('visible');
            }, 1000);
          }
        });
        parentEl.addEventListener('keydown', handleKeyDown);
      }
      showControls();
    },

    detachMedia() {
      if (!activeMedia) return;

      Object.entries(mediaListeners).forEach(([evt, listener]) => {
        activeMedia.removeEventListener(evt, listener);
      });

      if (mediaClickTarget) {
        mediaClickTarget.removeEventListener('click', handleMediaClick);
        mediaClickTarget.style.cursor = '';
        mediaClickTarget = null;
      }

      if (parentEl) {
        parentEl.removeEventListener('mousemove', showControls);
        parentEl.removeEventListener('mouseleave', showControls);
        parentEl.removeEventListener('keydown', handleKeyDown);
      }

      activeMedia.controls = true; // Restore native controls
      if (audioSource) audioSource.disconnect();
      if (audioGain) audioGain.disconnect();
      audioSource = null;
      audioGain = null;
      activeMedia = null;
      el.hidden = false;
      parentEl = null;
      clearTimeout(hideTimer);
    },

    destroy() {
      this.detachMedia();
      if (audioContext) audioContext.close().catch(() => {});
      audioContext = null;
      el.remove();
    }
  };
}
