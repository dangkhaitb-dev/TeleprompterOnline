// cookie-consent.js — single source of truth for analytics consent state.
// Feature code reads/writes consent through these functions only.
// Storage key lives here so it is not scattered across modules.

import { getItem, setItem } from './storage.js';

const CONSENT_KEY = 'solprompter:analytics-consent';

/**
 * @returns {'granted' | 'denied' | null} null = not yet decided
 */
export function getAnalyticsConsent() {
  const value = getItem(CONSENT_KEY);
  if (value === 'granted' || value === 'denied') return value;
  return null;
}

/** @param {'granted' | 'denied'} decision */
export function setAnalyticsConsent(decision) {
  if (decision !== 'granted' && decision !== 'denied') return;
  setItem(CONSENT_KEY, decision);
}

export function hasDecided() {
  return getAnalyticsConsent() !== null;
}

export function isAnalyticsGranted() {
  return getAnalyticsConsent() === 'granted';
}
