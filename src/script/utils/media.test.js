import { describe, expect, it, vi, afterEach } from 'vitest';
import { queryPermissionState, classifyMediaError } from './media.js';

const err = (name, message = '') => Object.assign(new Error(message), { name });

describe('classifyMediaError', () => {
  it('maps permission denials to "denied"', () => {
    expect(classifyMediaError(err('NotAllowedError'))).toBe('denied');
    expect(classifyMediaError(err('SecurityError'))).toBe('denied');
  });

  it('maps missing devices to "not-found"', () => {
    expect(classifyMediaError(err('NotFoundError'))).toBe('not-found');
  });

  it('maps a busy device to "in-use"', () => {
    expect(classifyMediaError(err('NotReadableError'))).toBe('in-use');
  });

  it('maps constraint failures to "overconstrained"', () => {
    expect(classifyMediaError(err('OverconstrainedError'))).toBe('overconstrained');
  });

  it('maps the unsupported sentinel by message', () => {
    expect(classifyMediaError(new Error('Media capture unsupported'))).toBe('unsupported');
  });

  it('falls back to "unknown" for anything else', () => {
    expect(classifyMediaError(err('WeirdError'))).toBe('unknown');
    expect(classifyMediaError(null)).toBe('unknown');
  });
});

describe('queryPermissionState', () => {
  const original = navigator.permissions;
  afterEach(() => {
    Object.defineProperty(navigator, 'permissions', {
      value: original,
      configurable: true,
    });
  });

  const stubPermissions = (impl) => {
    Object.defineProperty(navigator, 'permissions', {
      value: impl,
      configurable: true,
    });
  };

  it('returns the browser-reported state', async () => {
    stubPermissions({ query: vi.fn().mockResolvedValue({ state: 'denied' }) });
    await expect(queryPermissionState('camera')).resolves.toBe('denied');
  });

  it('returns "prompt" when the query rejects (unsupported name)', async () => {
    stubPermissions({ query: vi.fn().mockRejectedValue(new TypeError('bad name')) });
    await expect(queryPermissionState('microphone')).resolves.toBe('prompt');
  });

  it('returns "prompt" when the Permissions API is absent', async () => {
    stubPermissions(undefined);
    await expect(queryPermissionState('camera')).resolves.toBe('prompt');
  });
});
