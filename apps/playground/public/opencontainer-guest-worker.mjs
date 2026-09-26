import { createSyncRpcMailbox, waitSyncRpcMailbox } from '/packages/process/src/sync-rpc.js';

// Node-targeted tooling frequently references the legacy global alias directly.
// Keep it realm-local: it points at this isolated guest Worker, never the host Window.
globalThis.global ??= globalThis;

// The guest shares an origin with the trusted playground/page for publication
// delivery, so browser globals must not silently become authority bypasses.
// Native module loading remains available, but direct guest access to external
// networking and origin-wide storage/coordination is denied by default.
let activePublicationSession = null;

function guestDenied(operation, code = 'OC_NETWORK_DENIED') {
  const error = new Error(operation + ' is unavailable in the OpenContainer guest realm');
  error.code = code;
  throw error;
}

function publicationPrefix() {
  return activePublicationSession
    ? '/__opencontainer__/esm/' + encodeURIComponent(activePublicationSession) + '/'
    : null;
}

function publicationUrl(value, operation) {
  const raw = typeof value === 'string' || value instanceof URL
    ? String(value)
    : value?.url;
  if (typeof raw !== 'string' || raw.length === 0) guestDenied(operation);
  const url = new URL(raw, globalThis.location?.href);
  const prefix = publicationPrefix();
  if (!prefix || url.origin !== globalThis.location?.origin || !url.pathname.startsWith(prefix)) {
    guestDenied(operation);
  }
  return url;
}

function replaceConstructor(name, validate = null) {
  const Native = globalThis[name];
  if (typeof Native !== 'function') return null;
  function Restricted() {
    if (!new.target) throw new TypeError(name + ' constructor must be called with new');
    if (validate) validate(arguments);
    guestDenied(name);
  }
  try {
    Object.defineProperty(Restricted, 'name', { value: name });
    Restricted.prototype = Native.prototype;
    Object.defineProperty(Native.prototype, 'constructor', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Restricted
    });
    Object.setPrototypeOf(Restricted, Function.prototype);
    globalThis[name] = Restricted;
  } catch {
    try { globalThis[name] = Restricted; } catch {}
  }
  return Native;
}

function denyMethod(target, name, code = 'OC_NETWORK_DENIED') {
  if (!target) return false;
  let owner = target;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) {
    owner = Object.getPrototypeOf(owner);
  }
  if (!owner || typeof owner[name] !== 'function') return false;
  const denied = function () { return guestDenied(name, code); };
  try {
    Object.defineProperty(owner, name, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: denied
    });
    return true;
  } catch {
    try { target[name] = denied; return target[name] === denied; } catch { return false; }
  }
}

const nativeFetch = globalThis.fetch;
if (typeof nativeFetch === 'function') {
  globalThis.fetch = function openContainerGuestFetch(input, init) {
    publicationUrl(input, 'fetch');
    return Reflect.apply(nativeFetch, globalThis, [input, init]);
  };
}

// A narrowly retained child-worker exception exists only for the exact
// Rolldown WASI helper already admitted by the promoted toolchain court.
// Arbitrary publication modules cannot spawn fresh unconfined worker realms.
const NativeWorker = globalThis.Worker;
if (typeof NativeWorker === 'function') {
  function RestrictedWorker(url, options) {
    if (!new.target) throw new TypeError('Worker constructor must be called with new');
    const parsed = publicationUrl(url, 'Worker');
    let decodedPath = parsed.pathname;
    try { decodedPath = decodeURIComponent(decodedPath); } catch {}
    if (!decodedPath.endsWith('/workspace/node_modules/@rolldown/browser/dist/wasi-worker-browser.mjs')) {
      guestDenied('Worker');
    }
    return Reflect.construct(NativeWorker, [parsed.href, options], NativeWorker);
  }
  RestrictedWorker.prototype = NativeWorker.prototype;
  try {
    Object.defineProperty(NativeWorker.prototype, 'constructor', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: RestrictedWorker
    });
    Object.setPrototypeOf(RestrictedWorker, Function.prototype);
  } catch {}
  globalThis.Worker = RestrictedWorker;
}

for (const name of ['WebSocket', 'EventSource', 'WebTransport', 'XMLHttpRequest', 'SharedWorker', 'BroadcastChannel']) {
  replaceConstructor(name);
}

