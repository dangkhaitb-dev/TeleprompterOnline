import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  classifyMediaError,
  getCaptureStream,
  mediaFileExtension,
  pickRecorderMimeType,
  queryPermissionState,
  recorderTimesliceForMimeType,
  validateRecordedMediaBlob,
} from './media.js';
import { CAPTURE_REQUEST_TIMEOUT_MS } from '../constants/media.js';

const err = (name, message = '') => Object.assign(new Error(message), { name });

const VIDEO_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42000a,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4',
];
const AUDIO_MIME_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mpeg',
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

describe('recorderTimesliceForMimeType', () => {
  it('uses one-second chunks for MP4 to avoid WebKit MP4 writer races', () => {
    expect(recorderTimesliceForMimeType('video/mp4;codecs=avc1.42E01E,mp4a.40.2'))
      .toBe(1000);
    expect(recorderTimesliceForMimeType('audio/mp4')).toBe(1000);
  });

  it('keeps shorter chunks for WebM and the browser-default recorder', () => {
    expect(recorderTimesliceForMimeType('video/webm;codecs=vp8,opus')).toBe(250);
    expect(recorderTimesliceForMimeType('')).toBe(250);
  });
});

describe('validateRecordedMediaBlob', () => {
  const mp4Box = (type, payload = []) => {
    const bytes = new Uint8Array(8 + payload.length);
    new DataView(bytes.buffer).setUint32(0, bytes.length);
    bytes.set([...type].map((char) => char.charCodeAt(0)), 4);
    bytes.set(payload, 8);
    return bytes;
  };

  it('accepts a finalized MP4 containing ftyp, moov and media data boxes', async () => {
    const blob = new Blob([
      mp4Box('ftyp'),
      mp4Box('moov'),
      mp4Box('mdat', [1, 2, 3]),
    ], { type: 'video/mp4' });

    await expect(validateRecordedMediaBlob(blob)).resolves.toEqual({ valid: true });
  });

  it('rejects an MP4 whose final moov metadata is missing', async () => {
    const blob = new Blob([
      mp4Box('ftyp'),
      mp4Box('mdat', [1, 2, 3]),
    ], { type: 'video/mp4' });

    await expect(validateRecordedMediaBlob(blob)).resolves.toEqual({
      valid: false,
      reason: 'MP4_MISSING_REQUIRED_BOX',
    });
  });

  it('rejects empty output and accepts non-empty non-MP4 for decoder validation later', async () => {
    await expect(validateRecordedMediaBlob(new Blob([], { type: 'video/webm' })))
      .resolves.toEqual({ valid: false, reason: 'EMPTY_BLOB' });
    await expect(validateRecordedMediaBlob(
      new Blob(['webm bytes'], { type: 'video/webm' }),
    )).resolves.toEqual({ valid: true });
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
