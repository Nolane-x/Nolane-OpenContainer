import { init as initLexer, parse } from 'es-module-lexer/minimal/js';
import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const STATIC_IMPORT = 1;
const DYNAMIC_IMPORT = 2;
const IMPORT_META = 3;
const STATIC_SOURCE_PHASE = 4;
const DYNAMIC_SOURCE_PHASE = 5;
const STATIC_DEFER_PHASE = 6;
const DYNAMIC_DEFER_PHASE = 7;
const REEXPORT_STAR = 8;

const PHASE_IMPORTS = new Set([
  STATIC_SOURCE_PHASE,
  DYNAMIC_SOURCE_PHASE,
  STATIC_DEFER_PHASE,
  DYNAMIC_DEFER_PHASE
]);

function encodePath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function decodePath(pathname) {
  return '/' + pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/');
}

function suffixFromFileUrl(value) {
  const url = new URL(value);
  return url.search + url.hash;
}

function quoteLike(raw, value) {
  const first = raw[0];
  const last = raw[raw.length - 1];
  if (
    raw.length >= 2 &&
    ((first === "'" && last === "'") ||
      (first === '"' && last === '"') ||
      (first === '`' && last === '`'))
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function applyReplacements(source, replacements) {
  const ordered = [...replacements].sort((a, b) => b.start - a.start || b.end - a.end);
  let output = source;
  let previousStart = source.length + 1;
  for (const replacement of ordered) {
    if (
      !Number.isInteger(replacement.start) ||
      !Number.isInteger(replacement.end) ||
      replacement.start < 0 ||
      replacement.end < replacement.start ||
      replacement.end > source.length ||
      replacement.end > previousStart
    ) {
      throw ocError(ErrorCodes.ESM_PUBLICATION_INVALID, 'Overlapping or invalid ESM rewrite range', {
        start: replacement.start,
        end: replacement.end
      });
    }
    output =
      output.slice(0, replacement.start) +
      replacement.value +
      output.slice(replacement.end);
    previousStart = replacement.start;
  }
  return output;
}

export class NativeEsmPublicationAuthority {
  #fs;
  #resolver;
  #root;
  #session;
  #builtinSource;
  #cache = new Map();
  #ready;

  constructor({
    fs,
    resolver,
    baseURL = 'https://opencontainer.invalid/__opencontainer__/esm/',
    session = 'runtime-1',
    builtinSource = null
  } = {}) {
    assertOc(fs && typeof fs.readFile === 'function', ErrorCodes.INVALID_ARGUMENT, 'ESM publication filesystem is required');
    assertOc(resolver && typeof resolver.resolve === 'function', ErrorCodes.INVALID_ARGUMENT, 'ESM publication resolver is required');
    assertOc(typeof session === 'string' && session.length > 0, ErrorCodes.INVALID_ARGUMENT, 'ESM publication session is required');

    const base = new URL(baseURL);
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    this.#session = session;
    this.#root = new URL(encodeURIComponent(session) + '/', base);
    this.#fs = fs;
    this.#resolver = resolver;
    this.#builtinSource = builtinSource;
    this.#ready = initLexer();
  }

  get rootURL() {
    return this.#root.href;
  }

  get session() {
    return this.#session;
  }

  get generation() {
    return String(this.#fs.generation ?? '0');
  }

  moduleURL(specifier, issuer = '/workspace/index.mjs') {
    const resolved = this.#resolver.resolve(specifier, issuer, { mode: 'esm' });
    return this.#urlForResolved(resolved);
  }

  resolveDynamic(referrerURL, specifier) {
    assertOc(typeof specifier === 'string' && specifier.length > 0, ErrorCodes.INVALID_MODULE_SPECIFIER, 'Dynamic import specifier must be a non-empty string');
    const referrer = this.#classifyURL(referrerURL);
    if (referrer.kind !== 'file') {
      throw ocError(ErrorCodes.ESM_DYNAMIC_IMPORT_UNRESOLVED, 'Dynamic import referrer must be a file module', {
        referrerURL: String(referrerURL)
      });
    }
    return this.moduleURL(specifier, referrer.path).href;
  }

  async serve(url) {
    await this.#ready;
    const publication = this.#classifyURL(url);
    const cacheKey = this.generation + '|' + publication.url.href;
    const cached = this.#cache.get(cacheKey);
    if (cached) return cached;

    let receipt;
    if (publication.kind === 'builtin') {
      receipt = await this.#serveBuiltin(publication);
    } else {
      receipt = await this.#serveFile(publication);
    }
    this.#cache.set(cacheKey, receipt);
    return receipt;
  }

  async response(url) {
    const receipt = await this.serve(url);
    return new Response(receipt.source, {
      status: 200,
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
        'x-opencontainer-generation': receipt.generation,
        'x-opencontainer-session': this.#session
      }
    });
  }

  async graph(entry) {
    const entryURL =
      entry instanceof URL
        ? new URL(entry.href)
        : typeof entry === 'string' && /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(entry)
          ? new URL(entry)
          : this.moduleURL(entry, '/workspace/__opencontainer_entry__.mjs');

    const queue = [entryURL.href];
    const seen = new Map();

    while (queue.length) {
      const href = queue.shift();
      if (seen.has(href)) continue;
      const receipt = await this.serve(href);
      seen.set(href, receipt);
      for (const dependency of receipt.dependencies) {
        if (!seen.has(dependency.url)) queue.push(dependency.url);
      }
    }

    return Object.freeze({
      entryURL: entryURL.href,
      generation: this.generation,
      modules: Object.freeze([...seen.values()])
    });
  }

  clearCache() {
    this.#cache.clear();
  }

  async #serveFile(publication) {
    const source = this.#fs.readFile(publication.path);
    const [imports] = parse(source, publication.path);
    const replacements = [];
    const dependencies = [];

    for (const record of imports) {
      if (record.d === -2 || record.t === IMPORT_META) continue;

      if (PHASE_IMPORTS.has(record.t)) {
        throw ocError(
          ErrorCodes.ESM_IMPORT_PHASE_UNSUPPORTED,
          'Source/defer phase imports are not promoted in the native ESM profile',
          { path: publication.path, type: record.t }
        );
      }

      if (record.n !== undefined) {
        const resolved = this.#resolver.resolve(record.n, publication.path, { mode: 'esm' });
        const targetURL = this.#urlForResolved(resolved);
        const raw = source.slice(record.s, record.e);

        replacements.push({
          start: record.s,
          end: record.e,
          value: quoteLike(raw, targetURL.href)
        });
        dependencies.push(
          Object.freeze({
            specifier: record.n,
            url: targetURL.href,
            dynamic: record.d >= 0 || record.t === DYNAMIC_IMPORT,
            kind: resolved.kind
          })
        );
        continue;
      }

      if (record.d >= 0 || record.t === DYNAMIC_IMPORT) {
        const dynamic = source.slice(record.ss, record.se);
        const open = dynamic.indexOf('(');
        const close = dynamic.lastIndexOf(')');
        if (open < 0 || close <= open) {
          throw ocError(ErrorCodes.ESM_PUBLICATION_INVALID, 'Unable to isolate dynamic import expression', {
            path: publication.path,
            statement: dynamic
          });
        }
        const args = dynamic.slice(open + 1, close);
        replacements.push({
          start: record.ss,
          end: record.se,
          value: 'globalThis.__opencontainer_dynamic_import__(import.meta.url,' + args + ')'
        });
        continue;
      }

      throw ocError(ErrorCodes.ESM_PUBLICATION_INVALID, 'Static module edge has no analyzable specifier', {
        path: publication.path,
        type: record.t
      });
    }

    const transformed = applyReplacements(source, replacements);
    return Object.freeze({
      kind: 'file',
      url: publication.url.href,
      path: publication.path,
      generation: this.generation,
      source: transformed,
      dependencies: Object.freeze(dependencies)
    });
  }

  async #serveBuiltin(publication) {
    if (typeof this.#builtinSource !== 'function') {
      throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'No native ESM builtin source provider is installed', {
        specifier: publication.specifier
      });
    }
    const source = await this.#builtinSource(publication.specifier);
    assertOc(typeof source === 'string', ErrorCodes.BUILTIN_UNAVAILABLE, 'Builtin source provider returned no module source', {
      specifier: publication.specifier
    });
    return Object.freeze({
      kind: 'builtin',
      url: publication.url.href,
      specifier: publication.specifier,
      generation: this.generation,
      source,
      dependencies: Object.freeze([])
    });
  }

  #urlForResolved(resolved) {
    if (resolved.kind === 'builtin') {
      const url = new URL('builtin/' + encodeURIComponent(resolved.specifier) + '.mjs', this.#root);
      return url;
    }

    const suffix = suffixFromFileUrl(resolved.url);
    const url = new URL('fs/' + encodePath(resolved.path), this.#root);
    if (suffix) {
      const parsed = new URL(resolved.url);
      url.search = parsed.search;
      url.hash = parsed.hash;
    }
    return url;
  }

  #classifyURL(value) {
    const url = value instanceof URL ? new URL(value.href) : new URL(String(value));
    if (!url.href.startsWith(this.#root.href)) {
      throw ocError(ErrorCodes.ESM_PUBLICATION_INVALID, 'Module URL is outside the current publication session', {
        expectedRoot: this.#root.href,
        actual: url.href
      });
    }

    const relative = url.pathname.slice(this.#root.pathname.length);
    if (relative.startsWith('fs/')) {
      const path = decodePath(relative.slice(3));
      assertOc(path === '/workspace' || path.startsWith('/workspace/'), ErrorCodes.PATH_ESCAPE, 'Published guest module escaped /workspace', {
        path
      });
      return { kind: 'file', path, url };
    }

    if (relative.startsWith('builtin/') && relative.endsWith('.mjs')) {
      const encoded = relative.slice('builtin/'.length, -'.mjs'.length);
      const specifier = decodeURIComponent(encoded);
      return { kind: 'builtin', specifier, url };
    }

    throw ocError(ErrorCodes.ESM_PUBLICATION_INVALID, 'Unknown native ESM publication route', {
      url: url.href
    });
  }
}
