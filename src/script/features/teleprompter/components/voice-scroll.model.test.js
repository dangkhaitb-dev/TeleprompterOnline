import { describe, it, expect } from 'vitest';
import {
  normalize,
  segmentParts,
  buildIndices,
  feedTranscript,
  viKey,
  foldDiacritics,
} from './voice-scroll.model.js';

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
});
