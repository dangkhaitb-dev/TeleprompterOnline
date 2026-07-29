import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function sessionKey(sessionId) {
  return String(sessionId || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

const payload = readPayload();
const pendingMarker = join(
  tmpdir(),
  `codex-review-pending-${sessionKey(payload.session_id)}.txt`,
);
const activeMarker = join(
  tmpdir(),
  `codex-review-active-${sessionKey(payload.session_id)}.txt`,
);

if (payload.stop_hook_active) {
  try {
    if (existsSync(activeMarker)) unlinkSync(activeMarker);
  } catch {
    // Active-marker cleanup is advisory.
  }
}

if (!existsSync(pendingMarker)) process.exit(0);

let files = [];
try {
  files = [...new Set(
    readFileSync(pendingMarker, 'utf8').split('\n').filter(Boolean),
  )];
} catch {
  process.exit(0);
}

if (files.length === 0) process.exit(0);

try {
  renameSync(pendingMarker, activeMarker);
} catch {
  // Without a snapshot, continuing could repeat forever. Allow the stop.
  process.exit(0);
}

const fileList = files
  .map((filePath) => filePath.replace(/^.*\/src\/script\//, 'src/script/'))
  .join(', ');

process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: `[review-gate] JavaScript changed in this session: ${fileList}.
Before finishing, perform one focused self-review of only this session's code changes plus the directly related imports, callers, and surrounding functions.
Check code smells, SolPrompter architecture and repository conventions, security regressions, and missing behavior-level tests.
Do not broaden the task or review unrelated user changes. Report concrete findings with file references; if there are no findings, state that briefly, then finish.`,
}));
