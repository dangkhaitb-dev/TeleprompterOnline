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
    this.phrasesAtStart = this.phrases;
    queueMicrotask(() => this.onstart?.());
  }

  abort() {
    this.onend?.();
  }

  emitTranscript(transcript, { isFinal = false } = {}) {
    const result = {
      0: { transcript },
      isFinal,
      length: 1,
    };
    this.onresult?.({
      resultIndex: 0,
      results: [result],
    });
  }
}

describe('Voice Scroll browser integration', () => {
  let surface;
  let infoSpy;

  beforeEach(() => {
    FakeSpeechRecognition.instances = [];
    vi.stubGlobal('self', { webkitSpeechRecognition: FakeSpeechRecognition });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

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
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('starts recognition and dims words that the matcher has consumed', async () => {
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });

    await expect(voiceUI.start()).resolves.toBe(true);
    expect(voiceUI.isActive()).toBe(true);
    expect(FakeSpeechRecognition.instances).toHaveLength(1);

    FakeSpeechRecognition.instances[0].emitTranscript('Hôm nay tôi');

    const words = [...surface.querySelectorAll('.vs-w')];
    expect(words).toHaveLength(8);
    expect(words[0].classList.contains('vs-spoken')).toBe(true);
    expect(words[1].classList.contains('vs-spoken')).toBe(true);
    expect(words[2].classList.contains('vs-active')).toBe(true);
    expect(infoSpy).toHaveBeenCalledWith(
      '[VoiceScroll][ASR raw] interim #0',
      expect.objectContaining({
        transcript: 'Hôm nay tôi',
        confidence: 0,
        resultIndex: 0,
        resultCount: 1,
      })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[VoiceScroll] speech result',
      expect.objectContaining({
        transcript: 'Hôm nay tôi',
        interimTokens: 3,
      })
    );

    voiceUI.stop();
    expect(surface.querySelector('.vs-w')).toBeNull();
    expect(surface.textContent).toBe('Hôm nay tôi sẽ hướng dẫn các bạn');
  });

  it('adds opening script phrases to ASR before recognition starts', async () => {
    class FakeSpeechRecognitionPhrase {
      constructor(phrase, boost) {
        this.phrase = phrase;
        this.boost = boost;
      }
    }
    vi.stubGlobal('SpeechRecognitionPhrase', FakeSpeechRecognitionPhrase);
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });

    await expect(voiceUI.start()).resolves.toBe(true);
    const recognition = FakeSpeechRecognition.instances[0];

    expect(recognition.phrasesAtStart).toEqual([
      expect.objectContaining({
        phrase: 'Hôm nay tôi sẽ hướng dẫn',
        boost: 4,
      }),
      expect.objectContaining({
        phrase: 'sẽ hướng dẫn các bạn',
        boost: 4,
      }),
    ]);
    expect(infoSpy).toHaveBeenCalledWith(
      '[VoiceScroll] contextual hints applied',
      { count: 2, anchor: 0 }
    );
    voiceUI.stop();
  });

  it('propagates a fatal recognition error and restores the original surface', async () => {
    const onError = vi.fn();
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface, onError });
    await voiceUI.start();

    FakeSpeechRecognition.instances[0].onerror?.({ error: 'not-allowed' });
    FakeSpeechRecognition.instances[0].onend?.();

    expect(onError).toHaveBeenCalledWith('not-allowed');
    expect(voiceUI.isActive()).toBe(false);
    expect(surface.querySelector('.vs-w')).toBeNull();
    expect(surface.textContent).toBe('Hôm nay tôi sẽ hướng dẫn các bạn');
  });

  it('keeps listening when Chrome exposes phrases but rejects contextual biasing', async () => {
    const onError = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface, onError });
    await voiceUI.start();

    FakeSpeechRecognition.instances[0].onerror?.({ error: 'phrases-not-supported' });

    expect(onError).not.toHaveBeenCalled();
    expect(voiceUI.isActive()).toBe(true);
    expect(surface.querySelectorAll('.vs-w')).toHaveLength(8);
    expect(warnSpy).toHaveBeenCalledWith(
      '[VoiceScroll] contextual phrases unsupported; continuing without bias'
    );

    voiceUI.stop();
    warnSpy.mockRestore();
  });

  it('accepts final result index zero again after Chrome restarts recognition', async () => {
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    await voiceUI.start();
    const recognition = FakeSpeechRecognition.instances[0];

    recognition.emitTranscript('Hôm nay tôi', { isFinal: true });
    expect(surface.querySelector('.vs-active')?.textContent).toBe('tôi');

    recognition.onend?.();
    await new Promise((resolve) => setTimeout(resolve, 300));
    recognition.emitTranscript('sẽ hướng dẫn', { isFinal: true });

    expect(surface.querySelector('.vs-active')?.textContent).toBe('dẫn');
    voiceUI.stop();
  });

  it('stops an endless pre-audio abort loop and reports a busy recognizer', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface, onError });
    const startPromise = voiceUI.start();
    await vi.runAllTicks();
    await expect(startPromise).resolves.toBe(true);
    const recognition = FakeSpeechRecognition.instances[0];

    for (let attempt = 0; attempt < 2; attempt++) {
      recognition.onerror?.({ error: 'aborted' });
      recognition.onend?.();
      await vi.advanceTimersByTimeAsync((attempt + 1) * 500);
    }

    expect(onError).toHaveBeenCalledWith('recognizer-busy');
    expect(voiceUI.isActive()).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      '[VoiceScroll] recognition is busy or repeatedly aborted before audio capture'
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.useRealTimers();
  });
});
