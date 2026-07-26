import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function startServer() {
  const sessionLockSource = readFileSync(
    join(process.cwd(), 'src/script/utils/workspace-session-lock.js'),
    'utf8',
  );
  const server = createServer((request, response) => {
    if (request.url === '/workspace-session-lock.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(sessionLockSource);
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end('<!doctype html><title>Web Locks integration test</title>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function launchChrome(profileDir) {
  const executable = CHROME_CANDIDATES.find(existsSync);
  if (!executable) {
    throw new Error('Chrome/Chromium not found. Set CHROME_BIN to its executable path.');
  }
  const chrome = spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const browserWsUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Chrome DevTools')), 15_000);
    let stderr = '';
    chrome.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    chrome.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready (code ${code})`));
    });
  });
  return { chrome, browserWsUrl };
}

async function pageConnection(browser, browserWsUrl, url) {
  const { targetId } = await browser.send('Target.createTarget', { url });
  const { port } = new URL(browserWsUrl);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const target = targets.find((item) => item.id === targetId && item.webSocketDebuggerUrl);
    if (target) return { targetId, page: await CdpConnection.connect(target.webSocketDebuggerUrl) };
    await sleep(20);
  }
  throw new Error(`DevTools target ${targetId} was not available`);
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error(message);
}

async function holdShared(page, name) {
  await evaluate(page, `
    globalThis.__held = false;
    globalThis.__release = null;
    navigator.locks.request(${JSON.stringify(name)}, { mode: 'shared' }, () => {
      globalThis.__held = true;
      return new Promise(resolve => { globalThis.__release = resolve; });
    });
    true;
  `);
  await waitFor(
    () => evaluate(page, 'globalThis.__held === true'),
    `Shared lock ${name} was not acquired`,
  );
}

function tryExclusive(page, name) {
  return evaluate(page, `navigator.locks.request(
    ${JSON.stringify(name)},
    { ifAvailable: true },
    lock => Boolean(lock),
  )`);
}

async function holdWithAppHelper(page, workspaceId) {
  await evaluate(page, `
    globalThis.__appLockAcquired = false;
    import('/workspace-session-lock.js')
      .then(module => module.holdWorkspaceSessionLock(${JSON.stringify(workspaceId)}))
      .then(acquired => { globalThis.__appLockAcquired = acquired; });
    true;
  `);
  await waitFor(
    () => evaluate(page, 'globalThis.__appLockAcquired === true'),
    `App helper did not acquire the workspace lock for ${workspaceId}`,
  );
}

async function main() {
  const profileDir = mkdtempSync(join(tmpdir(), 'vteleprompter-web-locks-'));
  const { server, origin } = await startServer();
  let chrome;
  const pages = [];
  try {
    const launched = await launchChrome(profileDir);
    chrome = launched.chrome;
    const browser = await CdpConnection.connect(launched.browserWsUrl);
    const tabA = await pageConnection(browser, launched.browserWsUrl, `${origin}/?tab=a`);
    const tabB = await pageConnection(browser, launched.browserWsUrl, `${origin}/?tab=b`);
    const gcTab = await pageConnection(browser, launched.browserWsUrl, `${origin}/?tab=gc`);
    pages.push(tabA.page, tabB.page, gcTab.page);

    assert.equal(await evaluate(tabA.page, 'isSecureContext && Boolean(navigator.locks)'), true);

    const workspaceLock = 'vp:ws:browser-happy';
    await holdShared(tabA.page, workspaceLock);
    await holdShared(tabB.page, workspaceLock);
    assert.equal(await tryExclusive(gcTab.page, workspaceLock), false, 'GC must skip two live tabs');

    await evaluate(tabA.page, 'globalThis.__release(); true');
    assert.equal(await tryExclusive(gcTab.page, workspaceLock), false, 'GC must skip the final live tab');

    await evaluate(tabB.page, 'globalThis.__release(); true');
    assert.equal(await tryExclusive(gcTab.page, workspaceLock), true, 'GC should run after all tabs release');

    await holdShared(tabA.page, 'vp:ws:workspace-a');
    assert.equal(
      await tryExclusive(gcTab.page, 'vp:ws:workspace-b'),
      true,
      'A live workspace must not block GC for another workspace',
    );
    await evaluate(tabA.page, 'globalThis.__release(); true');

    const crashLock = 'vp:ws:browser-crash';
    await holdShared(tabB.page, crashLock);
    await browser.send('Target.closeTarget', { targetId: tabB.targetId });
    await waitFor(
      () => tryExclusive(gcTab.page, crashLock),
      'Chrome did not release a lock after its tab was force-closed',
    );

    const appTab = await pageConnection(browser, launched.browserWsUrl, `${origin}/?tab=app-helper`);
    pages.push(appTab.page);
    const appWorkspaceId = 'browser-app-helper';
    await holdWithAppHelper(appTab.page, appWorkspaceId);
    assert.equal(
      await tryExclusive(gcTab.page, `vp:ws:${appWorkspaceId}`),
      false,
      'GC must observe the shared lock held by the application helper',
    );
    await browser.send('Target.closeTarget', { targetId: appTab.targetId });
    await waitFor(
      () => tryExclusive(gcTab.page, `vp:ws:${appWorkspaceId}`),
      'The application helper lock was not released after closing its tab',
    );

    browser.close();
    process.stdout.write('Web Locks browser integration: 8 assertions passed\n');
  } finally {
    for (const page of pages) page.close();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once('exit', resolve));
      chrome.kill('SIGTERM');
      await Promise.race([exited, sleep(3_000)]);
    }
    await new Promise((resolve) => server.close(resolve));
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
