const KNOWN_STATUSES = new Set([
  'granted',
  'revoked',
  'disabled',
  'expired',
  'invalid',
]);

function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export function toLicenseStatus(raw, { now = new Date() } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const expiresAt = cleanString(source.expiresAt) || null;
  const expiresTime = expiresAt ? Date.parse(expiresAt) : Number.POSITIVE_INFINITY;
  const expired = source.isExpired === true
    || (expiresAt !== null && (!Number.isFinite(expiresTime) || expiresTime <= now.getTime()));
  const receivedStatus = cleanString(source.keyStatus).toLowerCase();
  const keyStatus = expired
    ? 'expired'
    : KNOWN_STATUSES.has(receivedStatus) ? receivedStatus : 'invalid';
  const valid = source.valid === true && keyStatus === 'granted' && !expired;

  return {
    valid,
    plan: valid ? 'unlimited' : 'free',
    displayKey: cleanString(source.displayKey),
    keyStatus,
    expiresAt,
    isExpired: expired,
    checkedAt: cleanString(source.checkedAt) || null,
  };
}
