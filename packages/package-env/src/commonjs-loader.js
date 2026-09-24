import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

function dirname(path) {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

function defaultEvaluator(source, { exports, require, module, filename, dirname: moduleDir }) {
  const sourceURL = '\n//# sourceURL=opencontainer://' + encodeURI(filename);
  const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', source + sourceURL);
  return wrapper(exports, require, module, filename, moduleDir);
}

export class CommonJsLoader {
  #fs;
  #resolver;
  #builtins;
  #cache = new Map();
  #evaluator;
  #allowDynamicCode;

  constructor({ fs, resolver, builtins = {}, evaluator = null, allowDynamicCode = false } = {}) {
    assertOc(fs && typeof fs.readFile === 'function', ErrorCodes.INVALID_ARGUMENT, 'CommonJS loader filesystem is required');
    assertOc(resolver && typeof resolver.resolve === 'function', ErrorCodes.INVALID_ARGUMENT, 'CommonJS resolver is required');
    this.#fs = fs;
    this.#resolver = resolver;
    this.#builtins = new Map(Object.entries(builtins));
    this.#evaluator = evaluator;
    this.#allowDynamicCode = !!allowDynamicCode;
  }

  require(specifier, issuer = '/workspace/index.cjs') {
    const resolved = this.#resolver.resolve(specifier, issuer, { mode: 'cjs' });
    return this.#loadResolved(resolved, issuer);
  }

  resolve(specifier, issuer = '/workspace/index.cjs') {
    const resolved = this.#resolver.resolve(specifier, issuer, { mode: 'cjs' });
    return resolved.kind === 'builtin' ? resolved.specifier : resolved.path;
  }

  hasCached(filename) {
    return this.#cache.has(filename);
  }

  clear(filename = null) {
    if (filename === null) this.#cache.clear();
    else this.#cache.delete(filename);
  }

  #loadResolved(resolved, parentFilename) {
    if (resolved.kind === 'builtin') return this.#loadBuiltin(resolved.specifier);
    if (resolved.format === 'module') {
      throw ocError(ErrorCodes.REQUIRE_ESM_UNSUPPORTED, 'Synchronous require(ESM) is not promoted yet', { path: resolved.path });
    }

    const key = resolved.cacheKey;
    const cached = this.#cache.get(key);
    if (cached) return cached.exports;

    const module = {
      id: key,
      filename: resolved.path,
      exports: {},
      loaded: false,
      parent: parentFilename ?? null,
      children: []
    };
    this.#cache.set(key, module);

    try {
      if (resolved.format === 'json') {
        module.exports = JSON.parse(this.#fs.readFile(resolved.path));
        module.loaded = true;
        return module.exports;
      }

      const source = this.#fs.readFile(resolved.path);
      const localRequire = (specifier) => {
        const child = this.#resolver.resolve(specifier, resolved.path, { mode: 'cjs' });
        if (child.kind === 'file' && !module.children.includes(child.path)) module.children.push(child.path);
        return this.#loadResolved(child, resolved.path);
      };
      localRequire.resolve = (specifier) => {
        const child = this.#resolver.resolve(specifier, resolved.path, { mode: 'cjs' });
        return child.kind === 'builtin' ? child.specifier : child.path;
      };

      const evaluator = this.#evaluator ?? (this.#allowDynamicCode ? defaultEvaluator : null);
      if (!evaluator) {
        throw ocError(ErrorCodes.MODULE_EXECUTION_DISABLED, 'CommonJS source execution requires a guest-worker evaluator');
      }

      evaluator(source, {
        exports: module.exports,
        require: localRequire,
        module,
        filename: resolved.path,
        dirname: dirname(resolved.path)
      });
      module.loaded = true;
      return module.exports;
    } catch (error) {
      this.#cache.delete(key);
      throw error;
    }
  }

  #loadBuiltin(specifier) {
    const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    if (this.#builtins.has(specifier)) return this.#builtins.get(specifier);
    if (this.#builtins.has(bare)) return this.#builtins.get(bare);
    throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'Node builtin is not implemented by the current compatibility profile', { specifier });
  }
}
