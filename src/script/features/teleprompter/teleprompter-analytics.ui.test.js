// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { toFirebaseEventName } from '../../libs/firebase/button-click-analytics.ui.js';
import {
  nameTeleprompterAnalyticsControls,
  TELEPROMPTER_CHANGE_ACTIONS,
  TELEPROMPTER_CLICK_ACTIONS,
} from './teleprompter-analytics.ui.js';

const TELEPROMPTER_HTML = readFileSync(
  'teleprompter.html',
  'utf8',
);

describe('Teleprompter analytics taxonomy', () => {
  beforeEach(() => {
    const parsed = new DOMParser().parseFromString(TELEPROMPTER_HTML, 'text/html');
    document.documentElement.replaceWith(parsed.documentElement);
  });

  it('maps every declared click and change action to a real control', () => {
    nameTeleprompterAnalyticsControls(document);

    [...TELEPROMPTER_CLICK_ACTIONS, ...TELEPROMPTER_CHANGE_ACTIONS]
      .forEach(([selector, actionName]) => {
        const controls = [...document.querySelectorAll(selector)];
        expect(controls.length, `Missing Teleprompter control: ${selector}`).toBeGreaterThan(0);
        controls.forEach((control) => {
          expect(control.dataset.analyticsName).toBe(actionName);
        });
      });
  });

  it('gives every static Teleprompter button a clear explicit action name', () => {
    nameTeleprompterAnalyticsControls(document);
    const unnamed = [...document.querySelectorAll('button')]
      .filter((button) => !button.dataset.analyticsName);

    expect(unnamed.map((button) => button.id || button.className)).toEqual([]);
  });

  it('keeps all event names unique and within Firebase limits', () => {
    const actionNames = [
      ...TELEPROMPTER_CLICK_ACTIONS,
      ...TELEPROMPTER_CHANGE_ACTIONS,
      ['camera caret', 'cameraMenuClick'],
      ['mic caret', 'micMenuClick'],
      ['camera option', 'cameraDeviceClick'],
      ['mic option', 'micDeviceClick'],
      ['color swatch', 'colorSwatchClick'],
      ['color hex', 'colorHexChange'],
      ['permission close', 'permissionCloseClick'],
      ['permission dismiss', 'permissionDismissClick'],
      ['stale reload', 'reloadStaleClick'],
    ].map((entry) => entry[1]);
    const eventNames = actionNames.map((action) => (
      toFirebaseEventName(`teleprompter-${action}`)
    ));

    eventNames.forEach((eventName) => {
      expect(eventName.length, eventName).toBeLessThanOrEqual(40);
      expect(eventName).toMatch(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);
    });
    expect(new Set(eventNames).size).toBe(eventNames.length);
  });

  it('distinguishes auto scroll and the two manual scroll modes', () => {
    nameTeleprompterAnalyticsControls(document);

    expect(document.querySelector('#speedModeAuto').dataset.analyticsName)
      .toBe('autoScrollClick');
    expect(document.querySelector('#speedMethodWpm').dataset.analyticsName)
      .toBe('fixedSpeedClick');
    expect(document.querySelector('#speedMethodTime').dataset.analyticsName)
      .toBe('scrollTimeClick');
  });
});
