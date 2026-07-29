import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function findProjectDir(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
  } catch {
    return cwd;
  }
}

function sessionKey(sessionId) {
  return String(sessionId || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function patchText(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  return toolInput?.command || toolInput?.patch || '';
}

function collectCandidates(payload) {
  const candidates = new Set();
  const toolInput = payload?.tool_input;

  if (typeof toolInput?.file_path === 'string') {
    candidates.add(toolInput.file_path);
  }

  if (Array.isArray(toolInput?.file_paths)) {
    for (const filePath of toolInput.file_paths) {
      if (typeof filePath === 'string') candidates.add(filePath);
    }
  }

  const patch = patchText(toolInput);
  const pathPattern = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
  for (const match of patch.matchAll(pathPattern)) {
    candidates.add(match[1].trim());
  }

  return [...candidates];
}

function resolveProjectFile(projectDir, candidate) {
  const absolutePath = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(projectDir, candidate);
  const projectRelativePath = relative(projectDir, absolutePath);

  if (
    projectRelativePath === ''
    || projectRelativePath === '..'
    || projectRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(projectRelativePath)
  ) {
    return null;
  }

  if (!existsSync(absolutePath)) return null;

  try {
    const realPath = realpathSync(absolutePath);
    const realRelativePath = relative(projectDir, realPath);
    if (realRelativePath === '..' || realRelativePath.startsWith('../')) {
      return null;
    }
  } catch {
    return null;
  }

  return { absolutePath, projectRelativePath };
}

function runCheck(projectDir, args) {
  return spawnSync('npx', ['--no-install', ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 25000,
  });
}

function reportFailure(result) {
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.stderr.write(
    'Lint failed on edited files. Fix the errors before continuing. '
    + 'Rules: eslint.config.js and stylelint.config.js.\n',
  );
  process.exit(2);
}

const payload = readPayload();
const cwd = payload.cwd || process.cwd();
const projectDir = findProjectDir(cwd);
const files = collectCandidates(payload)
  .map((candidate) => resolveProjectFile(projectDir, candidate))
  .filter(Boolean);

const jsFiles = files
  .filter(({ projectRelativePath }) => (
    /^src\/script\/.+\.(?:js|mjs)$/.test(projectRelativePath)
  ))
  .map(({ absolutePath }) => absolutePath);
const cssFiles = files
  .filter(({ projectRelativePath }) => (
    /^src\/.+\.css$/.test(projectRelativePath)
  ))
  .map(({ absolutePath }) => absolutePath);

if (jsFiles.length > 0) {
  const marker = join(
    tmpdir(),
    `codex-review-pending-${sessionKey(payload.session_id)}.txt`,
  );
  try {
    appendFileSync(marker, `${jsFiles.join('\n')}\n`);
  } catch {
    // Review tracking is advisory and must not break linting.
  }

  const result = runCheck(projectDir, [
    'eslint',
    '--quiet',
    '--no-warn-ignored',
    ...jsFiles,
  ]);
  if (result.status !== 0) reportFailure(result);
}

if (cssFiles.length > 0) {
  const result = runCheck(projectDir, ['stylelint', '--quiet', ...cssFiles]);
  if (result.status !== 0) reportFailure(result);
}
