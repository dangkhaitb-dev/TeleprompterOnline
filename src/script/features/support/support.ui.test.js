// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { initSupportUI } from './support.ui.js';

describe('initSupportUI', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('tp-page');
    document.body.className = '';
    document.body.replaceChildren();
  });

  it('adds a labelled link to the Polar checkout page', () => {
    initSupportUI({ incrementVisit: () => 3 });

    const widget = document.querySelector('[data-support-widget]');
    expect(widget).not.toBeNull();
    expect(widget.href).toBe('https://buy.polar.sh/polar_cl_K1QVdsH7dN9NkF6SEf9yIkviBh1lrUE4grYJf2p9rYn');
    expect(widget.target).toBe('_blank');
    expect(widget.getAttribute('rel')).toBe('nofollow noopener noreferrer');
    expect(widget.textContent).toBe('♥Support Me');
    expect(widget.getAttribute('aria-label')).toBe('Support SolPrompter');
    expect(widget.querySelector('.support-widget__icon')?.textContent).toBe('♥');
  });

  it('does not add the widget more than once', () => {
    initSupportUI({ incrementVisit: () => 3 });
    initSupportUI({ incrementVisit: () => 3 });

    expect(document.querySelectorAll('[data-support-widget]')).toHaveLength(1);
  });

  it('hides the widget while the in-page teleprompter overlay is open', async () => {
    const dispose = initSupportUI({ incrementVisit: () => 3 });
    const widget = document.querySelector('[data-support-widget]');

    document.documentElement.classList.add('tp-page');
    await Promise.resolve();
    expect(widget.style.display).toBe('none');

    document.documentElement.classList.remove('tp-page');
    await Promise.resolve();
    expect(widget.style.display).toBe('');
    dispose();
  });

  it('keeps the widget hidden before the third visit', () => {
    initSupportUI({ incrementVisit: () => 2 });

    expect(document.querySelector('[data-support-widget]')).toBeNull();
  });
});
