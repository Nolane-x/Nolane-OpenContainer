import { EventEmitter } from './events.js';

function normalizeAbsolute(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length) parts.pop();
    } else parts.push(part);
  }
  return '/' + parts.join('/');
}

function resolveFrom(cwd, value) {
  if (typeof value !== 'string') throw new TypeError('directory must be a string');
  return normalizeAbsolute(value.startsWith('/') ? value : cwd.replace(/\/$/, '') + '/' + value);
}

export function createProcessBuiltin({
  fs,
  cwd = '/workspace',
  env = {},
  argv = ['opencontainer'],
  platform = 'linux',
  arch = 'wasm32',
  version = 'v24.21.0',
  stdout = () => {},
  stderr = () => {}
} = {}) {
  let currentCwd = normalizeAbsolute(cwd);
  const started = performance.now();
  const proc = new EventEmitter();

  Object.assign(proc, {
    title: 'opencontainer',
    browser: true,
    platform,
    arch,
    version,
    versions: Object.freeze({ node: version.replace(/^v/, ''), opencontainer: '0.1.0-alpha.1' }),
    release: Object.freeze({ name: 'node', opencontainer: true }),
    argv: [...argv],
    execArgv: [],
    env: Object.assign(Object.create(null), env),
    pid: 1,
    ppid: 0,
    exitCode: undefined,
    stdout: Object.freeze({
      isTTY: false,
      write(chunk) { stdout(String(chunk)); return true; }
    }),
    stderr: Object.freeze({
      isTTY: false,
      write(chunk) { stderr(String(chunk)); return true; }
    }),
    stdin: Object.freeze({ isTTY: false }),

    cwd() { return currentCwd; },
    chdir(directory) {
      const next = resolveFrom(currentCwd, directory);
      const stat = fs?.stat?.(next);
      if (!stat || !['dir', 'directory'].includes(stat.type)) {
        const error = new Error('ENOTDIR: not a directory, chdir ' + JSON.stringify(directory));
        error.code = 'ENOTDIR';
        error.path = next;
        throw error;
      }
      currentCwd = next;
    },

    nextTick(callback, ...args) {
      if (typeof callback !== 'function') throw new TypeError('callback must be a function');
      queueMicrotask(() => callback(...args));
    },

    hrtime(previous) {
      const ns = BigInt(Math.floor(performance.now() * 1e6));
      const seconds = Number(ns / 1000000000n);
      const nanos = Number(ns % 1000000000n);
      if (!previous) return [seconds, nanos];
      let ds = seconds - Number(previous[0]);
      let dn = nanos - Number(previous[1]);
      if (dn < 0) { ds--; dn += 1e9; }
      return [ds, dn];
    },

    uptime() { return (performance.now() - started) / 1000; },
    memoryUsage() { return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }; },
    resourceUsage() { return { userCPUTime: 0, systemCPUTime: 0, maxRSS: 0 }; },
    umask() { return 0o022; },
    emitWarning(warning) {
      const value = warning instanceof Error ? warning : new Error(String(warning));
      proc.emit('warning', value);
    },

    exit(code = proc.exitCode ?? 0) {
      const error = new Error('OpenContainer logical process exit');
      error.code = 'OC_PROCESS_EXIT';
      error.exitCode = Number(code) || 0;
      throw error;
    }
  });

  proc.hrtime.bigint = () => BigInt(Math.floor(performance.now() * 1e6));
  return proc;
}
