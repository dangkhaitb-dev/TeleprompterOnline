// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initVoiceScrollUI } from './voice-scroll.ui.js';

class FakeSpeechRecognition {
  static instances = [];

  constructor() {
    FakeSpeechRecognition.instances.push(this);
    this.continuous = false;
    this.interimResults = false;
    this.lang = '';
  }

  start() {
    queueMicrotask(() => this.onstart?.());
  }

  abort() {
    this.onend?.();
  }

  emitTranscript(transcript, { isFinal = false, confidence = 0 } = {}) {
    const result = {
      0: { transcript, confidence },
      isFinal,
      length: 1,
    };
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}

function setWordGeometry(words, spacing) {
  words.forEach((word, index) => {
    Object.defineProperty(word, 'offsetTop', {
      configurable: true,
      value: index * spacing,
    });
    Object.defineProperty(word, 'offsetHeight', {
      configurable: true,
      value: 20,
    });
  });
}

function installFrameQueue() {
  const frames = new Map();
  let nextFrameId = 1;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
  return frames;
}

async function runFramesUntil(frames, predicate, limit = 220, startingAt = 0) {
  let frameTime = startingAt;
  for (let frame = 0; frame < limit && !predicate(); frame++) {
    const next = frames.entries().next().value;
    expect(next).toBeDefined();
    const [id, callback] = next;
    frames.delete(id);
    callback(frameTime);
    frameTime += 16;
    await vi.advanceTimersByTimeAsync(16);
  }
  return frameTime;
}

describe('Voice Scroll timed fallback', () => {
  let surface;
  let infoSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    FakeSpeechRecognition.instances = [];
    vi.stubGlobal('self', { webkitSpeechRecognition: FakeSpeechRecognition });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    surface = document.createElement('div');
    surface.textContent = 'Hôm nay tôi sẽ hướng dẫn các bạn';
    Object.defineProperty(surface, 'innerText', {
      configurable: true,
      get() { return this.textContent; },
      set(value) { this.textContent = value; },
    });
    Object.defineProperty(surface, 'clientHeight', { configurable: true, value: 300 });
    document.body.appendChild(surface);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('keeps moving after repeated browser-service network failures', async () => {
    vi.useFakeTimers();
    surface.textContent = Array.from({ length: 16 }, (_, index) => `keyword${index}`).join(' ');
    class DownloadingSpeechRecognition extends FakeSpeechRecognition {}
    Object.defineProperty(DownloadingSpeechRecognition.prototype, 'processLocally', {
      configurable: true,
      writable: true,
      value: false,
    });
    DownloadingSpeechRecognition.available = vi.fn().mockResolvedValue('downloading');
    DownloadingSpeechRecognition.install = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('self', { SpeechRecognition: DownloadingSpeechRecognition });
    const frames = installFrameQueue();
    const onError = vi.fn();
    const onTranscript = vi.fn();
    const onDiagnostic = vi.fn();
    surface.scrollTop = 400;

    const voiceUI = initVoiceScrollUI({
      getSurface: () => surface,
      onError,
      onTranscript,
      onDiagnostic,
    });
    const startPromise = voiceUI.start();
    await vi.runAllTicks();
    await expect(startPromise).resolves.toBe(true);
    const recognition = FakeSpeechRecognition.instances[0];
    const words = [...surface.querySelectorAll('.vs-w')];
    setWordGeometry(words, 120);

    recognition.onerror?.({ error: 'network' });
    recognition.onend?.();
    await vi.advanceTimersByTimeAsync(250);
    recognition.onerror?.({ error: 'network' });

    expect(onError).not.toHaveBeenCalled();
    expect(voiceUI.isActive()).toBe(true);
    expect(recognition.processLocally).toBe(false);
    expect(frames.size).toBeGreaterThan(0);
    expect(onDiagnostic).toHaveBeenCalledWith('asr-timed-fallback-active', {
      reason: 'network',
      asrMode: 'browser-service',
      asrFailureCount: 2,
    });

    await vi.advanceTimersByTimeAsync(600);
    let frameTime = await runFramesUntil(frames, () => surface.scrollTop > 400, 90, 1000);
    expect(surface.scrollTop).toBeGreaterThan(400);

    recognition.emitTranscript('keyword0 keyword1 keyword2 keyword3');
    recognition.emitTranscript('keyword0 keyword1 keyword2 keyword3');
    expect(onTranscript).toHaveBeenLastCalledWith(expect.objectContaining({
      matched: true,
      cursor: 3,
    }));
    expect(words.every((word) => !word.classList.contains('vs-spoken'))).toBe(true);

    // A recovered transcript can trail the timed position. It must not steal
    // scroll ownership until speech catches up.
    const scrollAfterDelayedTranscript = surface.scrollTop;
    await vi.advanceTimersByTimeAsync(700);
    frameTime = await runFramesUntil(
      frames,
      () => surface.scrollTop > scrollAfterDelayedTranscript,
      120,
      frameTime,
    );
    expect(frameTime).toBeGreaterThan(1000);
    expect(surface.scrollTop).toBeGreaterThan(scrollAfterDelayedTranscript);

    const caughtUpTranscript = Array.from(
      { length: 10 },
      (_, index) => `keyword${index}`,
    ).join(' ');
    recognition.emitTranscript(caughtUpTranscript);
    recognition.emitTranscript(caughtUpTranscript);
    expect(onTranscript).toHaveBeenLastCalledWith(expect.objectContaining({
      matched: true,
      cursor: 9,
    }));
    expect(words.slice(0, 9).every((word) => word.classList.contains('vs-spoken')))
      .toBe(true);

    // Once ASR catches the timed cursor it owns scrolling again. A manual
    // viewport change now pauses optimistic creep as normal instead of being
    // adopted by a still-running timed fallback.
    surface.scrollTop = 100;
    surface.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(1000);
    await runFramesUntil(frames, () => frames.size === 0, 80, frameTime);
    expect(frames.size).toBe(0);
    expect(surface.scrollTop).toBe(100);

    voiceUI.stop();
  });

  it('does not start while the reader is simply silent', async () => {
    vi.useFakeTimers();
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    const startPromise = voiceUI.start();
    await vi.runAllTicks();
    await expect(startPromise).resolves.toBe(true);
    const recognition = FakeSpeechRecognition.instances[0];

    for (let attempt = 0; attempt < 2; attempt++) {
      recognition.onerror?.({ error: 'no-speech' });
      recognition.onend?.();
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(requestFrame).not.toHaveBeenCalled();
    expect(surface.scrollTop).toBe(0);
    voiceUI.stop();
  });

  it('starts after repeated speech sessions return no transcript', async () => {
    vi.useFakeTimers();
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    const startPromise = voiceUI.start();
    await vi.runAllTicks();
    await expect(startPromise).resolves.toBe(true);
    const recognition = FakeSpeechRecognition.instances[0];

    for (let attempt = 0; attempt < 2; attempt++) {
      recognition.onaudiostart?.();
      recognition.onsoundstart?.();
      recognition.onspeechstart?.();
      recognition.onend?.();
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(requestFrame).toHaveBeenCalled();
    expect(voiceUI.isActive()).toBe(true);
    voiceUI.stop();
  });

  it('keeps Auto available when Web Speech is unsupported', async () => {
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('self', {});
    const onError = vi.fn();
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface, onError });

    await expect(voiceUI.start()).resolves.toBe(true);

    expect(voiceUI.isActive()).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(requestFrame).toHaveBeenCalled();
    voiceUI.stop();
  });

  it('falls back to timed scrolling when another recorder owns the microphone', async () => {
    class BusyMicrophoneRecognition extends FakeSpeechRecognition {
      start() {
        queueMicrotask(() => this.onerror?.({ error: 'audio-capture' }));
      }
    }
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('self', { webkitSpeechRecognition: BusyMicrophoneRecognition });
    const onError = vi.fn();
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface, onError });

    await expect(voiceUI.start()).resolves.toBe(true);

    expect(voiceUI.isActive()).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(requestFrame).toHaveBeenCalled();
    voiceUI.stop();
  });

