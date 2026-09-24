function assertString(value, name = 'path') {
  if (typeof value !== 'string') throw new TypeError(name + ' must be a string');
}

function normalizeString(path, allowAboveRoot) {
  const parts = path.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (allowAboveRoot) out.push('..');
    } else out.push(part);
  }
  return out.join('/');
}

export function createPosixPath({ cwd = () => '/workspace' } = {}) {
  const api = {
    sep: '/',
    delimiter: ':',

    normalize(path) {
      assertString(path);
      if (path.length === 0) return '.';
      const absolute = path.charCodeAt(0) === 47;
      const trailing = path.charCodeAt(path.length - 1) === 47;
      let result = normalizeString(path, !absolute);
      if (!result && !absolute) result = '.';
      if (result && trailing) result += '/';
      return absolute ? '/' + result : result;
    },

    isAbsolute(path) {
      assertString(path);
      return path.length > 0 && path.charCodeAt(0) === 47;
    },

    join(...paths) {
      if (paths.length === 0) return '.';
      let joined = '';
      for (const path of paths) {
        assertString(path);
        if (!path) continue;
        joined = joined ? joined + '/' + path : path;
      }
      return joined ? api.normalize(joined) : '.';
    },

    resolve(...paths) {
      let resolved = '';
      let absolute = false;
      for (let index = paths.length - 1; index >= -1 && !absolute; index--) {
        const path = index >= 0 ? paths[index] : cwd();
        assertString(path, index >= 0 ? 'path' : 'cwd');
        if (!path) continue;
        resolved = path + '/' + resolved;
        absolute = path.charCodeAt(0) === 47;
      }
      const normalized = normalizeString(resolved, !absolute);
      if (absolute) return '/' + normalized;
      return normalized || '.';
    },

    relative(from, to) {
      assertString(from, 'from');
      assertString(to, 'to');
      const fromResolved = api.resolve(from);
      const toResolved = api.resolve(to);
      if (fromResolved === toResolved) return '';
      const fromParts = fromResolved.split('/').filter(Boolean);
      const toParts = toResolved.split('/').filter(Boolean);
      let common = 0;
      while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++;
      return [...Array(fromParts.length - common).fill('..'), ...toParts.slice(common)].join('/');
    },

    dirname(path) {
      assertString(path);
      if (!path) return '.';
      const root = path.charCodeAt(0) === 47;
      let end = -1;
      let matchedSlash = true;
      for (let index = path.length - 1; index >= 1; index--) {
        if (path.charCodeAt(index) === 47) {
          if (!matchedSlash) { end = index; break; }
        } else matchedSlash = false;
      }
      if (end === -1) return root ? '/' : '.';
      while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
      return path.slice(0, end);
    },

    basename(path, suffix) {
      assertString(path);
      if (suffix !== undefined) assertString(suffix, 'suffix');
      let end = path.length;
      while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
      let start = end;
      while (start > 0 && path.charCodeAt(start - 1) !== 47) start--;
      let base = path.slice(start, end);
      if (suffix && base.endsWith(suffix)) base = base.slice(0, base.length - suffix.length);
      return base;
    },

    extname(path) {
      assertString(path);
      const base = api.basename(path);
      if (!base) return '';
      const lastDot = base.lastIndexOf('.');
      if (lastDot <= 0) return '';
      let firstNonDot = -1;
      for (let index = 0; index < base.length; index++) {
        if (base[index] !== '.') { firstNonDot = index; break; }
      }
      if (firstNonDot === -1 || lastDot < firstNonDot) return '';
      return base.slice(lastDot);
    },

    parse(path) {
      assertString(path);
      const root = api.isAbsolute(path) ? '/' : '';
      let end = path.length;
      while (end > (root ? 1 : 0) && path.charCodeAt(end - 1) === 47) end--;
      if (end === 0 || (root && end === 1)) return { root, dir: root, base: '', ext: '', name: '' };
      let start = end;
      while (start > 0 && path.charCodeAt(start - 1) !== 47) start--;
      const base = path.slice(start, end);
      const ext = api.extname(base);
      const name = base.slice(0, base.length - ext.length);
      let dir = '';
      if (start > 0) dir = start === 1 && root ? '/' : path.slice(0, start - 1);
      return { root, dir, base, ext, name };
    },

    format(value) {
      if (!value || typeof value !== 'object') throw new TypeError('pathObject must be an object');
      const dir = value.dir || value.root || '';
      const base = value.base ?? String(value.name ?? '') + (value.ext ? (String(value.ext).startsWith('.') ? String(value.ext) : '.' + String(value.ext)) : '');
      if (!dir) return base;
      if (dir === value.root) return dir + base;
      return dir + '/' + base;
    },

    toNamespacedPath(path) { return path; }
  };
  api.posix = api;
  return Object.freeze(api);
}
