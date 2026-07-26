// @vitest-environment jsdom

import { describe, expect, it, afterEach } from 'vitest';
import { showPermissionPopup, stepsKeyFor } from './permission-popup.js';

const COPY = {
  cameraTitle: 'Camera is blocked',
  micTitle: 'Microphone is blocked',
  bothTitle: 'Camera & microphone are blocked',
  close: 'Got it',
  steps: {
    desktopChromium: ['Chromium step 1', 'Chromium step 2'],
    iosSafari: ['iOS Safari step 1', 'iOS Safari step 2'],
    android: ['Android step 1'],
    fallback: ['Fallback step'],
  },
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('stepsKeyFor', () => {
  it('routes iOS Safari vs other iOS browsers', () => {
    expect(stepsKeyFor({ os: 'ios', browser: 'safari' })).toBe('iosSafari');
    expect(stepsKeyFor({ os: 'ios', browser: 'chrome' })).toBe('iosOther');
  });

  it('routes desktop browsers and android', () => {
    expect(stepsKeyFor({ os: 'windows', browser: 'chrome' })).toBe('desktopChromium');
    expect(stepsKeyFor({ os: 'windows', browser: 'edge' })).toBe('desktopEdge');
    expect(stepsKeyFor({ os: 'macos', browser: 'safari' })).toBe('desktopSafari');
    expect(stepsKeyFor({ os: 'windows', browser: 'firefox' })).toBe('desktopFirefox');
    expect(stepsKeyFor({ os: 'android', browser: 'chrome' })).toBe('android');
  });

  it('falls back for unknown platforms', () => {
    expect(stepsKeyFor({})).toBe('fallback');
  });
});

describe('showPermissionPopup', () => {
  it('renders the steps for the detected platform', () => {
    showPermissionPopup({
      blocked: ['camera'],
      platform: { os: 'ios', browser: 'safari' },
      copy: COPY,
    });
    const items = [...document.querySelectorAll('.permission-step-head')].map(
      (el) => el.textContent,
    );
    expect(items).toEqual(COPY.steps.iosSafari);
    expect(document.querySelector('.permission-title').textContent).toBe(COPY.cameraTitle);
  });

  it('renders a per-step illustration (image) for the platform', () => {
    showPermissionPopup({ platform: { os: 'android', browser: 'chrome' }, copy: COPY });
    expect(document.querySelector('.permission-step-fig img')).not.toBeNull();
  });

  it('shows the combined title when both are blocked', () => {
    showPermissionPopup({
      blocked: ['camera', 'mic'],
      platform: { os: 'windows', browser: 'chrome' },
      copy: COPY,
    });
    expect(document.querySelector('.permission-title').textContent).toBe(COPY.bothTitle);
  });

  it('resolves and removes the overlay on close', async () => {
    const result = showPermissionPopup({
      platform: { os: 'windows', browser: 'chrome' },
      copy: COPY,
    });
    document.querySelector('.permission-close').click();
    await expect(result).resolves.toBe('dismissed');
    expect(document.querySelector('.permission-overlay')).toBeNull();
  });

  it('closes on Escape', async () => {
    const result = showPermissionPopup({
      platform: { os: 'windows', browser: 'chrome' },
      copy: COPY,
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(result).resolves.toBe('dismissed');
    expect(document.querySelector('.permission-overlay')).toBeNull();
  });
});
