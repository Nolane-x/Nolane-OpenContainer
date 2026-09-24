import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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

function waitForDevTools(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => finish(reject, new Error('Chrome DevTools endpoint did not appear\n' + stderr)), timeoutMs);

    const onData = (chunk) => {
      const text = String(chunk);
      stderr += text;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(resolve, { browserWebSocket: match[1], stderr: () => stderr });
    };

    const onExit = (code) => finish(reject, new Error('Chrome exited before DevTools was ready: ' + code + '\n' + stderr));

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      fn(value);
    }

    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
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

async function readAcceptanceState(cdp) {
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

  const devtools = await waitForDevTools(chrome);
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
  if (chrome && chrome.exitCode === null) chrome.kill('SIGTERM');
  if (server.exitCode === null) server.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true });
}
