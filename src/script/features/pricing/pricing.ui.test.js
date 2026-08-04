/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import { initPricingUI } from './pricing.ui.js';

function renderPricing() {
  document.body.innerHTML = `
    <div role="tablist">
      <button id="billing-tab-monthly" role="tab" aria-selected="false"
        aria-controls="billing-panel-monthly" data-billing-cycle="monthly">Monthly</button>
      <button id="billing-tab-yearly" role="tab" aria-selected="true"
        aria-controls="billing-panel-yearly" data-billing-cycle="yearly">Yearly</button>
    </div>
    <div id="billing-panel-monthly" role="tabpanel" hidden></div>
    <div id="billing-panel-yearly" role="tabpanel"></div>
  `;
}

describe('initPricingUI', () => {
  beforeEach(renderPricing);

  it('switches from the default yearly cycle to monthly', () => {
    initPricingUI();

    document.getElementById('billing-tab-monthly').click();

    expect(document.getElementById('billing-tab-monthly').getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('billing-tab-yearly').getAttribute('aria-selected')).toBe('false');
    expect(document.getElementById('billing-panel-monthly').hidden).toBe(false);
    expect(document.getElementById('billing-panel-yearly').hidden).toBe(true);
  });

  it('supports arrow-key navigation between billing cycles', () => {
    initPricingUI();
    const monthly = document.getElementById('billing-tab-monthly');
    const yearly = document.getElementById('billing-tab-yearly');

    monthly.focus();
    monthly.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(document.activeElement).toBe(yearly);
    expect(yearly.getAttribute('aria-selected')).toBe('true');
  });
});