  it('continues after a direct word selection', async () => {
    vi.useFakeTimers();
    surface.textContent = Array.from({ length: 24 }, (_, index) => `word${index}`).join(' ');
    vi.stubGlobal('self', {});
    const frames = installFrameQueue();
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    await expect(voiceUI.start()).resolves.toBe(true);
    const words = [...surface.querySelectorAll('.vs-w')];
    setWordGeometry(words, 120);

    words[10].dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
    const selectedTarget = 1110;
    await runFramesUntil(frames, () => surface.scrollTop > selectedTarget);

    expect(surface.scrollTop).toBeGreaterThan(selectedTarget);
    expect(voiceUI.isActive()).toBe(true);
    voiceUI.stop();
  });

  it('continues from a manual position and retires at the final word', async () => {
    vi.useFakeTimers();
    surface.textContent = Array.from({ length: 20 }, (_, index) => `word${index}`).join(' ');
    vi.stubGlobal('self', {});
    const frames = installFrameQueue();
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    await expect(voiceUI.start()).resolves.toBe(true);
    const words = [...surface.querySelectorAll('.vs-w')];
    setWordGeometry(words, 120);

    surface.scrollTop = 900;
    surface.dispatchEvent(new Event('scroll'));
    let frameTime = await runFramesUntil(frames, () => surface.scrollTop > 900);
    expect(surface.scrollTop).toBeGreaterThan(900);

    surface.scrollTop = 150;
    surface.dispatchEvent(new Event('scroll'));
    frameTime = await runFramesUntil(frames, () => surface.scrollTop > 150, 220, frameTime);
    expect(surface.scrollTop).toBeGreaterThan(150);
    expect(surface.scrollTop).toBeLessThan(900);

    surface.scrollTop = 5000;
    surface.dispatchEvent(new Event('scroll'));
    frameTime = await runFramesUntil(frames, () => frames.size === 0, 20, frameTime);
    expect(frameTime).toBeGreaterThan(0);
    expect(frames.size).toBe(0);
    voiceUI.stop();
  });
});