if (typeof globalThis.importScripts === 'function') {
  try {
    Object.defineProperty(globalThis, 'importScripts', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: () => guestDenied('importScripts')
    });
  } catch {}
}

// Origin-wide state is trusted-host authority. Guest code reaches mutable
// workspace/package state only through explicit OpenContainer bridges.
for (const name of ['open', 'deleteDatabase', 'databases']) denyMethod(globalThis.indexedDB, name, 'OC_BUILTIN_UNAVAILABLE');
for (const name of ['open', 'match', 'keys', 'delete']) denyMethod(globalThis.caches, name, 'OC_BUILTIN_UNAVAILABLE');
for (const name of ['get', 'getAll', 'set', 'delete']) denyMethod(globalThis.cookieStore, name, 'OC_BUILTIN_UNAVAILABLE');

const guestNavigator = globalThis.navigator;
if (guestNavigator?.storage) {
  for (const name of ['getDirectory', 'estimate', 'persist', 'persisted']) {
    denyMethod(guestNavigator.storage, name, 'OC_BUILTIN_UNAVAILABLE');
  }
}
if (guestNavigator?.locks) {
  for (const name of ['request', 'query']) denyMethod(guestNavigator.locks, name, 'OC_BUILTIN_UNAVAILABLE');
}
if (guestNavigator?.serviceWorker) {
  for (const name of ['register', 'getRegistration', 'getRegistrations']) {
    denyMethod(guestNavigator.serviceWorker, name, 'OC_BUILTIN_UNAVAILABLE');
  }
}

const pendingHost = new Map();
let nextHostId = 0;

function hostRequest(method, payload) {
  const id = ++nextHostId;
  return new Promise((resolve, reject) => {
    pendingHost.set(id, { resolve, reject });
    self.postMessage({ type: 'opencontainer:host-request', id, method, payload });
  });
}

globalThis.__opencontainer_sync_host_call__ = (method, payload) => {
  const shared = createSyncRpcMailbox();
  self.postMessage({
    type: 'opencontainer:host-sync-request',
    method: String(method),
    payload,
    shared
  });
  return waitSyncRpcMailbox(shared, { timeoutMs: 5000 });
};

globalThis.__opencontainer_dynamic_import__ = async (referrer, specifier) => {
  const target = await hostRequest('resolve-dynamic', { referrer, specifier: String(specifier) });
  return import(target);
};


function reportDiagnostic(kind, detail = {}) {
  try {
    self.postMessage({
      type: 'opencontainer:guest-diagnostic',
      kind,
      detail
    });
  } catch {}
}

let nestedWorkerTelemetryInstalled = false;
function installNestedWorkerTelemetry() {
  if (nestedWorkerTelemetryInstalled || typeof globalThis.Worker !== 'function') return;
  nestedWorkerTelemetryInstalled = true;
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class OpenContainerObservedWorker extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      reportDiagnostic('nested-worker.created', {
        url: String(url),
        type: options?.type ?? null
      });
      this.addEventListener('error', (event) => {
        reportDiagnostic('nested-worker.error', {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
      });
      this.addEventListener('messageerror', () => {
        reportDiagnostic('nested-worker.messageerror');
      });
    }
  };
  self.addEventListener('napi-rs-worker-error', (event) => {
    const detail = event.detail;
    reportDiagnostic('napi-rs-worker-error', {
      type: detail?.type ?? null,
      message: detail?.error?.message ?? (detail?.error ? String(detail.error) : null),
      errorOutputs: detail?.errorOutputs ?? null
    });
  });
}

const exportSizeEncoder = new TextEncoder();

function exportLimitError(limit, estimatedBytes) {
  const error = new Error('Guest export payload exceeded OpenContainer output limit');
  error.code = 'OC_OUTPUT_LIMIT';
  error.details = { limit, estimatedBytes };
  return error;
}

