import { readFileSync } from 'node:fs';

function readPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function shellSegments(command) {
  const segments = [[]];
  let token = '';
  let quote = '';
  let escaped = false;

  const pushToken = () => {
    if (token) segments.at(-1).push(token);
    token = '';
  };
  const pushSegment = () => {
    pushToken();
    if (segments.at(-1).length > 0) segments.push([]);
  };

  for (const char of command) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      if (char === '\n') pushSegment();
      continue;
    }
    if (';&|()'.includes(char)) {
      pushSegment();
      continue;
    }
    token += char;
  }

  pushToken();
  return segments.filter((segment) => segment.length > 0);
}

function isGitCommand(token) {
  return token === 'git' || token.endsWith('/git');
}

function commandIndex(segment) {
  let index = 0;

  while (index < segment.length) {
    const executable = segment[index];
    const executableName = executable.split('/').at(-1);

    if (executableName === 'command' || executableName === 'sudo') {
      index += 1;
      while (segment[index]?.startsWith('-')) index += 1;
      continue;
    }

    if (executableName === 'env') {
      index += 1;
      while (index < segment.length) {
        const token = segment[index];
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || token === '--') {
          index += 1;
          continue;
        }
        if (token === '-u' || token === '--unset') {
          index += 2;
          continue;
        }
        if (token.startsWith('-')) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }

    break;
  }

  return index;
}

function isNoVerifyOption(token) {
  if (token === '--no-verify' || token.startsWith('--no-verify=')) return true;
  if (!/^-[^-]/.test(token)) return false;

  // Git permits bundles such as `-qn`. Stop parsing a bundle once an option
  // that consumes the remaining characters as its value is reached.
  const valueOptions = new Set(['C', 'c', 'F', 'm', 'S', 't', 'u']);
  for (const option of token.slice(1)) {
    if (option === 'n') return true;
    if (valueOptions.has(option)) return false;
  }
  return false;
}

function bypassesHooks(segment) {
  const gitIndex = commandIndex(segment);
  if (!isGitCommand(segment[gitIndex])) return false;

  const commitIndex = segment.indexOf('commit', gitIndex + 1);
  if (commitIndex < 0) return false;

  return segment.slice(commitIndex + 1).some(isNoVerifyOption);
}

const payload = readPayload();
const command = payload?.tool_input?.command;

if (
  typeof command === 'string'
  && shellSegments(command).some(bypassesHooks)
) {
  process.stderr.write(
    'Blocked: do not bypass SolPrompter pre-commit checks with '
    + '`git commit --no-verify` or `git commit -n`. Fix the hook failure and '
    + 'commit normally.\n',
  );
  process.exit(2);
}
