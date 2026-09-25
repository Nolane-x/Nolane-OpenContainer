import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const BUILTINS = new Set([
  'assert','assert/strict','async_hooks','buffer','child_process','cluster','console','constants','crypto','dgram','diagnostics_channel',
  'dns','dns/promises','domain','events','fs','fs/promises','http','http2','https','module','net','os','path','path/posix','path/win32',
  'perf_hooks','process','punycode','querystring','readline','readline/promises','repl','stream','stream/consumers','stream/promises','stream/web',
  'string_decoder','sys','test','test/reporters','timers','timers/promises','tls','trace_events','tty','url','util','util/types','v8','vm','wasi',
  'worker_threads','zlib'
]);

function normalizeAbsolute(path) {
  assertOc(typeof path === 'string' && path.startsWith('/'), ErrorCodes.INVALID_ARGUMENT, 'Expected absolute path', { path });
  const out = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) throw ocError(ErrorCodes.INVALID_MODULE_SPECIFIER, 'Path escapes filesystem root', { path });
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

function pathToFileURL(path) {
  return 'file://' + normalizeAbsolute(path).split('/').map((segment, index) => index === 0 ? '' : encodeURIComponent(segment)).join('/');
}

function pathFromFileURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) {
    throw ocError(ErrorCodes.INVALID_MODULE_SPECIFIER, 'Only local file: URLs are supported', { value });
  }
  if (/%2f|%5c/i.test(url.pathname)) throw ocError(ErrorCodes.INVALID_MODULE_SPECIFIER, 'Encoded path separators are forbidden', { value });
  return { path: normalizeAbsolute(decodeURIComponent(url.pathname)), suffix: url.search + url.hash };
}

function splitEsmSuffix(specifier) {
  if (specifier.startsWith('#')) return { bare: specifier, suffix: '' };
  const q = specifier.indexOf('?');
  const h = specifier.indexOf('#');
  const index = q === -1 ? h : h === -1 ? q : Math.min(q, h);
  return index === -1 ? { bare: specifier, suffix: '' } : { bare: specifier.slice(0, index), suffix: specifier.slice(index) };
}

function fileType(stat) { return stat?.type === 'directory' ? 'dir' : stat?.type; }

function packageParts(specifier) {
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    if (segments.length < 2 || !segments[0] || !segments[1]) throw ocError(ErrorCodes.INVALID_MODULE_SPECIFIER, 'Invalid scoped package specifier', { specifier });
    return { name: segments.slice(0, 2).join('/'), subpath: segments.slice(2).join('/') };
  }
  if (!segments[0]) throw ocError(ErrorCodes.INVALID_MODULE_SPECIFIER, 'Invalid package specifier', { specifier });
  return { name: segments[0], subpath: segments.slice(1).join('/') };
}

function hasMixedExportsKeys(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const keys = Object.keys(value);
  return keys.some((key) => key.startsWith('.')) && keys.some((key) => !key.startsWith('.'));
}

function patternKeyCompare(a, b) {
  const aStar = a.indexOf('*');
  const bStar = b.indexOf('*');
  const aBase = aStar === -1 ? a.length : aStar;
  const bBase = bStar === -1 ? b.length : bStar;
  if (aBase !== bBase) return bBase - aBase;
  return b.length - a.length;
}

export class NodeResolver {
  #fs;
  #cache = new Map();
  #packageCache = new Map();
  #builtins;

  constructor({ fs, builtins = BUILTINS } = {}) {
    assertOc(fs && typeof fs.stat === 'function' && typeof fs.readFile === 'function', ErrorCodes.INVALID_ARGUMENT, 'Resolver filesystem is required');
    this.#fs = fs;
    this.#builtins = new Set(builtins);
  }

