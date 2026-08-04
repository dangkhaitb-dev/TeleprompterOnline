// license.service.js — raw transport only. Polar credentials and entitlement
// decisions stay in the Cloudflare Worker; the browser sends only the key.

import { ENDPOINTS } from '../constants/api-endpoints.js';
import { http } from '../http/http-client.js';

export function checkLicenseKey(key) {
  return http.post(ENDPOINTS.LICENSE_VALIDATE, { key });
}
