import { describe, it, expect } from 'vitest';
import { bitrateForDimensions } from './camera-resolution.js';

describe('bitrateForDimensions', () => {
  it('picks the bitrate matching the captured resolution', () => {
    expect(bitrateForDimensions(1920, 1080)).toBe(8_000_000);
    expect(bitrateForDimensions(2560, 1440)).toBe(16_000_000);
    expect(bitrateForDimensions(3840, 2160)).toBe(40_000_000);
    expect(bitrateForDimensions(1280, 720)).toBe(5_000_000);
    expect(bitrateForDimensions(854, 480)).toBe(2_500_000);
  });

  it('clamps to the lowest rung below the smallest threshold', () => {
    expect(bitrateForDimensions(320, 240)).toBe(2_500_000);
  });

  it('falls back to the lowest rung for missing/invalid dimensions', () => {
    expect(bitrateForDimensions(undefined, undefined)).toBe(2_500_000);
  });
});