  resolve(specifier, issuer = '/workspace/index.js', options = {}) {
    const mode = options.mode ?? 'esm';
    assertOc(mode === 'esm' || mode === 'cjs', ErrorCodes.INVALID_ARGUMENT, 'Resolver mode must be esm or cjs', { mode });
    assertOc(typeof specifier === 'string' && specifier.length > 0, ErrorCodes.INVALID_MODULE_SPECIFIER, 'Module specifier must be non-empty');

    const issuerInfo = issuer.startsWith('file:') ? pathFromFileURL(issuer) : { path: normalizeAbsolute(issuer), suffix: '' };
    const conditions = new Set(options.conditions ?? (mode === 'esm' ? ['node', 'import'] : ['node', 'require', 'module-sync']));
    const preserveSymlinks = !!options.preserveSymlinks;
    const packageAliases = Object.create(null);
    for (const [from, to] of Object.entries(options.packageAliases ?? {})) {
      const fromParts = packageParts(from);
      const toParts = packageParts(String(to));
      assertOc(!fromParts.subpath && !toParts.subpath, ErrorCodes.INVALID_ARGUMENT, 'Package aliases must map package roots to package roots', { from, to });
      assertOc(from !== to, ErrorCodes.INVALID_ARGUMENT, 'Package alias cannot target itself', { package: from });
      packageAliases[from] = String(to);
    }
    const aliasKey = Object.entries(packageAliases).sort(([a],[b]) => a.localeCompare(b)).map(([from,to]) => from + '>' + to).join(',');
    const generation = String(this.#fs.generation ?? '0');
    const key = [generation, mode, issuerInfo.path, specifier, preserveSymlinks ? '1' : '0', [...conditions].sort().join(','), aliasKey].join('|');
    if (this.#cache.has(key)) return this.#cache.get(key);

    const result = this.#resolveUncached(specifier, issuerInfo.path, { mode, conditions, preserveSymlinks, packageAliases });
    this.#cache.set(key, result);
    return result;
  }

  clearCache() {
    this.#cache.clear();
    this.#packageCache.clear();
  }

  #resolveUncached(specifier, issuer, context) {
    if (specifier.startsWith('node:')) return this.#builtin(specifier.slice(5));
    if (this.#builtins.has(specifier)) return this.#builtin(specifier);

    if (context.mode === 'esm' && /%2f|%5c/i.test(specifier)) {
      throw ocError(ErrorCodes.INVALID_MODULE_SPECIFIER, 'Encoded path separators are forbidden', { specifier });
    }

    if (specifier.startsWith('#')) return this.#resolveImports(specifier, issuer, context);
    const { bare, suffix } = context.mode === 'esm' ? splitEsmSuffix(specifier) : { bare: specifier, suffix: '' };

    if (bare.startsWith('file:')) {
      const parsed = pathFromFileURL(specifier);
      return this.#resolvePath(parsed.path, parsed.suffix, context);
    }

    if (bare.startsWith('/') || bare === '.' || bare === '..' || bare.startsWith('./') || bare.startsWith('../')) {
      const target = bare.startsWith('/') ? normalizeAbsolute(bare) : join(dirname(issuer), bare);
      return this.#resolvePath(target, suffix, context);
    }
    return this.#resolveBare(bare, issuer, suffix, context);
  }

  #builtin(name) {
    if (!this.#builtins.has(name)) throw ocError(ErrorCodes.MODULE_NOT_FOUND, 'Unknown Node builtin', { name });
    return Object.freeze({ kind: 'builtin', specifier: 'node:' + name, url: 'node:' + name, format: 'builtin', cacheKey: 'node:' + name });
  }

  #resolvePath(path, suffix, context) {
    if (context.mode === 'esm') {
      const stat = this.#safeStat(path);
      if (!stat) throw ocError(ErrorCodes.MODULE_NOT_FOUND, 'ESM module not found', { path });
      if (fileType(stat) === 'dir') throw ocError(ErrorCodes.UNSUPPORTED_DIRECTORY_IMPORT, 'ESM directory imports are not supported', { path });
      return this.#finalizeFile(path, suffix, context);
    }
    const loaded = this.#loadAsFile(path) ?? this.#loadAsDirectory(path, new Set());
    if (!loaded) throw ocError(ErrorCodes.MODULE_NOT_FOUND, 'CommonJS module not found', { path });
    return this.#finalizeFile(loaded, '', context);
  }

  #resolveBare(specifier, issuer, suffix, context) {
    const parsed = packageParts(specifier);
    const alias = context.packageAliases?.[parsed.name];
    if (alias) {
      const aliased = alias + (parsed.subpath ? '/' + parsed.subpath : '');
      const remainingAliases = { ...context.packageAliases };
      delete remainingAliases[parsed.name];
      return this.#resolveBare(aliased, issuer, suffix, { ...context, packageAliases: remainingAliases });
    }
    const self = this.#findPackageScope(issuer);
    let packageRoot;
    let packageJson;

    if (self?.json?.name === parsed.name && self.json.exports !== undefined) {
      packageRoot = self.root;
      packageJson = self.json;
    } else {
      packageRoot = this.#findNodeModulesPackage(parsed.name, issuer);
      if (!packageRoot) throw ocError(ErrorCodes.MODULE_NOT_FOUND, 'Package not found', { package: parsed.name, issuer });
      packageJson = this.#readPackageJson(packageRoot) ?? {};
    }

    const subpath = parsed.subpath ? './' + parsed.subpath : '.';
    let target;

    if (packageJson.exports !== undefined) {
      target = this.#resolveExports(packageRoot, packageJson.exports, subpath, context.conditions);
    } else if (parsed.subpath) {
      target = join(packageRoot, parsed.subpath);
      if (context.mode === 'cjs') {
        target = this.#loadAsFile(target) ?? this.#loadAsDirectory(target, new Set());
        if (!target) throw ocError(ErrorCodes.MODULE_NOT_FOUND, 'Package subpath not found', { specifier, packageRoot });
      } else {
        const stat = this.#safeStat(target);
        if (!stat) throw ocError(ErrorCodes.MODULE_NOT_FOUND, 'Package subpath not found', { specifier, packageRoot });
        if (fileType(stat) === 'dir') throw ocError(ErrorCodes.UNSUPPORTED_DIRECTORY_IMPORT, 'ESM package subpath is a directory', { specifier, target });
      }
    } else {
      target = this.#legacyPackageMain(packageRoot, packageJson);
    }

    return this.#finalizeFile(target, suffix, context, packageRoot);
  }

