import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  classifyMediaError,
  getCaptureStream,
  mediaFileExtension,
  pickRecorderMimeType,
  queryPermissionState,
} from './media.js';
import { CAPTURE_REQUEST_TIMEOUT_MS } from '../constants/media.js';

const err = (name, message = '') => Object.assign(new Error(message), { name });

const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
];

describe('pickRecorderMimeType', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const supportTypes = (...supportedTypes) => {
    const isTypeSupported = vi.fn((type) => supportedTypes.includes(type));
    vi.stubGlobal('MediaRecorder', { isTypeSupported });
    return isTypeSupported;
  };

  it.each(VIDEO_MIME_TYPES)(
    'selects %s after rejecting higher-priority video formats',
    (supportedType) => {
      const isTypeSupported = supportTypes(supportedType);
      const selectedIndex = VIDEO_MIME_TYPES.indexOf(supportedType);

      expect(pickRecorderMimeType()).toBe(supportedType);
      expect(isTypeSupported.mock.calls.map(([type]) => type)).toEqual(
        VIDEO_MIME_TYPES.slice(0, selectedIndex + 1),
      );
    },
  );

  it.each(AUDIO_MIME_TYPES)(
    'selects %s after rejecting higher-priority audio formats',
    (supportedType) => {
      const isTypeSupported = supportTypes(supportedType);
      const selectedIndex = AUDIO_MIME_TYPES.indexOf(supportedType);

      expect(pickRecorderMimeType({ video: false })).toBe(supportedType);
      expect(isTypeSupported.mock.calls.map(([type]) => type)).toEqual(
        AUDIO_MIME_TYPES.slice(0, selectedIndex + 1),
      );
    },
  );

  it('returns an empty MIME type when MediaRecorder or all candidates are unsupported', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(pickRecorderMimeType()).toBe('');

    supportTypes();
    expect(pickRecorderMimeType({ video: false })).toBe('');
  });
});

describe('mediaFileExtension', () => {
  it.each([
    ['audio/mpeg', 'mp3'],
    ['audio/mp3', 'mp3'],
    ['audio/mp4;codecs=mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['audio/webm;codecs=opus', 'webm'],
    ['video/webm', 'webm'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['video/ogg', 'ogg'],
    [undefined, 'webm'],
    ['', 'webm'],
    ['application/octet-stream', 'webm'],
  ])('maps %s to .%s', (mimeType, extension) => {
    expect(mediaFileExtension(mimeType)).toBe(extension);
  });
});

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

  it('maps a capture timeout to "timeout"', () => {
    expect(classifyMediaError(err('TimeoutError'))).toBe('timeout');
  });

  it('falls back to "unknown" for anything else', () => {
    expect(classifyMediaError(err('WeirdError'))).toBe('unknown');
    expect(classifyMediaError(null)).toBe('unknown');
  });
});

describe('getCaptureStream', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('times out a stalled request and stops a stream that resolves late', async () => {
    vi.useFakeTimers();
    let resolveNativeRequest;
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => new Promise((resolve) => { resolveNativeRequest = resolve; })),
      },
    });
    const stop = vi.fn();
    const lateStream = { getTracks: () => [{ stop }] };

    const pending = getCaptureStream({ video: true, audio: true });
    const timedOut = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(CAPTURE_REQUEST_TIMEOUT_MS);

    await timedOut;
    resolveNativeRequest(lateStream);
    await Promise.resolve();

    expect(stop).toHaveBeenCalledOnce();
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
