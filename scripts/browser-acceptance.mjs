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

const browser = findBrowser();
console.log('browser acceptance:', browser.version);

const profile = await mkdtemp(join(tmpdir(), 'opencontainer-browser-'));
const server = spawn(process.execPath, ['apps/playground/server.mjs'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  await waitForServer(server);
  const url = 'http://127.0.0.1:' + port + '/browser-acceptance.html';
  const result = spawnSync(browser.command, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=15000',
    '--dump-dom',
    url
  ], {
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024
  });

  if (result.error) throw result.error;
  const output = result.stdout ?? '';
  if (result.status !== 0 || !/data-status=["']pass["']/.test(output)) {
    throw new Error([
      'Browser acceptance failed',
      'exit=' + result.status,
      'stderr=' + (result.stderr ?? ''),
      'dom=' + output
    ].join('\n'));
  }

  const match = output.match(/<pre id="result">([^<]+)<\/pre>/);
  console.log('browser acceptance PASS', match?.[1] ?? '');
} finally {
  server.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true });
}
