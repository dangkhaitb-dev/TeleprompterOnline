// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { initTrustpilotWidget } from './trustpilot-widget.js';

describe('Trustpilot widget hydration', () => {
  afterEach(() => {
    delete window.Trustpilot;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps Trustpilot as the loader receiver when hydrating a dynamic widget', async () => {
    const widget = document.createElement('div');
    widget.className = 'trustpilot-widget';
    document.body.append(widget);

    const api = {
      loadFromElement: vi.fn(function loadFromElement(element) {
        expect(this).toBe(api);
        element.append(document.createElement('iframe'));
      }),
    };
    window.Trustpilot = api;

    await initTrustpilotWidget(widget);

    expect(api.loadFromElement).toHaveBeenCalledWith(widget);
    expect(widget.querySelector('iframe')).not.toBeNull();
  });
});