function estimateCloneBytes(value, limit) {
  let total = 0;
  const seen = new WeakSet();
  const add = (bytes) => {
    total += Math.max(0, Number(bytes) || 0);
    if (total > limit) throw exportLimitError(limit, total);
  };
  const visit = (entry) => {
    if (entry === null || entry === undefined) { add(4); return; }
    const type = typeof entry;
    if (type === 'string') { add(8 + exportSizeEncoder.encode(entry).byteLength); return; }
    if (type === 'number') { add(8); return; }
    if (type === 'bigint') { add(16); return; }
    if (type === 'boolean') { add(4); return; }
    if (type !== 'object') { add(8); return; }

    if (seen.has(entry)) { add(8); return; }
    seen.add(entry);

    if (entry instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && entry instanceof SharedArrayBuffer)) {
      add(16 + entry.byteLength);
      return;
    }
    if (ArrayBuffer.isView(entry)) {
      add(32 + entry.byteLength);
      return;
    }
    if (typeof Blob !== 'undefined' && entry instanceof Blob) {
      add(64 + entry.size);
      return;
    }
    if (entry instanceof Date) { add(16); return; }
    if (entry instanceof RegExp) {
      add(24 + exportSizeEncoder.encode(entry.source + entry.flags).byteLength);
      return;
    }
    if (entry instanceof Error) {
      add(48);
      visit(entry.name);
      visit(entry.message);
      if (entry.stack) visit(entry.stack);
      return;
    }
    if (entry instanceof Map) {
      add(32);
      for (const [key, mapValue] of entry) { visit(key); visit(mapValue); }
      return;
    }
    if (entry instanceof Set) {
      add(24);
      for (const setValue of entry) visit(setValue);
      return;
    }
    if (Array.isArray(entry)) {
      add(24 + entry.length * 4);
      for (const item of entry) visit(item);
      return;
    }

    add(32);
    for (const key of Object.keys(entry)) {
      add(8 + exportSizeEncoder.encode(key).byteLength);
      visit(entry[key]);
    }
  };
  visit(value);
  return total;
}

function cloneExports(namespace, exportNames, maxExportBytes) {
  const names = exportNames ?? Object.keys(namespace);
  const out = {};
  let bytes = 0;
  for (const name of names) {
    if (!(name in namespace)) continue;
    const value = namespace[name];
    if (typeof value === 'function' || typeof value === 'symbol') continue;
    const cloned = structuredClone(value);
    bytes += 8 + exportSizeEncoder.encode(String(name)).byteLength;
    if (bytes > maxExportBytes) throw exportLimitError(maxExportBytes, bytes);
    bytes += estimateCloneBytes(cloned, maxExportBytes - bytes);
    if (bytes > maxExportBytes) throw exportLimitError(maxExportBytes, bytes);
    out[name] = cloned;
  }
  return { exports: out, bytes };
}

self.addEventListener('message', async (event) => {
  const message = event.data;

  if (message?.type === 'opencontainer:host-response') {
    const pending = pendingHost.get(message.id);
    if (!pending) return;
    pendingHost.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else {
      const error = new Error(message.error?.message ?? 'OpenContainer host request failed');
      error.code = message.error?.code;
      error.details = message.error?.details;
      pending.reject(error);
    }
    return;
  }

  if (!message || message.v !== 1 || message.type !== 'request') return;

  let response;
  try {
    if (message.method !== 'execute-module') throw new Error('Unknown worker method: ' + message.method);
    activePublicationSession = String(message.payload.publicationSession ?? '');
    if (!activePublicationSession) throw new Error('Guest execution is missing publication session');
    publicationUrl(message.payload.entryURL, 'execute-module');
    if (message.payload.observeNestedWorkers === true) installNestedWorkerTelemetry();
    const namespace = await import(message.payload.entryURL);
    response = {
      v: 1,
      type: 'response',
      session: message.session,
      epoch: message.epoch,
      id: message.id,
      ok: true,
      value: (() => {
        const cloned = cloneExports(
          namespace,
          message.payload.exportNames,
          Math.max(1, Number(message.payload.maxExportBytes) || 1)
        );
        return {
          exports: cloned.exports,
          exportBytes: cloned.bytes,
          maxExportBytes: message.payload.maxExportBytes,
          workerCrossOriginIsolated: globalThis.crossOriginIsolated === true,
          publicationSession: message.payload.publicationSession
        };
      })()
    };
  } catch (error) {
    response = {
      v: 1,
      type: 'response',
      session: message.session,
      epoch: message.epoch,
      id: message.id,
      ok: false,
      error: {
        code: error?.code ?? 'OC_GUEST_WORKER_FAILED',
        message: error?.message ?? String(error),
        details: {
          ...(error?.details && typeof error.details === 'object' ? error.details : {}),
          guestName: error?.name,
          guestStack: error?.stack,
          entryURL: message.payload?.entryURL
        }
      }
    };
  }

  self.postMessage(response);
});
