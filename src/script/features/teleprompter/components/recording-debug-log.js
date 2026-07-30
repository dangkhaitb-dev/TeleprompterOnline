const MAX_EVENTS = 80;

const STRING_FIELDS = new Set([
  'reason',
  'errorName',
  'previewVideo',
  'previewAudio',
  'mode',
  'scrollMode',
  'voicePhase',
  'asrMode',
]);

const SAFE_FIELD_VALUES = Object.freeze({
  reason: new Set([
    'denied', 'not-found', 'in-use', 'overconstrained', 'unsupported',
    'unknown', 'inactive', 'cancelled', 'audio-capture', 'not-allowed',
    'service-not-allowed', 'network', 'no-speech', 'no-match',
    'no-transcript', 'start-timeout', 'recognizer-busy', 'timeout', 'aborted', 'other',
  ]),
  errorName: new Set([
    'Error', 'NotAllowedError', 'NotFoundError', 'NotReadableError',
    'OverconstrainedError', 'SecurityError', 'TrackStartError',
    'TimeoutError',
  ]),
  previewVideo: new Set(['none', 'live', 'ended', 'inactive']),
  previewAudio: new Set(['none', 'live', 'ended', 'inactive']),
  mode: new Set(['normal', 'record']),
  scrollMode: new Set(['auto', 'wpm', 'time']),
  voicePhase: new Set(['idle', 'detecting', 'listening']),
  asrMode: new Set(['on-device', 'browser-service']),
});

const BOOLEAN_FIELDS = new Set([
  'cameraEnabled',
  'micEnabled',
  'recording',
  'paused',
  'voiceStarting',
  'voiceActive',
  'asrHadAudio',
  'asrHadSound',
  'asrHadSpeech',
  'asrHadResult',
]);

const NUMBER_FIELDS = new Set([
  'asrFailureCount',
  'asrEmptyAbortCount',
]);

function sanitizeEntry(event, fields, at) {
  const entry = { at, event: String(event || 'unknown') };
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (STRING_FIELDS.has(key) && typeof value === 'string') {
      entry[key] = SAFE_FIELD_VALUES[key]?.has(value) ? value : 'other';
    }
    if (BOOLEAN_FIELDS.has(key) && typeof value === 'boolean') entry[key] = value;
    if (NUMBER_FIELDS.has(key) && Number.isInteger(value) && value >= 0 && value <= 10) {
      entry[key] = value;
    }
  });
  return entry;
}

// A bounded, in-memory trace for hardware-specific capture failures. The
// whitelist deliberately excludes user content, device IDs, media streams,
// constraints, workspace IDs, and browser/user-agent identifiers.
export function createRecordingDebugLog({ now = () => new Date().toISOString() } = {}) {
  const entries = [];

  function add(event, fields = {}) {
    entries.push(sanitizeEntry(event, fields, now()));
    if (entries.length > MAX_EVENTS) entries.splice(0, entries.length - MAX_EVENTS);
  }

  function toText() {
    return [
      'SolPrompter record + auto-scroll debug log',
      `events=${entries.length}`,
      ...entries.map((entry) => JSON.stringify(entry)),
    ].join('\n');
  }

  return {
    add,
    toText,
    getEntries: () => entries.map((entry) => ({ ...entry })),
  };
}
