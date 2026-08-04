import { describe, expect, it } from 'vitest';
import { toLicenseStatus } from './license.model.js';

describe('toLicenseStatus', () => {
  it('maps an active Polar license to unlimited access', () => {
    expect(toLicenseStatus({
      valid: true,
      displayKey: 'SOL_****_1234',
      keyStatus: 'granted',
      expiresAt: '2099-08-04T00:00:00.000Z',
      isExpired: false,
      checkedAt: '2026-08-04T00:00:00.000Z',
    })).toEqual({
      valid: true,
      plan: 'unlimited',
      displayKey: 'SOL_****_1234',
      keyStatus: 'granted',
      expiresAt: '2099-08-04T00:00:00.000Z',
      isExpired: false,
      checkedAt: '2026-08-04T00:00:00.000Z',
    });
  });

  it.each([
    [{ valid: true, keyStatus: 'revoked' }, 'revoked'],
    [{ valid: true, keyStatus: 'granted', isExpired: true }, 'expired'],
    [{ valid: false, keyStatus: 'disabled' }, 'disabled'],
    [null, 'invalid'],
  ])('never grants unlimited access to an unusable key', (raw, expectedStatus) => {
    const result = toLicenseStatus(raw);

    expect(result.valid).toBe(false);
    expect(result.plan).toBe('free');
    expect(result.keyStatus).toBe(expectedStatus);
  });

  it('fails closed when a cached license has passed its expiry', () => {
    const result = toLicenseStatus({
      valid: true,
      keyStatus: 'granted',
      expiresAt: '2026-08-04T12:00:00.000Z',
    }, { now: new Date('2026-08-04T12:00:01.000Z') });

    expect(result).toMatchObject({ valid: false, keyStatus: 'expired', isExpired: true });
  });
});
