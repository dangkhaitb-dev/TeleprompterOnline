import { describe, it, expect } from 'vitest';
import {
  normalize,
  segmentParts,
  buildIndices,
  feedTranscript,
  viKey,
  foldDiacritics,
  createPIDController,
} from './voice-scroll.model.js';

function createMatcherState(script, cursor = -1) {
  const words = segmentParts(script).filter((part) => part.isWord).map((part) => {
    const norm = normalize(part.text);
    return {
      raw: part.text,
      norm,
      fold: foldDiacritics(norm),
      vkey: viKey(norm),
      breakAfter: false,
    };
  });

  return {
    words,
    ...buildIndices(words),
    cursor,
    displayIndex: cursor,
    creepIndex: cursor,
    curDrift: 0,
    stallRuns: 0,
    forcedRun: 0,
    pendingTokens: 0,
    missStreak: 0,
    lastFeedStreamLen: 0,
    lastMatchStreamLen: 0,
    lastGlobalAt: 0,
    lastMatch: null,
    feedTailPartial: false,
  };
}

describe('Voice Scroll Model matching algorithm', () => {
  it('normalizes script and spoken words correctly', () => {
    expect(normalize('Học!')).toBe('học');
    expect(normalize('1st')).toBe('1');
    expect(normalize('first')).toBe('1');
    expect(normalize('một')).toBe('1');
    expect(normalize('uhm')).toBe('uhm');
  });

  it('computes phonetic keys for Vietnamese words correctly', () => {
    // gi, r, d -> z
    expect(viKey('gì')).toBe('zi');
    expect(viKey('rồi')).toBe('zôi');
    expect(viKey('đi')).toBe('di');
    
    // ch, tr -> c
    expect(viKey('chạy')).toBe('cai');
    expect(viKey('trên')).toBe('cên');
  });

  it('runs the DP matcher and advances cursor step-by-step', () => {
    const script = 'Hôm nay tôi sẽ hướng dẫn các bạn tích hợp tính năng tự động cuộn';
    
    // 1. Tokenize script words
    const parts = segmentParts(script);
    const words = parts.filter(p => p.isWord).map(p => {
      const norm = normalize(p.text);
      return {
        raw: p.text,
        norm,
        fold: foldDiacritics(norm),
        vkey: viKey(norm),
        breakAfter: false
      };
    });

    console.log('\n--- SCRIPT WORDS ---');
    console.log(words.map((w, i) => `#${i}: ${w.raw} (norm: ${w.norm}, key: ${w.vkey})`).join('\n'));

    // 2. Build indices
    const indices = buildIndices(words);
    
    let state = {
      words,
      ...indices,
      cursor: -1,
      displayIndex: -1,
      creepIndex: -1,
      curDrift: 0,
      stallRuns: 0,
      forcedRun: 0,
      pendingTokens: 0,
      missStreak: 0,
      lastFeedStreamLen: 0,
      lastMatchStreamLen: 0,
      lastGlobalAt: 0,
      lastMatch: null,
      feedTailPartial: false,
    };

    // Helper to simulate speech recognition event
    function speak(spokenPhrase, stateObj) {
      const tokens = spokenPhrase.split(' ').map(w => normalize(w));
      const reach = tokens.length;
      
      console.log(`\nSPEAKING: "${spokenPhrase}" (tokens: ${tokens.join(', ')})`);
      const nextState = feedTranscript(tokens, reach, false, stateObj);
      
      if (nextState.lastMatch && nextState.lastMatch.end !== null) {
        const m = nextState.lastMatch;
        console.log(` MATCH SUCCESS!`);
        console.log(`   Cursor advanced to #${m.end}: "${words[m.end].raw}"`);
        console.log(`   Similarity Score: ${(m.sim * 100).toFixed(1)}%`);
        console.log(`    DP Distance: ${m.dist}`);
      } else {
        console.log(`  MATCH FAILED! (Cursor stayed at #${stateObj.cursor})`);
      }
      return nextState;
    }

    // Step 1: Speak first 3 words
    state = speak('hôm nay tôi', state);
    expect(state.cursor).toBe(2); // Should match "tôi" at index 2

    // Step 2: Speak next 3 words (with slight variation or typo)
    state = speak('hôm nay tôi sẻ hướng dẩn', state);
    expect(state.cursor).toBe(5); // Should match "dẫn" (dẫn/dẩn with tone fold) at index 5

    // Step 3: Speak rest of the sentence
    state = speak('sẽ hướng dẫn các bạn tich hợp tính năng tự động cuộn', state);
    expect(state.cursor).toBe(14); // Should match "cuộn" at index 14
  });

  it('does not activate from unrelated noise transcripts', () => {
    let state = createMatcherState(
      'Hôm nay chúng ta thử nghiệm bộ điều khiển camera và tự động cuộn nội dung'
    );
    const noiseTokens = ['zzzz', 'xxxx', 'qqqq', 'vvvv', 'bbbb', 'kkkk'];

    for (let length = 1; length <= noiseTokens.length; length++) {
      state = feedTranscript(noiseTokens.slice(0, length), length, true, state);
      expect(state.cursor).toBe(-1);
    }
  });

  it('requires more than one incidental script word before the first match', () => {
    const state = createMatcherState(
      'Hôm nay tôi sẽ hướng dẫn các bạn tích hợp tính năng tự động cuộn'
    );

    const next = feedTranscript(['tôi'], 1, true, state);

    expect(next.cursor).toBe(-1);
  });

  it('ignores off-script speech even when it contains common script words', () => {
    let state = createMatcherState(
      'Hôm nay tôi sẽ hướng dẫn các bạn tích hợp tính năng tự động cuộn nội dung'
    );
    const offScript = 'Tôi đổi chủ đề và sẽ nói về thời tiết âm nhạc cuối tuần'
      .split(' ')
      .map((word) => normalize(word));

    for (let length = 1; length <= offScript.length; length++) {
      state = feedTranscript(offScript.slice(0, length), length, true, state);
    }

    expect(state.cursor).toBe(-1);
  });

  it('never lets recognition move behind a cursor that has already passed', () => {
    const scriptWords = [
      'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
      'india', 'juliett', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
      'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
      'xray', 'yankee', 'zulu',
    ];
    const script = scriptWords.join(' ');
    const state = {
      ...createMatcherState(script, 25),
      missStreak: 1,
      now: 1000,
    };
    const oldParagraph = scriptWords.slice(0, 6);

    const next = feedTranscript(oldParagraph, oldParagraph.length, false, state);

    expect(next.cursor).toBe(25);
  });
});

