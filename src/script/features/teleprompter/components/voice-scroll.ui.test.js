// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initVoiceScrollUI, paintWords } from './voice-scroll.ui.js';

function setVisualRows(wordElements, rowIndexes) {
  wordElements.forEach((word, index) => {
    Object.defineProperty(word, 'offsetTop', {
      configurable: true,
      value: rowIndexes[index] * 40,
    });
  });
}

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

  emitTranscript(transcript, { isFinal = false, confidence = 0 } = {}) {
    const result = {
      0: { transcript, confidence },
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

  it('starts recognition and dims only rows the matcher has fully consumed', async () => {
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });

    await expect(voiceUI.start()).resolves.toBe(true);
    expect(voiceUI.isActive()).toBe(true);
    expect(FakeSpeechRecognition.instances).toHaveLength(1);

    const words = [...surface.querySelectorAll('.vs-w')];
    setVisualRows(words, [0, 0, 0, 1, 1, 1, 2, 2]);
    FakeSpeechRecognition.instances[0].emitTranscript('Hôm nay tôi sẽ');

    expect(words.every((word) => !word.classList.contains('vs-spoken'))).toBe(true);

    FakeSpeechRecognition.instances[0].emitTranscript('Hôm nay tôi sẽ');

    expect(words).toHaveLength(8);
    expect(words[0].classList.contains('vs-spoken')).toBe(true);
    expect(words[1].classList.contains('vs-spoken')).toBe(true);
    expect(words[2].classList.contains('vs-spoken')).toBe(true);
    expect(words[3].classList.contains('vs-spoken')).toBe(false);
    expect(words[4].classList.contains('vs-spoken')).toBe(false);
    expect(surface.querySelector('.vs-active')).toBeNull();
    expect(infoSpy).toHaveBeenCalledWith(
      '[VoiceScroll][ASR raw] interim #0',
      expect.objectContaining({
        transcript: 'Hôm nay tôi sẽ',
        confidence: 0,
        resultIndex: 0,
        resultCount: 1,
      })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[VoiceScroll] speech result',
      expect.objectContaining({
        transcript: 'Hôm nay tôi sẽ',
        interimTokens: 4,
        stableInterimTokens: 4,
      })
    );

    voiceUI.stop();
    expect(surface.querySelector('.vs-w')).toBeNull();
    expect(surface.textContent).toBe('Hôm nay tôi sẽ hướng dẫn các bạn');
  });

  it('uses the host eye-line instead of replacing it with the Auto fallback', async () => {
    const getReadingLineOffset = vi.fn(() => 72);
    const voiceUI = initVoiceScrollUI({
      getSurface: () => surface,
      getReadingLineOffset,
    });

    await expect(voiceUI.start()).resolves.toBe(true);

    expect(getReadingLineOffset).toHaveBeenCalledWith(surface);
    expect(surface.style.paddingTop).toBe('72px');

    voiceUI.stop();
  });

  it('preserves the Notch style wrapper and rich formatting while Auto is active', async () => {
    surface.innerHTML = [
      '<div class="notch-text" style="font-size: 32px; font-weight: 700; color: rgb(255, 255, 255); text-align: center;">',
      '<span class="emphasis" style="font-style: italic; text-decoration: underline;">Hôm nay</span>',
      ' tôi sẽ hướng dẫn các bạn',
      '</div>',
    ].join('');
    const originalHTML = surface.innerHTML;
    const notchText = surface.querySelector('.notch-text');
    const emphasis = surface.querySelector('.emphasis');
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });

    await expect(voiceUI.start()).resolves.toBe(true);

    expect(surface.querySelector('.notch-text')).toBe(notchText);
    expect(notchText.style.fontSize).toBe('32px');
    expect(notchText.style.fontWeight).toBe('700');
    expect(notchText.style.color).toBe('rgb(255, 255, 255)');
    expect(notchText.style.textAlign).toBe('center');
    expect(surface.querySelector('.emphasis')).toBe(emphasis);
    expect(emphasis.style.fontStyle).toBe('italic');
    expect(emphasis.style.textDecoration).toBe('underline');
    expect(emphasis.querySelectorAll('.vs-w')).toHaveLength(2);

    voiceUI.stop();
    expect(surface.innerHTML).toBe(originalHTML);
  });

  it('does not trust a first interim even when Chrome reports confidence one', async () => {
    surface.textContent = 'In the mid 20th century the first scuba system appeared';
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    await voiceUI.start();

    FakeSpeechRecognition.instances[0].emitTranscript(
      'In the mid 20th century the first scuba',
      { confidence: 1 }
    );

    const words = [...surface.querySelectorAll('.vs-w')];
    expect(words.every((word) => !word.classList.contains('vs-spoken'))).toBe(true);
    expect(infoSpy).toHaveBeenCalledWith(
      '[VoiceScroll][ASR raw] interim #0',
      expect.objectContaining({
        transcript: 'In the mid 20th century the first scuba',
        confidence: 1,
      })
    );

    voiceUI.stop();
  });

  it('does not let one long cumulative interim/final skip unread content', async () => {
    const scriptWords = Array.from({ length: 60 }, (_, index) => `keyword${index}`);
    const transcript = scriptWords.slice(0, 48).join(' ');
    const onTranscript = vi.fn();
    surface.textContent = scriptWords.join(' ');
    const voiceUI = initVoiceScrollUI({
      getSurface: () => surface,
      onTranscript,
    });
    await voiceUI.start();
    const words = [...surface.querySelectorAll('.vs-w')];
    setVisualRows(words, words.map((_, index) => index));
    const recognition = FakeSpeechRecognition.instances[0];

    // Chrome can repeat a large accumulated utterance as stable interim and
    // then final. It is one speech update, not permission to advance twice or
    // jump straight to the matching tail.
    recognition.emitTranscript(transcript);
    recognition.emitTranscript(transcript);
    const callsBeforeFinal = onTranscript.mock.calls.length;
    recognition.emitTranscript(transcript, { isFinal: true, confidence: 1 });

    const furthestSpoken = words.reduce(
      (last, word, index) => word.classList.contains('vs-spoken') ? index : last,
      -1
    );
    expect(furthestSpoken).toBeLessThan(8);
    expect(onTranscript).toHaveBeenCalledTimes(callsBeforeFinal);

    voiceUI.stop();
  });

  it('re-synchronizes after an intentional paragraph skip without the 8-word clamp', async () => {
    const opening = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    const skipped = Array.from({ length: 18 }, (_, index) => `skipped${index}`);
    const target = ['red', 'amber', 'cedar', 'maple', 'birch'];
    const scriptWords = [...opening, ...skipped, ...target];
    const onTranscript = vi.fn();
    surface.textContent = scriptWords.join(' ');
    const voiceUI = initVoiceScrollUI({
      getSurface: () => surface,
      onTranscript,
    });
    await voiceUI.start();
    const recognition = FakeSpeechRecognition.instances[0];
    const openingText = opening.join(' ');

    recognition.emitTranscript(openingText);
    recognition.emitTranscript(openingText);

    const firstRecoveryText = [...opening, ...target.slice(0, 4)].join(' ');
    recognition.emitTranscript(firstRecoveryText);
    recognition.emitTranscript(firstRecoveryText);

    const confirmedRecoveryText = [...opening, ...target].join(' ');
    recognition.emitTranscript(confirmedRecoveryText);
    recognition.emitTranscript(confirmedRecoveryText);

    expect(onTranscript).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: scriptWords.length - 1,
      matched: true,
    }));
    expect(infoSpy).toHaveBeenCalledWith(
      '[VoiceScroll] cursor matched',
      expect.objectContaining({
        previous: opening.length - 1,
        cursor: scriptWords.length - 1,
        sequentialRecovery: true,
      })
    );

    voiceUI.stop();
  });

  it('starts recognition without script hints that could seed hallucinations', async () => {
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

    expect(recognition.phrasesAtStart).toBeUndefined();
    expect(infoSpy).not.toHaveBeenCalledWith(
      '[VoiceScroll] contextual hints applied',
      expect.anything()
    );
    voiceUI.stop();
  });

  it('also starts English recognition without contextual hints', async () => {
    class FakeSpeechRecognitionPhrase {
      constructor(phrase, boost) {
        this.phrase = phrase;
        this.boost = boost;
      }
    }
    vi.stubGlobal('SpeechRecognitionPhrase', FakeSpeechRecognitionPhrase);
    surface.textContent = 'Today we are testing the Zephyron controller';
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });

    await expect(voiceUI.start()).resolves.toBe(true);
    const recognition = FakeSpeechRecognition.instances[0];

    expect(recognition.phrasesAtStart).toBeUndefined();
    expect(infoSpy).not.toHaveBeenCalledWith(
      '[VoiceScroll] contextual hints applied',
      expect.anything()
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
    let words = [...surface.querySelectorAll('.vs-w')];
    setVisualRows(words, [0, 0, 1, 1, 2, 2, 3, 3]);

    recognition.emitTranscript('Hôm nay tôi', { isFinal: true });
    expect(words[1].classList.contains('vs-spoken')).toBe(true);
    expect(words[2].classList.contains('vs-spoken')).toBe(false);

    recognition.onend?.();
    await new Promise((resolve) => setTimeout(resolve, 300));
    recognition.emitTranscript('sẽ hướng dẫn', { isFinal: true });

    words = [...surface.querySelectorAll('.vs-w')];
    expect(words[3].classList.contains('vs-spoken')).toBe(true);
    expect(words[4].classList.contains('vs-spoken')).toBe(false);
    expect(words[5].classList.contains('vs-spoken')).toBe(false);
    expect(surface.querySelector('.vs-active')).toBeNull();
    voiceUI.stop();
  });

  it('keeps a whole visual row clear until every word in it has been passed', () => {
    const line = document.createElement('p');
    const words = Array.from({ length: 6 }, (_, index) => {
      const el = document.createElement('span');
      line.appendChild(el);
      Object.defineProperty(el, 'offsetTop', {
        configurable: true,
        value: index < 3 ? 0 : 40,
      });
      return { el, trailingEls: [] };
    });

    paintWords(words, 2, -1);
    expect(words.slice(0, 3).every(
      (word) => !word.el.classList.contains('vs-spoken')
    )).toBe(true);

    paintWords(words, 3, 2);
    expect(words.slice(0, 3).every(
      (word) => word.el.classList.contains('vs-spoken')
    )).toBe(true);
    expect(words.slice(3).every(
      (word) => !word.el.classList.contains('vs-spoken')
    )).toBe(true);
  });

  it('restores the whole current row after recognition moves backward', () => {
    const line = document.createElement('p');
    const words = Array.from({ length: 8 }, () => {
      const el = document.createElement('span');
      const separator = document.createElement('span');
      line.appendChild(el);
      return { el, trailingEls: [separator] };
    });
    setVisualRows(words.map((word) => word.el), [0, 0, 1, 1, 2, 2, 3, 3]);

    paintWords(words, 6, -1);
    expect(words.slice(0, 6).every((word) => word.el.classList.contains('vs-spoken'))).toBe(true);
    expect(words.slice(0, 6).every(
      (word) => word.trailingEls[0].classList.contains('vs-spoken')
    )).toBe(true);

    paintWords(words, 2, 6);

    expect(words.slice(0, 2).every((word) => word.el.classList.contains('vs-spoken'))).toBe(true);
    expect(words.slice(2).every((word) => !word.el.classList.contains('vs-spoken'))).toBe(true);
    expect(words.slice(2).every(
      (word) => !word.trailingEls[0].classList.contains('vs-spoken')
    )).toBe(true);
    expect(words.every((word) => !word.el.classList.contains('vs-active'))).toBe(true);
  });

  it('dims punctuation together with the word that has been read', async () => {
    surface.textContent = 'Một, hai!';
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    await voiceUI.start();

    const words = [...surface.querySelectorAll('.vs-w')];
    setVisualRows(words, [0, 1]);
    FakeSpeechRecognition.instances[0].emitTranscript('Một hai', { isFinal: true });

    const separators = [...surface.querySelectorAll('.vs-separator')];
    const comma = separators.find((el) => el.textContent.includes(','));
    const exclamation = separators.find((el) => el.textContent.includes('!'));
    expect(comma.classList.contains('vs-spoken')).toBe(true);
    expect(exclamation.classList.contains('vs-spoken')).toBe(false);

    voiceUI.stop();
  });

  it('dims every complete row above a directly selected active row', async () => {
    const onTranscript = vi.fn();
    const voiceUI = initVoiceScrollUI({
      getSurface: () => surface,
      onTranscript,
    });
    await voiceUI.start();
    const words = [...surface.querySelectorAll('.vs-w')];
    setVisualRows(words, [0, 0, 5, 5, 10, 10, 15, 15]);
    words.forEach((word) => {
      Object.defineProperty(word, 'offsetHeight', {
        configurable: true,
        value: 20,
      });
    });
    vi.useFakeTimers();

    // Scrolling may change the matcher anchor, but must not dim anything.
    surface.scrollTop = 310;
    surface.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(180);
    expect(words.every((word) => !word.classList.contains('vs-spoken'))).toBe(true);

    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    expect(words[4].dispatchEvent(pointerDown)).toBe(false);

    words[4].dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));

    expect(words.slice(0, 4).every((word) => word.classList.contains('vs-spoken'))).toBe(true);
    expect(words.slice(4).every((word) => !word.classList.contains('vs-spoken'))).toBe(true);
    expect(words[4].classList.contains('vs-spoken')).toBe(false);
    expect(words[4].classList.contains('vs-active')).toBe(true);
    expect(words.filter((word) => word.classList.contains('vs-active'))).toHaveLength(1);

    words[6].dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
    expect(words[4].classList.contains('vs-active')).toBe(false);
    expect(words[6].classList.contains('vs-active')).toBe(true);
    expect(words.slice(0, 6).every((word) => word.classList.contains('vs-spoken'))).toBe(true);
    expect(words.slice(6).every((word) => !word.classList.contains('vs-spoken'))).toBe(true);

    await vi.advanceTimersByTimeAsync(700);
    expect(words[6].classList.contains('vs-active')).toBe(false);

    // Old recognition results must not pull the cursor behind the user's
    // explicit selection, even after the short in-flight result guard ends.
    FakeSpeechRecognition.instances[0].emitTranscript('Hôm nay tôi');
    FakeSpeechRecognition.instances[0].emitTranscript('Hôm nay tôi');
    expect(words.slice(0, 6).every((word) => word.classList.contains('vs-spoken'))).toBe(true);
    expect(words.slice(6).every((word) => !word.classList.contains('vs-spoken'))).toBe(true);
    expect(words[6].classList.contains('vs-spoken')).toBe(false);

    // A fresh local match from the selected anchor hands control back to ASR.
    FakeSpeechRecognition.instances[0].emitTranscript('các bạn', { isFinal: true });
    expect(onTranscript).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: 7,
      matched: true,
    }));
    expect(words[6].classList.contains('vs-spoken')).toBe(false);
    expect(words[7].classList.contains('vs-spoken')).toBe(false);
    vi.useRealTimers();

    voiceUI.stop();
  });

  it('allows an explicit word click to move the reading position backward', async () => {
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    await voiceUI.start();
    const words = [...surface.querySelectorAll('.vs-w')];
    setVisualRows(words, [0, 0, 1, 1, 2, 2, 3, 3]);

    FakeSpeechRecognition.instances[0].emitTranscript(
      'Hôm nay tôi sẽ hướng dẫn các bạn',
      { isFinal: true }
    );
    expect(words.slice(0, 6).every(
      (word) => word.classList.contains('vs-spoken')
    )).toBe(true);

    words[2].dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));

    expect(words[0].classList.contains('vs-spoken')).toBe(true);
    expect(words[1].classList.contains('vs-spoken')).toBe(true);
    expect(words.slice(2).every(
      (word) => !word.classList.contains('vs-spoken')
    )).toBe(true);
    expect(words[2].classList.contains('vs-active')).toBe(true);

    voiceUI.stop();
  });

  it('keeps consecutive word selections owned by one scroll loop in Record', async () => {
    const recordStage = document.createElement('div');
    const onRecordStageClick = vi.fn();
    recordStage.addEventListener('click', onRecordStageClick);
    recordStage.appendChild(surface);

    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    await voiceUI.start();
    const words = [...surface.querySelectorAll('.vs-w')];
    words.forEach((word, index) => {
      Object.defineProperty(word, 'offsetTop', {
        configurable: true,
        value: index * 120,
      });
      Object.defineProperty(word, 'offsetHeight', {
        configurable: true,
        value: 20,
      });
    });
    // Enabling Auto preserves the viewport and does not start a scroll loop.
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    words[4].dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
    words[6].dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));

    expect(words[4].classList.contains('vs-active')).toBe(false);
    expect(words[6].classList.contains('vs-active')).toBe(true);
    // The second click cancels the first click's frame before scheduling its
    // replacement. There is never more than one live scroll owner.
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(onRecordStageClick).not.toHaveBeenCalled();

    voiceUI.stop();
  });

  it('refreshes ASR contextual phrases at a directly selected word', async () => {
    class FakeSpeechRecognitionPhrase {
      constructor(phrase, boost) {
        this.phrase = phrase;
        this.boost = boost;
      }
    }
    vi.stubGlobal('SpeechRecognitionPhrase', FakeSpeechRecognitionPhrase);
    surface.textContent = Array.from(
      { length: 36 },
      (_, index) => `keyword${index}`
    ).join(' ');
    const voiceUI = initVoiceScrollUI({ getSurface: () => surface });
    await voiceUI.start();
    const recognition = FakeSpeechRecognition.instances[0];
    const words = [...surface.querySelectorAll('.vs-w')];

    expect(recognition.phrases).toBeUndefined();

    words[24].dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));

    expect(recognition.phrases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phrase: expect.stringContaining('keyword24'),
      }),
    ]));
    expect(infoSpy).toHaveBeenCalledWith(
      '[VoiceScroll] contextual hints applied',
      expect.objectContaining({ anchor: 24 })
    );

    voiceUI.stop();
  });

  it('keeps matching and dimming from the ASR cursor after manual scroll up or down', async () => {
    const onTranscript = vi.fn();
    const voiceUI = initVoiceScrollUI({
      getSurface: () => surface,
      onTranscript,
    });
    await voiceUI.start();
    const recognition = FakeSpeechRecognition.instances[0];
    const words = [...surface.querySelectorAll('.vs-w')];
    words.forEach((word, index) => {
      Object.defineProperty(word, 'offsetTop', {
        configurable: true,
        value: index * 120,
      });
      Object.defineProperty(word, 'offsetHeight', {
        configurable: true,
        value: 20,
      });
    });

    recognition.emitTranscript('Hôm nay tôi');
    recognition.emitTranscript('Hôm nay tôi');
    expect(words[0].classList.contains('vs-spoken')).toBe(true);
    expect(words[1].classList.contains('vs-spoken')).toBe(true);
    expect(words[2].classList.contains('vs-spoken')).toBe(false);

    // Looking elsewhere in the script must not reset the accumulated
    // transcript, move the matcher cursor, or replace contextual hints.
    surface.scrollTop = 620;
    surface.dispatchEvent(new Event('scroll'));
    expect(recognition.phrases).toBeUndefined();

    recognition.emitTranscript('Hôm nay tôi sẽ hướng dẫn');
    recognition.emitTranscript('Hôm nay tôi sẽ hướng dẫn');
    expect(words.slice(0, 5).every(
      (word) => word.classList.contains('vs-spoken')
    )).toBe(true);
    expect(words[5].classList.contains('vs-spoken')).toBe(false);
    expect(onTranscript).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: 5,
      matched: true,
    }));
    expect(surface.scrollTop).toBe(620);

    surface.scrollTop = 0;
    surface.dispatchEvent(new Event('scroll'));
    recognition.emitTranscript('Hôm nay tôi sẽ hướng dẫn các bạn');
    recognition.emitTranscript('Hôm nay tôi sẽ hướng dẫn các bạn');
    expect(words.slice(0, 7).every(
      (word) => word.classList.contains('vs-spoken')
    )).toBe(true);
    expect(words[7].classList.contains('vs-spoken')).toBe(false);
    expect(onTranscript).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: 7,
      matched: true,
    }));

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
