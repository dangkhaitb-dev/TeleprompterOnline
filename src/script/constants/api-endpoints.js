// api-endpoints.js — single source of truth for API endpoint definitions.
//
// Each ENDPOINTS entry is a spec consumed by http-client (`http.get/post/...`):
//   { path, baseUrl?, method?, timeoutKey? }
// Base has no backend yet — add entries here (and a matching function in
// services/<name>.service.js) when the teleprompter needs an API.

export const API_BASES = {
  // e.g. api: 'https://api.example.com'
};

export const ENDPOINTS = {
  // e.g. THING_LIST: { path: '/api/things', method: 'GET', timeoutKey: 'default' },
};
