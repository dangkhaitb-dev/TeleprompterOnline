// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildControlChangeEvent,
  buildButtonClickEvent,
  getButtonAnalyticsName,
  getPageAnalyticsName,
  initButtonClickTracking,
  toFirebaseEventName,
} from './button-click-analytics.ui.js';

function pageLocation(pathname) {
  return { pathname };
}

describe('button click analytics naming', () => {
  beforeEach(() => {
    document.documentElement.lang = 'en';
    document.body.innerHTML = '';
    delete document.body.dataset.analyticsPage;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('derives stable page names for root, localized, simple, and article pages', () => {
    expect(getPageAnalyticsName(document, pageLocation('/'))).toBe('home');
    expect(getPageAnalyticsName(document, pageLocation('/pricing.html'))).toBe('pricing');
    expect(getPageAnalyticsName(document, pageLocation('/pages/vi/index.html'))).toBe('vi');

    document.documentElement.lang = 'vi';
    expect(getPageAnalyticsName(document, pageLocation('/vi/index.html'))).toBe('home');
    expect(getPageAnalyticsName(
      document,
      pageLocation('/blog/product/index.html'),
    )).toBe('blog-product');
    expect(getPageAnalyticsName(
      document,
      pageLocation('/blog/product/inside-solprompter/index.html'),
    )).toBe('blog-inside-solprompter');
  });

  it('allows an explicit page name for in-place views', () => {
    document.body.dataset.analyticsPage = 'Scene Editor';
    expect(getPageAnalyticsName(document, pageLocation('/teleprompter.html')))
      .toBe('scene-editor');
  });

  it('prioritizes explicit names, ids, semantic data, and stable classes', () => {
    const explicit = document.createElement('button');
    explicit.dataset.analyticsName = 'Upgrade Now';
    explicit.id = 'ignoredId';
    expect(getButtonAnalyticsName(explicit)).toBe('upgradeNow');

    const identified = document.createElement('button');
    identified.id = 'headerPlayButton';
    expect(getButtonAnalyticsName(identified)).toBe('header-play-btn');

    const semantic = document.createElement('button');
    semantic.dataset.cmd = 'bold';
    expect(getButtonAnalyticsName(semantic)).toBe('cmd-bold');

    const classed = document.createElement('button');
    classed.className = 'selected ws-card-more';
    expect(getButtonAnalyticsName(classed)).toBe('ws-card-more');
  });

  it('does not use visible user content when a stable class is available', () => {
    const crumb = document.createElement('button');
    crumb.className = 'ws-crumb';
    crumb.textContent = 'Private customer folder';
    expect(getButtonAnalyticsName(crumb)).toBe('ws-crumb');
  });

  it('keeps the requested page-button base and emits a Firebase-safe event name', () => {
    const button = document.createElement('button');
    button.id = 'start-btn';

    expect(buildButtonClickEvent(button, {
      doc: document,
      pageLocation: pageLocation('/index.html'),
    })).toEqual({
      name: 'home_start_btn',
      params: {
        event_base: 'home-start-btn',
        page_name: 'home',
        action_name: 'start-btn',
        button_name: 'start-btn',
        page_path: '/index.html',
      },
    });
  });

  it('uses the closest in-place view as the page name', () => {
    const view = document.createElement('section');
    view.dataset.analyticsPage = 'Scene Editor';
    const button = document.createElement('button');
    button.dataset.role = 'export';
    view.appendChild(button);
    document.body.appendChild(view);

    expect(buildButtonClickEvent(button, {
      doc: document,
      pageLocation: pageLocation('/teleprompter.html'),
    }).params.event_base).toBe('scene-editor-role-export');
  });

  it('keeps Firebase event names valid and collision-resistant under 40 characters', () => {
    const first = toFirebaseEventName(
      'teleprompter-this-is-a-very-long-button-name-for-the-left-control',
    );
    const second = toFirebaseEventName(
      'teleprompter-this-is-a-very-long-button-name-for-the-right-control',
    );

    expect(first).toMatch(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);
    expect(first).toHaveLength(40);
    expect(second).toHaveLength(40);
    expect(first).not.toBe(second);
  });

  it('keeps concise camelCase action names without spelling out Button', () => {
    const button = document.createElement('button');
    button.dataset.analyticsName = 'autoScrollButtonClick';

    const analyticsEvent = buildButtonClickEvent(button, {
      pageName: 'teleprompter',
      pageLocation: pageLocation('/teleprompter.html'),
    });

    expect(analyticsEvent.name).toBe('teleprompter_autoScrollBtnClick');
    expect(analyticsEvent.params.event_base).toBe('teleprompter-autoScrollBtnClick');
    expect(analyticsEvent.name.length).toBeLessThanOrEqual(40);
  });

  it('builds clear change events for named popup controls', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.analyticsName = 'countdownChange';

    expect(buildControlChangeEvent(checkbox, {
      pageName: 'teleprompter',
      pageLocation: pageLocation('/teleprompter.html'),
    })).toEqual({
      name: 'teleprompter_countdownChange',
      params: {
        event_base: 'teleprompter-countdownChange',
        page_name: 'teleprompter',
        action_name: 'countdownChange',
        control_name: 'countdownChange',
        page_path: '/teleprompter.html',
      },
    });
  });
});

describe('initButtonClickTracking', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('tracks static and dynamically-added buttons through one delegated listener', async () => {
    const logEvent = vi.fn();
    const analytics = {};
    const loadClient = vi.fn(async () => ({ analytics, logEvent }));
    const stop = initButtonClickTracking({
      root: document,
      doc: document,
      pageLocation: pageLocation('/workspaces.html'),
      loadClient,
    });

    const staticButton = document.createElement('button');
    staticButton.id = 'wsNewScriptBtn';
    const nestedIcon = document.createElement('span');
    staticButton.appendChild(nestedIcon);
    document.body.appendChild(staticButton);
    nestedIcon.click();

    const dynamicButton = document.createElement('button');
    dynamicButton.dataset.role = 'delete-all';
    document.body.appendChild(dynamicButton);
    dynamicButton.click();

    await vi.waitFor(() => expect(logEvent).toHaveBeenCalledTimes(2));
    expect(loadClient).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenNthCalledWith(1, analytics, 'workspaces_ws_new_script_btn', {
      event_base: 'workspaces-ws-new-script-btn',
      page_name: 'workspaces',
      action_name: 'ws-new-script-btn',
      button_name: 'ws-new-script-btn',
      page_path: '/workspaces.html',
    });
    expect(logEvent).toHaveBeenNthCalledWith(2, analytics, 'workspaces_role_delete_all', {
      event_base: 'workspaces-role-delete-all',
      page_name: 'workspaces',
      action_name: 'role-delete-all',
      button_name: 'role-delete-all',
      page_path: '/workspaces.html',
    });

    stop();
  });

  it('uses a named child action for split buttons and tracks popup control changes', async () => {
    const logEvent = vi.fn();
    const stop = initButtonClickTracking({
      loadClient: async () => ({ analytics: {}, logEvent }),
      pageName: 'teleprompter',
    });
    const splitButton = document.createElement('button');
    splitButton.dataset.analyticsName = 'cameraToggleClick';
    const caret = document.createElement('span');
    caret.dataset.analyticsName = 'cameraMenuClick';
    splitButton.appendChild(caret);
    document.body.appendChild(splitButton);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.analyticsName = 'countdownChange';
    document.body.appendChild(checkbox);

    caret.click();
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(logEvent).toHaveBeenCalledTimes(2));
    expect(logEvent.mock.calls[0][1]).toBe('teleprompter_cameraMenuClick');
    expect(logEvent.mock.calls[1][1]).toBe('teleprompter_countdownChange');
    stop();
  });

  it('tracks role=button controls and stops cleanly', async () => {
    const logEvent = vi.fn();
    const stop = initButtonClickTracking({
      loadClient: async () => ({ analytics: {}, logEvent }),
      pageName: 'workspaces',
    });
    const card = document.createElement('article');
    card.className = 'ws-video-card';
    card.setAttribute('role', 'button');
    document.body.appendChild(card);

    card.click();
    await vi.waitFor(() => expect(logEvent).toHaveBeenCalledTimes(1));
    stop();
    card.click();
    await Promise.resolve();
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('fails silently when Firebase Analytics is unavailable', async () => {
    const stop = initButtonClickTracking({
      loadClient: async () => null,
      pageName: 'home',
    });
    const button = document.createElement('button');
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
    await Promise.resolve();
    stop();
  });
});
