// api-endpoints.js — single source of truth for API endpoint definitions.
//
// Each ENDPOINTS entry is a spec consumed by http-client (`http.get/post/...`):
//   { path, baseUrl?, method?, timeoutKey? }
// Base has no backend yet — add entries here (and a matching function in
// services/<name>.service.js) when the teleprompter needs an API.

export const API_BASES = {
  feedback: 'https://feedback-api.solplatform.workers.dev',
  license: import.meta.env.VITE_LICENSE_API_BASE_URL
    || 'https://license-api.solplatform.workers.dev',
};

export const ENDPOINTS = {
  FEEDBACK_SUBMIT: {
    path: '/feedback',
    baseUrl: API_BASES.feedback,
    method: 'POST',
    timeoutKey: 'default',
  },
  LICENSE_VALIDATE: {
    path: '/v1/license/validate',
    baseUrl: API_BASES.license,
    method: 'POST',
    timeoutKey: 'licenseValidate',
  },
};
