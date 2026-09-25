import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.OPENCONTAINER_BROWSER_PORT || 4187);
const candidates = process.platform === 'win32'
  ? ['chrome.exe', 'msedge.exe']
  : ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];

function findBrowser() {
  for (const command of candidates) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return { command, version: (result.stdout || result.stderr).trim() };
  }
  throw new Error('No supported Chromium/Chrome binary found for browser acceptance');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Playground server did not start')), 5000);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      process.stdout.write(text);
      if (text.includes('OpenContainer playground:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Playground server exited early with code ' + code + '\n' + stderr));
    });
  });
}

async function waitForDevTools(child, profile, timeoutMs = 30000) {
  let stderr = '';
  const onData = (chunk) => { stderr += String(chunk); };
  child.stderr.on('data', onData);
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const stderrMatch = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (stderrMatch) {
        return { browserWebSocket: stderrMatch[1], stderr: () => stderr, source: 'stderr' };
      }

      try {
        const activePort = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
        const [portLine, pathLine] = activePort.trim().split(/\r?\n/);
        const debugPort = Number(portLine);
        if (
          Number.isInteger(debugPort) &&
          debugPort > 0 &&
          typeof pathLine === 'string' &&
          pathLine.startsWith('/devtools/browser/')
        ) {
          return {
            browserWebSocket: 'ws://127.0.0.1:' + debugPort + pathLine,
            stderr: () => stderr,
            source: 'DevToolsActivePort'
          };
        }
      } catch {}

      if (child.exitCode !== null) {
        throw new Error('Chrome exited before DevTools was ready: ' + child.exitCode + '\n' + stderr);
      }
      await delay(100);
    }

    throw new Error(
      'Chrome DevTools endpoint did not appear within ' + timeoutMs + 'ms\n' +
      'profile=' + profile + '\n' + stderr
    );
  } finally {
    child.stderr.off('data', onData);
  }
}

async function waitForPageTarget(debugPort, expectedUrl, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list', { cache: 'no-store' });
      if (response.ok) {
        const targets = await response.json();
        last = targets;
        const target = targets.find((entry) => entry.type === 'page' && entry.url === expectedUrl)
          ?? targets.find((entry) => entry.type === 'page' && entry.url.includes('/browser-acceptance.html'));
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(50);
  }
  throw new Error('Browser page target did not appear: ' + JSON.stringify(last));
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    const events = [];
    let nextId = 0;

    socket.addEventListener('open', () => {
      resolve({
        events,
        async command(method, params = {}) {
          const id = ++nextId;
          const response = new Promise((res, rej) => pending.set(id, { res, rej, method }));
          socket.send(JSON.stringify({ id, method, params }));
          return response;
        },
        close() { socket.close(); }
      });
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.rej(new Error(waiter.method + ': ' + message.error.message));
        else waiter.res(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled') {
        events.push(message);
        if (events.length > 100) events.shift();
      }
    });

    socket.addEventListener('error', () => reject(new Error('Chrome DevTools WebSocket failed')));
    socket.addEventListener('close', () => {
      for (const waiter of pending.values()) waiter.rej(new Error('Chrome DevTools WebSocket closed'));
      pending.clear();
    });
  });
}

async function terminateChild(child, timeoutMs = 3000) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish();
    }, timeoutMs);
    child.once('exit', finish);
    try { child.kill('SIGTERM'); } catch { finish(); }
  });
}

function isTransientExecutionContextError(error) {
  const message = String(error?.message ?? error);
  return [
    'Cannot find default execution context',
    'Execution context was destroyed',
    'Cannot find context with specified id',
    'Inspected target navigated or closed'
  ].some((needle) => message.includes(needle));
}

async function readAcceptanceState(cdp, { retries = 60, retryDelayMs = 50 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const evaluated = await cdp.command('Runtime.evaluate', {
        expression: `(() => ({
          status: document.body?.dataset?.status ?? null,
          stage: document.body?.dataset?.stage ?? null,
          result: document.getElementById('result')?.textContent ?? null,
          html: document.documentElement?.outerHTML ?? null
        }))()`,
        returnByValue: true,
        awaitPromise: true
      });
      return evaluated.result?.value ?? {};
    } catch (error) {
      if (!isTransientExecutionContextError(error) || attempt === retries) throw error;
      lastError = error;
      await delay(retryDelayMs);
    }
  }
  throw lastError ?? new Error('Chrome execution context did not become available');
}

async function waitForAcceptance(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let state = {};
  while (Date.now() < deadline) {
    state = await readAcceptanceState(cdp);
    if (state.status === 'pass' || state.status === 'fail') return state;
    await delay(100);
  }
  return { ...state, status: 'timeout' };
}

const browser = findBrowser();
console.log('browser acceptance:', browser.version);

const profile = await mkdtemp(join(tmpdir(), 'opencontainer-browser-'));
const server = spawn(process.execPath, ['apps/playground/server.mjs'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

let chrome = null;
let cdp = null;

try {
  await waitForServer(server);
  const url = 'http://127.0.0.1:' + port + '/browser-acceptance.html';

  chrome = spawn(browser.command, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=0',
    url
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  });

  const devtools = await waitForDevTools(chrome, profile);
  const debugPort = new URL(devtools.browserWebSocket).port;
  const page = await waitForPageTarget(debugPort, url);
  cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.command('Runtime.enable');
  await cdp.command('Page.enable');

  const state = await waitForAcceptance(cdp);
  if (state.status !== 'pass') {
    throw new Error([
      'Browser acceptance failed',
      'status=' + state.status,
      'stage=' + (state.stage ?? 'unknown'),
      'result=' + (state.result ?? ''),
      'events=' + JSON.stringify(cdp.events.slice(-20)),
      'dom=' + (state.html ?? ''),
      'chrome-stderr=' + devtools.stderr()
    ].join('\n'));
  }

  console.log('browser acceptance PASS', state.result ?? '');
} finally {
  try { cdp?.close(); } catch {}
  await terminateChild(chrome);
  await terminateChild(server);
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
