import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function normalizeAbsolute(path) {
  assertOc(typeof path === 'string' && path.startsWith('/'), ErrorCodes.INVALID_ARGUMENT, 'Expected absolute path', { path });
  const out = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) throw ocError(ErrorCodes.PATH_ESCAPE, 'Path escapes root', { path });
      out.pop();
    } else out.push(part);
  }
  return '/' + out.join('/');
}

function dirname(path) {
  const normalized = normalizeAbsolute(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

function join(...parts) {
  const raw = parts.filter(Boolean).join('/');
  return normalizeAbsolute(raw.startsWith('/') ? raw : '/' + raw);
}

function bytes(value) { return value instanceof Uint8Array ? new Uint8Array(value) : encoder.encode(String(value)); }
function cloneStat(path, entry) { return Object.freeze({ path, type: entry.type, size: entry.type === 'file' ? entry.data.byteLength : 0, target: entry.target }); }

export class VirtualNodeModulesFS {
  #baseFs;
  #entries = new Map();
  #catalogGeneration = 1;

  constructor({ baseFs = null, packages = [], symlinks = [] } = {}) {
    this.#baseFs = baseFs;
    for (const descriptor of packages) this.#addPackage(descriptor);
    for (const link of symlinks) this.#addSymlink(link);
  }

  get generation() { return this.#catalogGeneration + ':' + String(this.#baseFs?.generation ?? 0); }

  stat(path) {
    const resolved = this.realpath(path);
    const own = this.#entries.get(resolved);
    if (own) return cloneStat(resolved, own);
    if (this.#baseFs) return this.#baseFs.stat(resolved);
    throw ocError(ErrorCodes.NOT_FOUND, 'Path not found', { path: resolved });
  }

  lstat(path) {
    const normalized = normalizeAbsolute(path);
    const own = this.#entries.get(normalized);
    if (own) return cloneStat(normalized, own);
    if (this.#baseFs?.lstat) return this.#baseFs.lstat(normalized);
    if (this.#baseFs) return this.#baseFs.stat(normalized);
    throw ocError(ErrorCodes.NOT_FOUND, 'Path not found', { path: normalized });
  }

  readFile(path, { encoding = 'utf8' } = {}) {
    const resolved = this.realpath(path);
    const own = this.#entries.get(resolved);
    if (own) {
      if (own.type !== 'file') throw ocError(ErrorCodes.IS_DIRECTORY, 'Path is not a file', { path: resolved });
      const data = new Uint8Array(own.data);
      return encoding === null ? data : decoder.decode(data);
    }
    if (this.#baseFs) return this.#baseFs.readFile(resolved, { encoding });
    throw ocError(ErrorCodes.NOT_FOUND, 'File not found', { path: resolved });
  }

  readdir(path) {
    const resolved = this.realpath(path);
    const stat = this.stat(resolved);
    if (stat.type !== 'dir' && stat.type !== 'directory') throw ocError(ErrorCodes.NOT_DIRECTORY, 'Path is not a directory', { path: resolved });

    const names = new Set();
    const prefix = resolved === '/' ? '/' : resolved + '/';
    for (const key of this.#entries.keys()) {
      if (!key.startsWith(prefix) || key === resolved) continue;
      const rest = key.slice(prefix.length);
      if (rest && !rest.includes('/')) names.add(rest);
    }
    if (this.#baseFs) {
      try { for (const name of this.#baseFs.readdir(resolved)) names.add(name); } catch {}
    }
    return [...names].sort();
  }

  readlink(path) {
    const normalized = normalizeAbsolute(path);
    const entry = this.#entries.get(normalized);
    if (entry?.type === 'symlink') return entry.target;
    if (this.#baseFs?.readlink) return this.#baseFs.readlink(normalized);
    throw ocError(ErrorCodes.INVALID_ARGUMENT, 'Path is not a symlink', { path: normalized });
  }

  realpath(path) {
    let current = normalizeAbsolute(path);
    for (let depth = 0; depth < 32; depth++) {
      const parts = current.split('/').filter(Boolean);
      let prefix = '';
      let replaced = false;
      for (let index = 0; index < parts.length; index++) {
        prefix += '/' + parts[index];
        const entry = this.#entries.get(prefix);
        if (entry?.type !== 'symlink') continue;
        const rest = parts.slice(index + 1).join('/');
        const target = entry.target.startsWith('/') ? entry.target : join(dirname(prefix), entry.target);
        current = rest ? join(target, rest) : normalizeAbsolute(target);
        replaced = true;
        break;
      }
      if (replaced) continue;
      if (this.#entries.has(current)) return current;
      if (this.#baseFs?.realpath) return this.#baseFs.realpath(current);
      if (this.#baseFs) { this.#baseFs.stat(current); return current; }
      throw ocError(ErrorCodes.NOT_FOUND, 'Path not found', { path: current });
    }
    throw ocError(ErrorCodes.INVALID_ARGUMENT, 'Symlink resolution depth exceeded', { path });
  }

  exists(path) { try { this.stat(path); return true; } catch { return false; } }

  #addPackage(descriptor) {
    assertOc(descriptor && typeof descriptor.location === 'string', ErrorCodes.INVALID_ARGUMENT, 'Package location is required');
    const root = descriptor.location.startsWith('/') ? normalizeAbsolute(descriptor.location) : join('/workspace', descriptor.location);
    assertOc(root.startsWith('/workspace/node_modules/'), ErrorCodes.INVALID_ARGUMENT, 'Virtual package must live under /workspace/node_modules', { root });
    this.#ensureDir(root);

    const files = { ...(descriptor.files ?? {}) };
    if (!Object.prototype.hasOwnProperty.call(files, 'package.json') && descriptor.packageJson) files['package.json'] = JSON.stringify(descriptor.packageJson);

    for (const [relative, value] of Object.entries(files)) {
      assertOc(relative && !relative.startsWith('/') && !relative.split('/').some((part) => part === '..'), ErrorCodes.PATH_ESCAPE, 'Unsafe package file path', { relative });
      const target = join(root, relative);
      this.#ensureDir(dirname(target));
      this.#entries.set(target, { type: 'file', data: bytes(value) });
    }
  }

  #addSymlink({ path, target }) {
    assertOc(typeof path === 'string' && typeof target === 'string', ErrorCodes.INVALID_ARGUMENT, 'Symlink path and target are required');
    const linkPath = path.startsWith('/') ? normalizeAbsolute(path) : join('/workspace', path);
    const targetPath = target.startsWith('/') ? normalizeAbsolute(target) : join(dirname(linkPath), target);
    assertOc(linkPath.startsWith('/workspace/'), ErrorCodes.PATH_ESCAPE, 'Symlink must remain in workspace namespace', { path: linkPath });
    assertOc(targetPath === '/workspace' || targetPath.startsWith('/workspace/'), ErrorCodes.PATH_ESCAPE, 'Symlink target must remain in workspace namespace', { target: targetPath });
    this.#ensureDir(dirname(linkPath));
    this.#entries.set(linkPath, { type: 'symlink', target: targetPath });
  }

  #ensureDir(path) {
    const normalized = normalizeAbsolute(path);
    if (normalized === '/') return;
    const parent = dirname(normalized);
    if (parent !== normalized) this.#ensureDir(parent);
    const existing = this.#entries.get(normalized);
    if (!existing) this.#entries.set(normalized, { type: 'dir' });
    else if (existing.type !== 'dir') throw ocError(ErrorCodes.NOT_DIRECTORY, 'Virtual path parent is not a directory', { path: normalized });
  }
}
