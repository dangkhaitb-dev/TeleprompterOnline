// trim-timeline.ui.js — the whole .se-trim-editor: toolbar (cut/play/fullscreen),
// ruler, video frame strip / audio waveform canvas, shades, draggable selection
// + handles, playhead. Trim is metadata only; on drag-release it calls
// onCommit(startSec, endSec). Bounded playback (clamp media to [start,end]) is
// bound here against the host-supplied active media element.

import {
  formatPreciseTime, recordingBounds, computeRulerTicks, clampTrimStart, clampTrimEnd,
} from '../scene-editor.model.js';
import { extractVideoFrames } from '../media/thumbnails.js';
import {
  MIN_TRIM_SECONDS, EMPTY_TIMELINE_DURATION,
} from '../../../constants/media.js';
import { ICON_SCISSORS, ICON_FULL, ICON_PLAY_PAUSE, ICON_PLAYHEAD_FLAG } from './icons.js';

// Waveform peaks are decoded once per recording and cached — decoding runs at
// 8 kHz mono (PCM for a 30-min take ≈ 29 MB instead of ~345 MB at device
// rate), then collapses to a fixed bucket count (a few KB) for drawing.
const WAVEFORM_DECODE_RATE = 8000;
const WAVEFORM_PEAK_BUCKETS = 1000;
const waveformPeaksCache = new Map();

function peaksFromChannel(data, buckets) {
  const peaks = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(data.length / buckets));
  const stride = Math.max(1, Math.floor(step / 32));
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    let peak = 0;
    const offset = bucket * step;
    for (let sample = 0; sample < step; sample += stride) {
      peak = Math.max(peak, Math.abs(data[offset + sample] || 0));
    }
    peaks[bucket] = peak;
  }
  return peaks;
}

