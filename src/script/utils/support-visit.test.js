import { describe, expect, it, vi } from 'vitest';

import { LS_SUPPORT_VISIT_COUNT } from './storage-keys.js';
import { incrementSupportVisitCount } from './support-visit.js';

describe('incrementSupportVisitCount', () => {
  it('increments the stored count', () => {
    const get = vi.fn(() => 2);
    const set = vi.fn();

    expect(incrementSupportVisitCount({ get, set })).toBe(3);
    expect(set).toHaveBeenCalledWith(LS_SUPPORT_VISIT_COUNT, 3);
  });

  it('recovers safely from invalid stored values', () => {
    const set = vi.fn();

    expect(incrementSupportVisitCount({ get: () => 'not-a-count', set })).toBe(1);
    expect(set).toHaveBeenCalledWith(LS_SUPPORT_VISIT_COUNT, 1);
  });
});