  #resolveImports(specifier, issuer, context) {
    if (specifier === '#' || specifier.startsWith('#/')) throw ocError(ErrorCodes.INVALID_MODULE_SPECIFIER, 'Invalid package import specifier', { specifier });
    const scope = this.#findPackageScope(issuer);
    if (!scope || !scope.json.imports || typeof scope.json.imports !== 'object') {
      throw ocError(ErrorCodes.PACKAGE_IMPORT_NOT_DEFINED, 'Package import is not defined', { specifier });
    }
    const resolved = this.#resolveMap(scope.json.imports, specifier, scope.root, context.conditions, true);
    if (!resolved) throw ocError(ErrorCodes.PACKAGE_IMPORT_NOT_DEFINED, 'Package import is not defined', { specifier });
    if (resolved.external) return this.#resolveUncached(resolved.external, issuer, context);
    return this.#resolvePath(resolved.path, '', context);
  }

  #resolveExports(packageRoot, exportsField, subpath, conditions) {
    if (hasMixedExportsKeys(exportsField)) {
      throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Package exports mixes subpath and condition keys', { packageRoot });
    }

    let target = null;
    if (subpath === '.') {
      let mainExport;
      if (typeof exportsField === 'string' || Array.isArray(exportsField) || exportsField === null) mainExport = exportsField;
      else if (exportsField && typeof exportsField === 'object') {
        const keys = Object.keys(exportsField);
        if (keys.every((key) => !key.startsWith('.'))) mainExport = exportsField;
        else if (Object.prototype.hasOwnProperty.call(exportsField, '.')) mainExport = exportsField['.'];
      }
      if (mainExport !== undefined) target = this.#resolveTarget(mainExport, packageRoot, conditions, false, null);
    } else if (exportsField && typeof exportsField === 'object' && Object.keys(exportsField).every((key) => key.startsWith('.'))) {
      target = this.#resolveMap(exportsField, subpath, packageRoot, conditions, false);
    }

    if (!target || target.external) throw ocError(ErrorCodes.PACKAGE_PATH_NOT_EXPORTED, 'Package subpath is not exported', { packageRoot, subpath });
    return target.path;
  }

  #resolveMap(map, key, packageRoot, conditions, isImports) {
    if (Object.prototype.hasOwnProperty.call(map, key) && !key.includes('*')) {
      return this.#resolveTarget(map[key], packageRoot, conditions, isImports, null);
    }
    const patterns = Object.keys(map).filter((candidate) => candidate.includes('*')).sort(patternKeyCompare);
    for (const pattern of patterns) {
      const star = pattern.indexOf('*');
      const prefix = pattern.slice(0, star);
      const trailer = pattern.slice(star + 1);
      if (!key.startsWith(prefix) || !key.endsWith(trailer) || key.length < prefix.length + trailer.length) continue;
      const subpath = key.slice(prefix.length, key.length - trailer.length);
      const resolved = this.#resolveTarget(map[pattern], packageRoot, conditions, isImports, subpath);
      if (resolved) return resolved;
    }
    return null;
  }

  #resolveTarget(target, packageRoot, conditions, isImports, patternSubpath) {
    if (target === null) return null;
    if (typeof target === 'string') {
      const replaced = patternSubpath === null ? target : target.replaceAll('*', patternSubpath);
      if (replaced.startsWith('./')) {
        const relative = replaced.slice(2);
        const segments = relative.split('/');
        if (segments.some((segment) => segment === '..' || segment === '.' || segment === 'node_modules')) {
          throw ocError(ErrorCodes.INVALID_PACKAGE_TARGET, 'Invalid package target', { target: replaced });
        }
        const path = join(packageRoot, relative);
        if (path !== packageRoot && !path.startsWith(packageRoot + '/')) throw ocError(ErrorCodes.INVALID_PACKAGE_TARGET, 'Package target escapes package root', { target: replaced });
        const stat = this.#safeStat(path);
        if (!stat) throw ocError(ErrorCodes.MODULE_NOT_FOUND, 'Package target does not exist', { target: replaced, path });
        if (fileType(stat) === 'dir') throw ocError(ErrorCodes.UNSUPPORTED_DIRECTORY_IMPORT, 'Package target resolves to a directory', { path });
        return { path };
      }
      if (isImports && !replaced.startsWith('../') && !replaced.startsWith('/') && !replaced.startsWith('#')) return { external: replaced };
      throw ocError(ErrorCodes.INVALID_PACKAGE_TARGET, 'Package target must be package-relative', { target: replaced });
    }

    if (Array.isArray(target)) {
      let lastInvalid = null;
      for (const item of target) {
        try {
          const resolved = this.#resolveTarget(item, packageRoot, conditions, isImports, patternSubpath);
          if (resolved) return resolved;
        } catch (error) {
          if (error?.code === ErrorCodes.INVALID_PACKAGE_TARGET) lastInvalid = error;
          else throw error;
        }
      }
      if (lastInvalid) throw lastInvalid;
      return null;
    }

    if (target && typeof target === 'object') {
      for (const key of Object.keys(target)) {
        if (/^(0|[1-9]\d*)$/.test(key)) throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Integer condition keys are not allowed', { key });
        if (key === 'default' || conditions.has(key)) {
          const resolved = this.#resolveTarget(target[key], packageRoot, conditions, isImports, patternSubpath);
          if (resolved) return resolved;
        }
      }
      return null;
    }
    throw ocError(ErrorCodes.INVALID_PACKAGE_TARGET, 'Unsupported package target type', { targetType: typeof target });
  }

  #legacyPackageMain(packageRoot, packageJson) {
    if (typeof packageJson.main === 'string' && packageJson.main) {
      const candidate = join(packageRoot, packageJson.main);
      const loaded = this.#loadAsFile(candidate) ?? this.#loadAsDirectory(candidate, new Set([packageRoot]));
      if (loaded) return loaded;
    }
    const index = this.#loadIndex(packageRoot);
    if (index) return index;
    throw ocError(ErrorCodes.MODULE_NOT_FOUND, 'Package entry point not found', { packageRoot });
  }

  #loadAsFile(path) {
    const exact = this.#safeStat(path);
    if (exact && fileType(exact) === 'file') {
      if (path.endsWith('.node')) throw ocError(ErrorCodes.NATIVE_ADDON_UNSUPPORTED, 'Native addons are outside the V1 profile', { path });
      return path;
    }
    for (const extension of ['.js', '.json', '.node']) {
      const candidate = path + extension;
      const stat = this.#safeStat(candidate);
      if (!stat || fileType(stat) !== 'file') continue;
      if (extension === '.node') throw ocError(ErrorCodes.NATIVE_ADDON_UNSUPPORTED, 'Native addons are outside the V1 profile', { path: candidate });
      return candidate;
    }
    return null;
  }

  #loadAsDirectory(path, seen) {
    const stat = this.#safeStat(path);
    if (!stat || fileType(stat) !== 'dir' || seen.has(path)) return null;
    seen.add(path);
    const json = this.#readPackageJson(path);
    if (json && typeof json.main === 'string' && json.main) {
      const candidate = join(path, json.main);
      const loaded = this.#loadAsFile(candidate) ?? this.#loadAsDirectory(candidate, seen);
      if (loaded) return loaded;
    }
    return this.#loadIndex(path);
  }

  #loadIndex(path) {
    for (const extension of ['.js', '.json', '.node']) {
      const candidate = join(path, 'index' + extension);
      const stat = this.#safeStat(candidate);
      if (!stat || fileType(stat) !== 'file') continue;
      if (extension === '.node') throw ocError(ErrorCodes.NATIVE_ADDON_UNSUPPORTED, 'Native addons are outside the V1 profile', { path: candidate });
      return candidate;
    }
    return null;
  }

  #findNodeModulesPackage(name, issuer) {
    let current = dirname(issuer);
    while (true) {
      const candidate = join(current, 'node_modules', name);
      const stat = this.#safeStat(candidate);
      if (stat && fileType(stat) === 'dir') return candidate;
      if (current === '/') break;
      current = dirname(current);
    }
    return null;
  }

  #findPackageScope(path) {
    let current = dirname(path);
    while (true) {
      if (!current.endsWith('/node_modules')) {
        const json = this.#readPackageJson(current);
        if (json) return { root: current, json };
      }
      if (current === '/') break;
      current = dirname(current);
    }
    return null;
  }

  #readPackageJson(root) {
    const generation = String(this.#fs.generation ?? '0');
    const key = generation + '|' + root;
    if (this.#packageCache.has(key)) return this.#packageCache.get(key);
    let result = null;
    try {
      result = JSON.parse(this.#fs.readFile(join(root, 'package.json')));
    } catch (error) {
      if (error instanceof SyntaxError) throw ocError(ErrorCodes.INVALID_PACKAGE_CONFIG, 'Invalid package.json', { root });
      result = null;
    }
    this.#packageCache.set(key, result);
    return result;
  }

  #format(path) {
    if (path.endsWith('.mjs')) return 'module';
    if (path.endsWith('.cjs')) return 'commonjs';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.node')) return 'addon';
    if (path.endsWith('.js')) {
      const scope = this.#findPackageScope(path);
      if (scope?.json?.type === 'module') return 'module';
      if (scope?.json?.type === 'commonjs') return 'commonjs';
      return 'ambiguous';
    }
    return 'commonjs';
  }

  #finalizeFile(path, suffix, context, packageRoot = null) {
    const canonical = context.preserveSymlinks || typeof this.#fs.realpath !== 'function' ? normalizeAbsolute(path) : this.#fs.realpath(path);
    const format = this.#format(canonical);
    if (format === 'addon') throw ocError(ErrorCodes.NATIVE_ADDON_UNSUPPORTED, 'Native addons are outside the V1 profile', { path: canonical });
    const url = pathToFileURL(canonical) + suffix;
    return Object.freeze({ kind: 'file', path: canonical, url, format, packageRoot, cacheKey: context.mode === 'cjs' ? canonical : url });
  }

  #safeStat(path) {
    try { return this.#fs.stat(path); } catch { return null; }
  }
}

export { BUILTINS as NODE_BUILTINS };
