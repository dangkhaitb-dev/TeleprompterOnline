// teleprompter.model.test.js — unit tests for the pure per-script settings
// normaliser. No DOM; runs under vitest's node environment.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  WPM_DEFAULT,
  WPM_MIN,
  WPM_MAX,
  SCROLL_DURATION_DEFAULT,
  SCROLL_DURATION_MAX,
  pxPerSecForDuration,
  scrollDelta,
} from './teleprompter.model.js';

describe('scrollDelta', () => {
  it('preserves subpixel movement at low speeds', () => {
    expect(scrollDelta(16.667, 4)).toBeCloseTo(0.066668, 6);
  });

  it('does not move backwards for a negative elapsed time', () => {
    expect(scrollDelta(-10, 40)).toBe(0);
  });
});

describe('pxPerSecForDuration', () => {
  it('calculates the exact speed needed to cover a distance in time', () => {
    expect(pxPerSecForDuration(900, 30)).toBe(30);
  });

  it('clamps invalid distance and duration values safely', () => {
    expect(pxPerSecForDuration(-10, 20)).toBe(0);
    expect(pxPerSecForDuration(120, 0)).toBe(120);
  });
});

describe('normalizeSettings', () => {
  it('returns the defaults for an empty object', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults for non-object input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps wpm into range and rounds it', () => {
    expect(normalizeSettings({ wpm: WPM_MAX + 500 }).wpm).toBe(WPM_MAX);
    expect(normalizeSettings({ wpm: WPM_MIN - 10 }).wpm).toBe(WPM_MIN);
    expect(normalizeSettings({ wpm: 149.6 }).wpm).toBe(150);
  });

  it('falls back to the default wpm when it is not a number', () => {
    expect(normalizeSettings({ wpm: 'fast' }).wpm).toBe(WPM_DEFAULT);
  });

  it('normalizes the selected scroll mode and total duration', () => {
    expect(normalizeSettings({ scrollMode: 'auto', scrollDurationSeconds: 125 }))
      .toMatchObject({ scrollMode: 'auto', scrollDurationSeconds: 125 });
    expect(normalizeSettings({ scrollMode: 'unknown', scrollDurationSeconds: 0 }))
      .toMatchObject({ scrollMode: 'wpm', scrollDurationSeconds: 1 });
    expect(normalizeSettings({ scrollDurationSeconds: SCROLL_DURATION_MAX + 1 }).scrollDurationSeconds)
      .toBe(SCROLL_DURATION_MAX);
    expect(normalizeSettings({ scrollDurationSeconds: 'later' }).scrollDurationSeconds)
      .toBe(SCROLL_DURATION_DEFAULT);
  });

  it('coerces mirror to a boolean', () => {
    expect(normalizeSettings({ mirror: 1 }).mirror).toBe(true);
    expect(normalizeSettings({ mirror: 0 }).mirror).toBe(false);
    expect(normalizeSettings({ mirror: true }).mirror).toBe(true);
  });

  it('only accepts "light" for pageTheme (otherwise "dark"), and matches panelTheme correctly', () => {
    expect(normalizeSettings({ pageTheme: 'light', panelTheme: 'light' }))
      .toMatchObject({ pageTheme: 'light', panelTheme: 'light-60' });
    expect(normalizeSettings({ pageTheme: 'purple', panelTheme: '' }))
      .toMatchObject({ pageTheme: 'dark', panelTheme: 'dark-60' });
    expect(normalizeSettings({ panelTheme: 'light-30' }).panelTheme).toBe('light-30');
    expect(normalizeSettings({ panelTheme: 'dark-30' }).panelTheme).toBe('dark-30');
  });

  it('defaults countdown to true and coerces it to a boolean', () => {
    expect(normalizeSettings({}).countdown).toBe(true);
    expect(normalizeSettings({ countdown: false }).countdown).toBe(false);
    expect(normalizeSettings({ countdown: 0 }).countdown).toBe(false);
  });

  it('defaults notch fullscreen to true and coerces it to a boolean', () => {
    expect(normalizeSettings({}).notchFullscreen).toBe(true);
    expect(normalizeSettings({ notchFullscreen: 0 }).notchFullscreen).toBe(false);
  });

  it('only accepts known alignments, otherwise "left"', () => {
    expect(normalizeSettings({ align: 'center' }).align).toBe('center');
    expect(normalizeSettings({ align: 'right' }).align).toBe('right');
    expect(normalizeSettings({ align: 'justify' }).align).toBe('justify');
    expect(normalizeSettings({ align: 'diagonal' }).align).toBe('left');
  });

  it('normalizes persisted layout settings', () => {
    expect(normalizeSettings({
      promptMarginRatio: 0.2,
      panelMarginRatio: 0.12,
      eyeLineRatio: 0.6,
      eyeLineVisible: false,
      layoutGuides: true,
    })).toMatchObject({
      promptMarginRatio: 0.2,
      panelMarginRatio: 0.12,
      eyeLineRatio: 0.6,
      eyeLineVisible: false,
      layoutGuides: true,
    });
  });

  it('clamps invalid layout ratios and preserves CSS-driven default margins', () => {
    expect(normalizeSettings({
      promptMarginRatio: 'nope',
      panelMarginRatio: 2,
      eyeLineRatio: 0,
    })).toMatchObject({
      promptMarginRatio: null,
      panelMarginRatio: 0.45,
      eyeLineRatio: 0.05,
    });
  });

  it('passes a fully-specified valid object through unchanged', () => {
    const full = {
      wpm: 180, scrollMode: 'time', scrollDurationSeconds: 125,
      mirror: true, pageTheme: 'light', panelTheme: 'light-60',
      countdown: false, align: 'center',
      notchFullscreen: false,
      promptMarginRatio: 0.18, panelMarginRatio: 0.1,
      eyeLineRatio: 0.4, eyeLineVisible: false, layoutGuides: true,
      fontSize: '24', color: '#ff0000',
      bold: true, italic: true, underline: true,
    };
    expect(normalizeSettings(full)).toEqual(full);
  });
});
