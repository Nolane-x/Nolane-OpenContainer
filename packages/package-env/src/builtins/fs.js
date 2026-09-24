import { BufferCompat } from './buffer.js';

function nodeFsError(error, syscall, path) {
  if (error?.code && String(error.code).startsWith('E')) return error;
  const mapping = {
    OC_NOT_FOUND: 'ENOENT',
    OC_NOT_DIRECTORY: 'ENOTDIR',
    OC_IS_DIRECTORY: 'EISDIR',
    OC_PATH_ESCAPE: 'EACCES',
    OC_INTERNAL_PATH: 'EACCES',
    OC_INVALID_ARGUMENT: 'EINVAL'
  };
  const code = mapping[error?.code] ?? 'EIO';
  const wrapped = new Error(code + ': ' + (error?.message ?? 'filesystem error') + ", " + syscall + " '" + path + "'");
  wrapped.code = code;
  wrapped.errno = code;
  wrapped.syscall = syscall;
  wrapped.path = path;
  wrapped.cause = error;
  return wrapped;
}

function optionEncoding(options) {
  if (typeof options === 'string') return options;
  return options?.encoding ?? null;
}

function dirent(name, type) {
  return Object.freeze({
    name,
    parentPath: undefined,
    path: undefined,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir' || type === 'directory',
    isSymbolicLink: () => type === 'symlink',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false
  });
}

function stats(stat) {
  const type = stat.type;
  return Object.freeze({
    size: stat.size ?? 0,
    mode: type === 'dir' || type === 'directory' ? 0o40755 : type === 'symlink' ? 0o120777 : 0o100644,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir' || type === 'directory',
    isSymbolicLink: () => type === 'symlink',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false
  });
}

export function createFsBuiltins({ fs, writableFs, path, url }) {
  if (!fs) return { fs: Object.freeze({}), promises: Object.freeze({}) };
  const writeFs = writableFs ?? fs;

  const normalizePath = (value) => {
    if (value instanceof URL) return url.fileURLToPath(value);
    if (typeof value !== 'string') throw new TypeError('path must be a string or file URL');
    return path.resolve(value);
  };

  const invoke = (syscall, value, fn) => {
    const normalized = normalizePath(value);
    try { return fn(normalized); }
    catch (error) { throw nodeFsError(error, syscall, normalized); }
  };

  const api = {
    constants: Object.freeze({ F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }),

    existsSync(value) {
      try { return !!api.statSync(value); } catch { return false; }
    },

    accessSync(value) { invoke('access', value, (target) => fs.stat(target)); },

    readFileSync(value, options = null) {
      const encoding = optionEncoding(options);
      return invoke('open', value, (target) => {
        const data = fs.readFile(target, { encoding: null });
        const buffer = BufferCompat.from(data);
        return encoding ? buffer.toString(encoding) : buffer;
      });
    },

    writeFileSync(value, data, options = null) {
      return invoke('open', value, (target) => {
        const parent = path.dirname(target);
        try {
          const parentStat = writeFs.stat(parent);
          if (!['dir', 'directory'].includes(parentStat.type)) throw new Error('parent not directory');
        } catch (error) {
          throw nodeFsError(error, 'open', target);
        }
        const encoding = optionEncoding(options) ?? 'utf8';
        const bytes = typeof data === 'string' ? BufferCompat.from(data, encoding) : BufferCompat.from(data);
        writeFs.beginTransaction().writeFile(target, bytes).commit();
      });
    },

    readdirSync(value, options = null) {
      return invoke('scandir', value, (target) => {
        const names = fs.readdir(target);
        if (!options || typeof options === 'string' || !options.withFileTypes) return names;
        return names.map((name) => {
          const child = target.replace(/\/$/, '') + '/' + name;
          const stat = fs.lstat ? fs.lstat(child) : fs.stat(child);
          return dirent(name, stat.type);
        });
      });
    },

    statSync(value) { return invoke('stat', value, (target) => stats(fs.stat(target))); },
    lstatSync(value) { return invoke('lstat', value, (target) => stats(fs.lstat ? fs.lstat(target) : fs.stat(target))); },
    realpathSync(value) { return invoke('realpath', value, (target) => fs.realpath ? fs.realpath(target) : target); },
    readlinkSync(value) { return invoke('readlink', value, (target) => fs.readlink(target)); },

    mkdirSync(value, options = null) {
      return invoke('mkdir', value, (target) => {
        const recursive = options === true || options?.recursive === true;
        if (!recursive) {
          const parent = path.dirname(target);
          writeFs.stat(parent);
        }
        if (!writeFs.exists?.(target)) writeFs.beginTransaction().mkdir(target).commit();
        return recursive ? target : undefined;
      });
    },

    renameSync(from, to) {
      const source = normalizePath(from);
      const destination = normalizePath(to);
      try { writeFs.beginTransaction().rename(source, destination).commit(); }
      catch (error) { throw nodeFsError(error, 'rename', source); }
    },

    rmSync(value, options = null) {
      return invoke('rm', value, (target) => {
        const force = !!options?.force;
        if (!writeFs.exists?.(target)) {
          if (force) return;
          const error = new Error('not found');
          error.code = 'OC_NOT_FOUND';
          throw error;
        }
        const stat = writeFs.stat(target);
        if (['dir', 'directory'].includes(stat.type) && !options?.recursive && writeFs.readdir(target).length) {
          const error = new Error('directory not empty');
          error.code = 'ENOTEMPTY';
          throw error;
        }
        writeFs.beginTransaction().remove(target).commit();
      });
    },

    unlinkSync(value) {
      return invoke('unlink', value, (target) => {
        const stat = writeFs.lstat ? writeFs.lstat(target) : writeFs.stat(target);
        if (['dir', 'directory'].includes(stat.type)) {
          const error = new Error('is a directory');
          error.code = 'EISDIR';
          throw error;
        }
        writeFs.beginTransaction().remove(target).commit();
      });
    }
  };

  api.realpathSync.native = api.realpathSync;

  const promises = Object.freeze({
    access: async (...args) => api.accessSync(...args),
    readFile: async (...args) => api.readFileSync(...args),
    writeFile: async (...args) => api.writeFileSync(...args),
    readdir: async (...args) => api.readdirSync(...args),
    stat: async (...args) => api.statSync(...args),
    lstat: async (...args) => api.lstatSync(...args),
    realpath: async (...args) => api.realpathSync(...args),
    readlink: async (...args) => api.readlinkSync(...args),
    mkdir: async (...args) => api.mkdirSync(...args),
    rename: async (...args) => api.renameSync(...args),
    rm: async (...args) => api.rmSync(...args),
    unlink: async (...args) => api.unlinkSync(...args)
  });

  api.promises = promises;
  return { fs: Object.freeze(api), promises };
}
