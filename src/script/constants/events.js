// events.js — canonical registry of app-level CustomEvent names.
//
// Import these constants instead of writing raw string literals in
// `new CustomEvent(...)` / add/removeEventListener(...). A typo then fails fast
// (undefined constant) instead of a listener that silently never fires, and an
// ESLint rule forbids the raw literals so this file stays the single source of
// truth. Scope: ONLY app custom events — standard DOM events are not listed.

export const EVENTS = Object.freeze({
  // Dispatched on window by http-client when the API returns 402.
  QUOTA_LIMIT_REACHED: 'quota-limit-reached',

  // Dispatched on window when the user makes a consent decision in the cookie
  // banner. detail: { consent: 'granted' | 'denied' }
  ANALYTICS_CONSENT_CHANGED: 'analytics-consent-changed',
});
