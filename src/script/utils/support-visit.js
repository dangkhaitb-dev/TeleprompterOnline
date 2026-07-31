import { getItem, setItem } from './storage.js';
import { LS_SUPPORT_VISIT_COUNT } from './storage-keys.js';

const MAX_VISIT_COUNT = Number.MAX_SAFE_INTEGER;

export function incrementSupportVisitCount({ get = getItem, set = setItem } = {}) {
  const storedCount = get(LS_SUPPORT_VISIT_COUNT);
  const currentCount = Number.isSafeInteger(storedCount) && storedCount >= 0
    ? storedCount
    : 0;
  const nextCount = Math.min(currentCount + 1, MAX_VISIT_COUNT);

  set(LS_SUPPORT_VISIT_COUNT, nextCount);
  return nextCount;
}