async function decodeWaveformPeaks(blob) {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (OfflineCtx) {
    try {
      const decoded = await new OfflineCtx(1, 1, WAVEFORM_DECODE_RATE)
        .decodeAudioData(await blob.arrayBuffer());
      return peaksFromChannel(decoded.getChannelData(0), WAVEFORM_PEAK_BUCKETS);
    } catch {
      // decodeAudioData detached that buffer — fall through and re-read.
    }
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();
  try {
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    return peaksFromChannel(decoded.getChannelData(0), WAVEFORM_PEAK_BUCKETS);
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function loadWaveformPeaks(recording) {
  const key = recording.id;
  if (key && waveformPeaksCache.has(key)) return waveformPeaksCache.get(key);
  const promise = decodeWaveformPeaks(recording.blob).catch(() => null);
  if (key) {
    waveformPeaksCache.set(key, promise);
    promise.then((peaks) => {
      if (!peaks) waveformPeaksCache.delete(key);
    });
  }
  return promise;
}

// createTrimTimeline({ signal, labels, onCommit, onFullscreen, onPlayToggle })
export function createTrimTimeline({ signal, labels = {}, onCommit, onFullscreen, onPlayToggle }) {
  let media = null;
  let recording = null;
  let duration = 0;
  let start = 0;
  let end = 0;
  let visualToken = 0;

  const el = document.createElement('section');
  el.className = 'se-trim-editor';
  el.hidden = true;
  el.setAttribute('aria-label', labels.trimMedia || 'Trim media');
  el.innerHTML = `
    <div class="se-trim-toolbar">
      <div class="se-trim-toolbar-left">
        <button class="se-trim-pill" type="button" data-role="cut" aria-expanded="false"
          aria-label="${labels.showTimeline || 'Show trim timeline'}">${ICON_SCISSORS}</button>
      </div>
      <div class="se-trim-toolbar-center">
        <button class="se-trim-play" type="button" data-role="play" aria-label="${labels.play || 'Play'}">${ICON_PLAY_PAUSE}</button>
        <div class="se-trim-time">
          <output class="se-trim-time-box" data-role="current">00:00.0</output>
          <span class="se-trim-time-sep">/</span>
          <output class="se-trim-time-box" data-role="total">00:00.0</output>
        </div>
      </div>
      <div class="se-trim-toolbar-right">
        <button class="se-trim-pill" type="button" data-role="fullscreen"
          aria-label="${labels.fullscreen || 'Fullscreen'}">${ICON_FULL}</button>
      </div>
    </div>
    <output class="se-sr-only" data-role="readout" aria-live="polite">00:00.0 — 00:00.0</output>
    <div class="se-trim-timeline-scroll" data-role="scroll">
      <div class="se-trim-timeline" data-role="timeline" aria-label="${labels.timeline || 'Media timeline'}">
        <div class="se-trim-ruler" data-role="ruler" aria-hidden="true"></div>
        <div class="se-trim-track" data-role="track">
          <div class="se-trim-visual" data-role="visual" aria-hidden="true"></div>
          <canvas class="se-trim-waveform" data-role="waveform" aria-hidden="true"></canvas>
          <span class="se-trim-shade left" data-role="shade-left"></span>
          <span class="se-trim-shade right" data-role="shade-right"></span>
          <span class="se-trim-selection" data-role="selection"></span>
          <button class="se-trim-handle start" type="button" data-role="handle-start"
            aria-label="${labels.trimStart || 'Trim start'}"></button>
          <button class="se-trim-handle end" type="button" data-role="handle-end"
            aria-label="${labels.trimEnd || 'Trim end'}"></button>
          <div class="se-trim-track-empty" data-role="track-empty" aria-hidden="true">
            <span>${labels.noMedia || 'No media yet'}</span>
          </div>
        </div>
        <span class="se-trim-playhead" data-role="playhead">${ICON_PLAYHEAD_FLAG}</span>
      </div>
    </div>`;

  const q = (role) => el.querySelector(`[data-role="${role}"]`);
  const scrollEl = q('scroll');
  const timelineEl = q('timeline');
  const rulerEl = q('ruler');
  const trackEl = q('track');
  const visualEl = q('visual');
  const waveformCanvas = q('waveform');
  const shadeLeft = q('shade-left');
  const shadeRight = q('shade-right');
  const selectionEl = q('selection');
  const startHandle = q('handle-start');
  const endHandle = q('handle-end');
  const playheadEl = q('playhead');
  const cutButton = q('cut');
  const playButton = q('play');
  const currentOut = q('current');
  const totalOut = q('total');
  const readoutOut = q('readout');

  // Scrub seeks are coalesced to one currentTime write per frame — every
  // assignment cancels the in-flight decode and restarts from the previous
  // keyframe, so pointer-rate seeking churns the decoder into jank.
  let pendingSeekTime = null;
  let seekRaf = 0;
  function requestSeek(time) {
    pendingSeekTime = time;
    if (seekRaf) return;
    seekRaf = requestAnimationFrame(() => {
      seekRaf = 0;
      if (media && pendingSeekTime != null) media.currentTime = pendingSeekTime;
      pendingSeekTime = null;
      updatePlayhead();
      updateControls();
    });
  }
  signal?.addEventListener?.('abort', () => {
    if (seekRaf) cancelAnimationFrame(seekRaf);
    seekRaf = 0;
  });

  // The track's own box doesn't move while handles/shades are restyled during
  // a drag — reading offsetLeft/clientWidth per pointermove right after those
  // style writes forces a reflow per event. Measure once, on layout changes.
  let trackMetrics = null;
  const measureTrack = () => {
    trackMetrics = { left: trackEl.offsetLeft, width: trackEl.clientWidth };
  };

  // --- UI updates ---------------------------------------------------------
  function updateTrimUi({ seek = false } = {}) {
    if (!duration) return;
    const startPct = (start / duration) * 100;
    const endPct = (end / duration) * 100;
    startHandle.style.left = `${startPct}%`;
    endHandle.style.left = `${endPct}%`;
    shadeLeft.style.width = `${startPct}%`;
    shadeRight.style.width = `${100 - endPct}%`;
    selectionEl.style.left = `${startPct}%`;
    selectionEl.style.width = `${endPct - startPct}%`;
    readoutOut.value = `${formatPreciseTime(start)} — ${formatPreciseTime(end)}  ·  ${formatPreciseTime(end - start)}`;
    startHandle.setAttribute('aria-valuetext', formatPreciseTime(start));
    endHandle.setAttribute('aria-valuetext', formatPreciseTime(end));
    if (seek && media) media.currentTime = start;
    updatePlayhead();
  }

  function updatePlayhead() {
    if (el.hidden || !duration) return;
    if (!trackMetrics) measureTrack();
    const current = Math.min(duration, Math.max(0, media?.currentTime || start));
    const position = trackMetrics.left + (current / duration) * trackMetrics.width;
    playheadEl.style.left = `${position}px`;
  }

  function updateControls() {
    const current = media?.currentTime || start || 0;
    const playing = Boolean(media && !media.paused);
    currentOut.value = formatPreciseTime(current);
    totalOut.value = formatPreciseTime(duration);
    playButton.classList.toggle('is-playing', playing);
    playButton.setAttribute('aria-label', playing ? (labels.pause || 'Pause') : (labels.play || 'Play'));
  }

  function renderRuler() {
    measureTrack();
    const nodes = computeRulerTicks(duration, trackEl.clientWidth).map((node) => {
      const span = document.createElement('span');
      if (node.type === 'label') {
        span.className = 'se-trim-ruler-label';
        if (node.edge) span.classList.add(node.edge);
        span.textContent = node.label;
      } else {
        span.className = 'se-trim-ruler-tick';
      }
      span.style.left = `${node.ratio * 100}%`;
      return span;
    });
    rulerEl.replaceChildren(...nodes);
  }

  // --- visual (frame strip / waveform) ------------------------------------
  async function renderVisual() {
    const token = ++visualToken;
    if (!recording) return;
    if (recording.kind === 'video') await drawFrames(token);
    else await drawWaveform(token);
  }

  async function drawFrames(token) {
    waveformCanvas.hidden = true;
    const frameCount = Math.max(6, Math.min(12, Math.round(trackEl.clientWidth / 105)));
    visualEl.style.setProperty('--se-trim-frame-count', String(frameCount));
    const placeholders = Array.from({ length: frameCount }, () => {
      const img = document.createElement('img');
      img.className = 'se-trim-frame';
      img.alt = '';
      return img;
    });
    visualEl.replaceChildren(...placeholders);
    const frames = await extractVideoFrames(
      recording.blob, frameCount, duration, () => token === visualToken,
    );
    if (token !== visualToken) return;
    frames.forEach((src, index) => { if (placeholders[index]) placeholders[index].src = src; });
  }

  async function drawWaveform(token) {
    visualEl.replaceChildren();
    visualEl.style.removeProperty('--se-trim-frame-count');
    waveformCanvas.hidden = false;
    const rect = trackEl.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    waveformCanvas.width = width;
    waveformCanvas.height = height;
    const context = waveformCanvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(el);
    context.fillStyle = styles.getPropertyValue('--se-waveform-canvas').trim() || '#5da42f';
    const amplitudeScale = 0.7;
    try {
      const peaks = await loadWaveformPeaks(recording);
      if (token !== visualToken) return;
      if (!peaks) throw new Error('waveform decode failed');
      const bars = Math.max(80, Math.floor(width / (5 * ratio)));
      const bucketsPerBar = Math.max(1, Math.floor(peaks.length / bars));
      const gap = Math.max(1, Math.round(2 * ratio));
      const barWidth = Math.max(1, width / bars - gap);
      for (let index = 0; index < bars; index += 1) {
        let peak = 0;
        const offset = index * bucketsPerBar;
        for (let bucket = 0; bucket < bucketsPerBar; bucket += 1) {
          peak = Math.max(peak, peaks[offset + bucket] || 0);
        }
        const barHeight = Math.max(3 * ratio, peak * height * amplitudeScale);
        context.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
      }
    } catch {
      const bars = 92;
      for (let index = 0; index < bars; index += 1) {
        const peak = 0.18 + Math.abs(Math.sin(index * 0.71) * Math.cos(index * 0.19)) * 0.58;
        const barHeight = peak * height * amplitudeScale;
        context.fillRect((index / bars) * width, (height - barHeight) / 2, Math.max(1, width / bars - 3 * ratio), barHeight);
      }
    }
  }

  // --- pointer / keyboard drag --------------------------------------------
  function timeFromPointer(event) {
    const rect = trackEl.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((event.clientX - rect.left) / rect.width) * duration));
  }

  function setFromPointer(event, edge) {
    const time = timeFromPointer(event);
    if (edge === 'start') {
      start = clampTrimStart(time, end);
      requestSeek(start);
    } else {
      end = clampTrimEnd(time, start, duration);
      requestSeek(Math.min(end, Math.max(start, end - 0.05)));
    }
    updateTrimUi();
  }

  function wireHandle(handle, edge) {
    handle.addEventListener('pointerdown', (event) => {
      if (!duration) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      setFromPointer(event, edge);
      const move = (moveEvent) => setFromPointer(moveEvent, edge);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        commit();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    }, { signal });

    handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = (event.key === 'ArrowLeft' ? -1 : 1) * Math.max(0.1, duration / 200);
      if (edge === 'start') {
        start = clampTrimStart(start + delta, end);
        requestSeek(start);
      } else {
        end = clampTrimEnd(end + delta, start, duration);
        requestSeek(end);
      }
      updateTrimUi();
      commit();
    }, { signal });
  }

  function wireSelectionDrag() {
    selectionEl.addEventListener('pointerdown', (event) => {
      if (!duration || !media) return;
      event.preventDefault();
      event.stopPropagation();
      selectionEl.setPointerCapture(event.pointerId);
      selectionEl.classList.add('dragging');
      const rect = trackEl.getBoundingClientRect();
      const startClientX = event.clientX;
      const originStart = start;
      const span = end - start;
      seekFromPointer(event);
      const move = (moveEvent) => {
        const deltaTime = ((moveEvent.clientX - startClientX) / rect.width) * duration;
        const newStart = Math.max(0, Math.min(originStart + deltaTime, duration - span));
        start = newStart;
        end = newStart + span;
        requestSeek(start);
        updateTrimUi();
      };
      const up = () => {
        selectionEl.removeEventListener('pointermove', move);
        selectionEl.removeEventListener('pointerup', up);
        selectionEl.removeEventListener('pointercancel', up);
        selectionEl.classList.remove('dragging');
        commit();
      };
      selectionEl.addEventListener('pointermove', move);
      selectionEl.addEventListener('pointerup', up);
      selectionEl.addEventListener('pointercancel', up);
    }, { signal });
  }

  function seekFromPointer(event) {
    if (!media || !duration) return;
    const rect = trackEl.getBoundingClientRect();
    const time = Math.min(end, Math.max(start, ((event.clientX - rect.left) / rect.width) * duration));
    requestSeek(time);
  }

  timelineEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.se-trim-handle') || event.target.closest('.se-trim-selection')) return;
    if (!duration || !media) return;
    event.preventDefault();
    timelineEl.setPointerCapture(event.pointerId);
    seekFromPointer(event);
    const move = (moveEvent) => seekFromPointer(moveEvent);
    const up = () => {
      timelineEl.removeEventListener('pointermove', move);
      timelineEl.removeEventListener('pointerup', up);
      timelineEl.removeEventListener('pointercancel', up);
    };
    timelineEl.addEventListener('pointermove', move);
    timelineEl.addEventListener('pointerup', up);
    timelineEl.addEventListener('pointercancel', up);
  }, { signal });

  wireHandle(startHandle, 'start');
  wireHandle(endHandle, 'end');
  wireSelectionDrag();

  function commit() { onCommit?.(start, end); }

  // --- toolbar ------------------------------------------------------------
  cutButton.addEventListener('click', () => {
    const open = scrollEl.classList.toggle('open');
    cutButton.setAttribute('aria-expanded', String(open));
    cutButton.setAttribute('aria-label', open ? (labels.hideTimeline || 'Hide trim timeline') : (labels.showTimeline || 'Show trim timeline'));
    if (open) { updateTrimUi(); renderRuler(); renderVisual(); }
  }, { signal });
  playButton.addEventListener('click', () => onPlayToggle?.(), { signal });
  el.querySelector('[data-role="fullscreen"]').addEventListener('click', () => onFullscreen?.(), { signal });

  // --- bounded-playback bridge (host calls these on media events) ---------
  function currentBounds() {
    return el.hidden ? recordingBounds(recording, media?.duration || 0) : { start, end };
  }

  function onMediaTimeupdate() {
    const bounds = currentBounds();
    if (!media) return;
    if (media.currentTime < bounds.start - 0.05) media.currentTime = bounds.start;
    if (media.currentTime >= bounds.end - 0.02) {
      media.pause();
      media.currentTime = bounds.start;
    }
    updatePlayhead();
    updateControls();
  }

  function onMediaPlay() {
    const bounds = currentBounds();
    if (media && (media.currentTime < bounds.start || media.currentTime >= bounds.end - 0.02)) {
      media.currentTime = bounds.start;
    }
    updateControls();
  }

  function onMediaLoaded() {
    const bounds = recordingBounds(recording, media?.duration || 0);
    if (bounds.start > 0 && media && media.currentTime < bounds.start) media.currentTime = bounds.start;
    if (!el.hidden) {
      duration = bounds.duration;
      end = Math.min(end || duration, duration);
      updateTrimUi();
    }
    updateControls();
  }

  // --- public API ---------------------------------------------------------
  // Open the editor for a real recording + its (loaded or loading) media el.
  function open(activeRecording, activeMedia) {
    recording = activeRecording;
    media = activeMedia;
    el.hidden = false;
    el.classList.remove('is-empty');
    cutButton.disabled = false;
    playButton.disabled = false;
    const bounds = recordingBounds(recording, media?.duration || 0);
    duration = bounds.duration;
    start = bounds.start;
    end = bounds.end;
    [startHandle, endHandle].forEach((handle) => {
      handle.setAttribute('role', 'slider');
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', String(duration));
    });
    updateTrimUi({ seek: true });
    updateControls();
    renderRuler();
    renderVisual();
  }

  // Disabled placeholder state for an empty scene.
  function openEmpty() {
    recording = null;
    media = null;
    el.hidden = false;
    el.classList.add('is-empty');
    scrollEl.classList.add('open');
    cutButton.disabled = true;
    cutButton.setAttribute('aria-expanded', 'true');
    playButton.disabled = true;
    playButton.classList.remove('is-playing');
    playButton.setAttribute('aria-label', labels.play || 'Play');
    visualEl.replaceChildren();
    visualEl.style.removeProperty('--se-trim-frame-count');
    waveformCanvas.hidden = true;
    currentOut.value = '00:00.0';
    totalOut.value = '00:00.0';
    duration = EMPTY_TIMELINE_DURATION;
    renderRuler();
    duration = 0;
  }

  function close() {
    visualToken += 1;
    el.hidden = true;
    media = null;
    recording = null;
  }

  return {
    el,
    open,
    openEmpty,
    close,
    onMediaTimeupdate,
    onMediaPlay,
    onMediaLoaded,
    onMediaPause: updateControls,
    MIN_TRIM: MIN_TRIM_SECONDS,
  };
}
