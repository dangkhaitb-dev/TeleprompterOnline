// One free use means the first successful voice Auto Scroll activation inside
// a new Play/Record reading session. Internal resume/restart/rebind paths share
// the session latch and do not consume another use.

import { getItem, setItem } from '../../utils/storage.js';
import { LS_AUTO_SCROLL_USAGE } from '../../utils/storage-keys.js';
import { getAutoScrollLicenseStatus } from './license.logic.js';

export const AUTO_SCROLL_MONTHLY_LIMIT = 500;

function localMonth(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

function normalizeUsage(value, month) {
  if (!value || value.month !== month) return { month, count: 0 };
  const count = Number.isInteger(value.count) && value.count > 0 ? value.count : 0;
  return { month, count };
}

export function getAutoScrollUsage({
  readUsage = () => getItem(LS_AUTO_SCROLL_USAGE),
  now = () => new Date(),
} = {}) {
  const usage = normalizeUsage(readUsage(), localMonth(now()));
  return {
    ...usage,
    limit: AUTO_SCROLL_MONTHLY_LIMIT,
    remaining: Math.max(0, AUTO_SCROLL_MONTHLY_LIMIT - usage.count),
  };
}

export function createAutoScrollAccessController({
  getLicenseStatus = getAutoScrollLicenseStatus,
  readUsage = () => getItem(LS_AUTO_SCROLL_USAGE),
  writeUsage = (next) => setItem(LS_AUTO_SCROLL_USAGE, next),
  now = () => new Date(),
} = {}) {
  let sessionCounted = false;
  let sessionAccess = null;

  function currentUsage() {
    return normalizeUsage(readUsage(), localMonth(now()));
  }

  function beginSession() {
    sessionCounted = false;
    sessionAccess = null;
  }

  async function prepareStart() {
    if (sessionCounted) {
      return { ...sessionAccess, allowed: true, alreadyCounted: true };
    }

    const license = await getLicenseStatus();
    if (license.valid) {
      return { allowed: true, licensed: true, license };
    }

    const usage = currentUsage();
    if (usage.count >= AUTO_SCROLL_MONTHLY_LIMIT) {
      return {
        allowed: false,
        licensed: false,
        reason: license.verificationUnavailable ? 'verification-unavailable' : 'monthly-limit',
        usage: { ...usage, limit: AUTO_SCROLL_MONTHLY_LIMIT, remaining: 0 },
      };
    }
    return {
      allowed: true,
      licensed: false,
      license,
      usage: {
        ...usage,
        limit: AUTO_SCROLL_MONTHLY_LIMIT,
        remaining: AUTO_SCROLL_MONTHLY_LIMIT - usage.count,
      },
    };
  }

  function commitSuccessfulStart(prepared) {
    if (!prepared?.allowed) return prepared || { allowed: false, reason: 'invalid-access' };
    if (sessionCounted) return { ...sessionAccess, allowed: true, alreadyCounted: true };

    if (prepared.licensed) {
      sessionCounted = true;
      sessionAccess = { allowed: true, licensed: true, license: prepared.license };
      return sessionAccess;
    }

    const usage = currentUsage();
    if (usage.count >= AUTO_SCROLL_MONTHLY_LIMIT) {
      return {
        allowed: false,
        licensed: false,
        reason: 'monthly-limit',
        usage: { ...usage, limit: AUTO_SCROLL_MONTHLY_LIMIT, remaining: 0 },
      };
    }

    const next = { month: usage.month, count: usage.count + 1 };
    writeUsage(next);
    sessionCounted = true;
    sessionAccess = {
      allowed: true,
      licensed: false,
      usage: {
        ...next,
        limit: AUTO_SCROLL_MONTHLY_LIMIT,
        remaining: AUTO_SCROLL_MONTHLY_LIMIT - next.count,
      },
    };
    return sessionAccess;
  }

  return { beginSession, prepareStart, commitSuccessfulStart };
}
