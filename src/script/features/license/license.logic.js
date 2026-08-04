// license.logic.js — orchestrates Worker validation, response mapping and the
// local key record. No DOM and no direct storage access live in this layer.

import { checkLicenseKey } from '../../services/license.service.js';
import { getItem, removeItem, setItem } from '../../utils/storage.js';
import { LS_LICENSE } from '../../utils/storage-keys.js';
import { toLicenseStatus } from './license.model.js';

const VALIDATION_TTL_MS = 5 * 60 * 1000;

let validationPromise = null;
let validationKey = '';
let validationExpiresAt = 0;

export function normalizeLicenseKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function storedRecord(key, status) {
  return { key, ...status };
}

export function getStoredLicense() {
  const raw = getItem(LS_LICENSE);
  const key = normalizeLicenseKey(raw?.key);
  if (!key) return null;
  return storedRecord(key, toLicenseStatus(raw));
}

export async function validateAndSaveLicense(value) {
  const key = normalizeLicenseKey(value);
  const status = toLicenseStatus(await checkLicenseKey(key));
  if (status.valid) {
    const next = storedRecord(key, status);
    setItem(LS_LICENSE, next);
    validationPromise = Promise.resolve({ ...next, hasKey: true });
    validationKey = key;
    validationExpiresAt = Date.now() + VALIDATION_TTL_MS;
  }
  return status;
}

export async function validateStoredLicense({ force = false, now = () => new Date() } = {}) {
  const stored = getStoredLicense();
  if (!stored) return { ...toLicenseStatus(null), hasKey: false };
  const nowDate = now();
  if (validationPromise && validationKey === stored.key
    && validationExpiresAt > nowDate.getTime() && !force) {
    return validationPromise.then((cached) => ({
      ...cached,
      ...toLicenseStatus(cached, { now: nowDate }),
      hasKey: true,
    }));
  }

  validationKey = stored.key;
  validationPromise = checkLicenseKey(stored.key)
    .then((raw) => {
      const status = toLicenseStatus(raw, { now: nowDate });
      const next = storedRecord(stored.key, status);
      setItem(LS_LICENSE, next);
      validationExpiresAt = nowDate.getTime() + VALIDATION_TTL_MS;
      return { ...next, hasKey: true };
    })
    .catch((error) => {
      validationPromise = null;
      validationKey = '';
      validationExpiresAt = 0;
      throw error;
    });
  return validationPromise;
}

export async function getAutoScrollLicenseStatus() {
  const stored = getStoredLicense();
  if (!stored) return { ...toLicenseStatus(null), hasKey: false };
  try {
    return await validateStoredLicense();
  } catch {
    return {
      ...stored,
      valid: false,
      plan: 'free',
      hasKey: true,
      verificationUnavailable: true,
    };
  }
}

export function clearLicense() {
  validationPromise = null;
  validationKey = '';
  validationExpiresAt = 0;
  removeItem(LS_LICENSE);
}