describe('Voice Scroll PID animation', () => {
  it('eases into the first auto-scroll without alternating fast and slow frames', () => {
    const pid = createPIDController();
    pid.setTarget(600, true, 0);
    pid.tick(0);

    const positions = [];
    for (let frame = 1; frame <= 12; frame++) {
      positions.push(pid.tick(frame * 16).position);
    }
    const deltas = positions.map((position, index) => (
      position - (index === 0 ? 0 : positions[index - 1])
    ));

    expect(deltas.every((delta) => delta > 0)).toBe(true);
    expect(deltas[1]).toBeGreaterThan(deltas[0]);
    expect(Math.max(...deltas) / Math.min(...deltas)).toBeLessThan(4);
  });

  it('animates smoothly when recognition re-anchors to an earlier paragraph', () => {
    const pid = createPIDController();
    pid.setTarget(100, true, 600);
    pid.tick(0);

    const firstAnimatedFrame = pid.tick(16);

    expect(firstAnimatedFrame.settled).toBe(false);
    expect(firstAnimatedFrame.position).toBeLessThan(600);
    expect(firstAnimatedFrame.position).toBeGreaterThan(100);
  });

  it('starts a distant target from a fresh frame after waiting while settled', () => {
    const pid = createPIDController();
    pid.setTarget(400);
    pid.tick(0);

    let timestamp = 0;
    let result;
    for (let frame = 1; frame < 1000; frame++) {
      timestamp = frame * 16;
      result = pid.tick(timestamp);
      if (result.settled) break;
    }

    expect(result.settled).toBe(true);
    const settledPosition = pid.current();

    // Simulate the reader pausing before recognition jumps from an early
    // paragraph to a much later one.
    pid.setTarget(2400);
    const resumed = pid.tick(timestamp + 5000);
    const nextFrame = pid.tick(timestamp + 5016);

    expect(resumed.position).toBeCloseTo(settledPosition);
    expect(nextFrame.position).toBeGreaterThan(settledPosition);
    expect(nextFrame.position).toBeLessThan(settledPosition + 100);
    expect(nextFrame.position).toBeLessThan(2400);
  });
});
