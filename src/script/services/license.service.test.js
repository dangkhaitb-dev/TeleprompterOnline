import { describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '../constants/api-endpoints.js';
import { http } from '../http/http-client.js';
import { checkLicenseKey } from './license.service.js';

vi.mock('../http/http-client.js', () => ({
  http: { post: vi.fn() },
}));

describe('checkLicenseKey', () => {
  it('posts only the key to the configured Worker endpoint', async () => {
    const response = { valid: true, keyStatus: 'granted' };
    http.post.mockResolvedValueOnce(response);

    await expect(checkLicenseKey('SOL_TEST_1234')).resolves.toBe(response);
    expect(http.post).toHaveBeenCalledWith(ENDPOINTS.LICENSE_VALIDATE, {
      key: 'SOL_TEST_1234',
    });
    expect(ENDPOINTS.LICENSE_VALIDATE).toMatchObject({
      path: '/v1/license/validate',
      method: 'POST',
      timeoutKey: 'licenseValidate',
    });
  });
});
