/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../http/errors.js';

vi.mock('./license.logic.js', () => ({
  clearLicense: vi.fn(),
  getStoredLicense: vi.fn(() => null),
  validateAndSaveLicense: vi.fn(),
  validateStoredLicense: vi.fn(),
}));

import { validateAndSaveLicense } from './license.logic.js';
import { initLicenseUI } from './license.ui.js';

function renderLicensePage() {
  document.body.innerHTML = `
    <form id="licenseForm"><input id="licenseKey"><button id="licenseSubmit" type="submit"><span class="license-submit-label">Validate</span><span class="license-submit-loading" hidden>Checking</span></button></form>
    <p id="licenseFormMessage" hidden></p>
    <aside id="licenseStatusPanel" hidden><span id="licenseBadge">Active</span><span id="licensePlan">Free</span><span id="licenseDisplayKey">No key</span><span id="licenseExpiry">N/A</span><button id="licenseRecheck"></button><button id="licenseRemove"></button></aside>
    <script id="licenseCopy" type="application/json">{"configurationMessage":"License validation is being set up. Please try again shortly."}</script>
  `;
}

describe('initLicenseUI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderLicensePage();
  });

  it('explains that validation is being configured when the Worker returns 503', async () => {
    validateAndSaveLicense.mockRejectedValueOnce(new HttpError(503, { error: 'service_not_configured' }));
    initLicenseUI();

    document.getElementById('licenseForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('licenseFormMessage').hidden).toBe(false));

    expect(document.getElementById('licenseFormMessage').textContent).toBe('License validation is being set up. Please try again shortly.');
    expect(document.getElementById('licenseFormMessage').dataset.variant).toBe('error');
  });
});
