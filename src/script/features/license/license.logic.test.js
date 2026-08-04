import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/license.service.js', () => ({
  checkLicenseKey: vi.fn(),
}));

vi.mock('../../utils/storage.js', () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

import { checkLicenseKey } from '../../services/license.service.js';
import { getItem, removeItem, setItem } from '../../utils/storage.js';
import {
  clearLicense,
  getStoredLicense,
  validateAndSaveLicense,
  validateStoredLicense,
} from './license.logic.js';
import { LS_LICENSE } from '../../utils/storage-keys.js';

describe('license logic', () => {
  beforeEach(() => {
    clearLicense();
    vi.clearAllMocks();
    getItem.mockReturnValue(null);
  });

  it('normalizes, validates and stores a valid key with its status', async () => {
    checkLicenseKey.mockResolvedValue({
      valid: true,
      displayKey: 'SOL_****_1234',
      keyStatus: 'granted',
      expiresAt: null,
      isExpired: false,
    });

    const result = await validateAndSaveLicense('  SOL_TEST_1234  ');

    expect(checkLicenseKey).toHaveBeenCalledWith('SOL_TEST_1234');
    expect(setItem).toHaveBeenCalledWith(LS_LICENSE, expect.objectContaining({
      key: 'SOL_TEST_1234',
      valid: true,
      keyStatus: 'granted',
    }));
    expect(result.plan).toBe('unlimited');
  });

  it('does not replace the saved key when a newly entered key is invalid', async () => {
    checkLicenseKey.mockResolvedValue({ valid: false, keyStatus: 'invalid' });

    await expect(validateAndSaveLicense('WRONG_KEY')).resolves.toMatchObject({ valid: false });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('returns only a normalized stored license shape', () => {
    getItem.mockReturnValue({
      key: 'SOL_TEST_1234',
      valid: true,
      keyStatus: 'granted',
      injected: '<script>',
    });

    expect(getStoredLicense()).toEqual(expect.objectContaining({
      key: 'SOL_TEST_1234',
      valid: true,
      keyStatus: 'granted',
    }));
    expect(getStoredLicense()).not.toHaveProperty('injected');
  });

  it('removes the local key through the storage wrapper', () => {
    clearLicense();
    expect(removeItem).toHaveBeenCalledWith(LS_LICENSE);
  });

  it('revalidates a stored key after the short cache TTL', async () => {
    getItem.mockReturnValue({ key: 'SOL_TEST_1234', valid: true, keyStatus: 'granted' });
    checkLicenseKey.mockResolvedValue({ valid: true, keyStatus: 'granted' });

    await validateStoredLicense({ now: () => new Date('2026-08-04T12:00:00.000Z') });
    await validateStoredLicense({ now: () => new Date('2026-08-04T12:06:00.000Z') });

    expect(checkLicenseKey).toHaveBeenCalledTimes(2);
  });
});
