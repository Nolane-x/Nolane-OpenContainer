import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { ensureCompatibleServiceWorker } from '../../protocol/src/service-worker-compatibility.js';

function waitForController(container, timeoutMs) {
  if (container.controller) return Promise.resolve(container.controller);
  return new Promise((resolve, reject) => {
    let timer;
    const onChange = () => {
      if (!container.controller) return;
      cleanup();
      resolve(container.controller);
    };
    const cleanup = () => {
      clearTimeout(timer);
      container.removeEventListener('controllerchange', onChange);
    };
    timer = setTimeout(() => {
      cleanup();
      reject(ocError(ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Preview Service Worker did not claim the page in time', { timeoutMs }));
    }, timeoutMs);
    container.addEventListener('controllerchange', onChange);
  });
}

function waitForRegistrationActive(registration, timeoutMs) {
  if (registration.active?.state === 'activated') return Promise.resolve(registration.active);
  return new Promise((resolve, reject) => {
    let timer = null;
    let worker = registration.installing ?? registration.waiting ?? registration.active ?? null;
    const cleanup = () => {
      clearTimeout(timer);
      registration.removeEventListener?.('updatefound', onUpdateFound);
      worker?.removeEventListener?.('statechange', onStateChange);
    };
    const attach = (candidate) => {
      if (!candidate || candidate === worker) return;
      worker?.removeEventListener?.('statechange', onStateChange);
      worker = candidate;
      worker.addEventListener?.('statechange', onStateChange);
      onStateChange();
    };
    const onStateChange = () => {
      const active = registration.active;
      if (active?.state === 'activated' || worker?.state === 'activated') {
        cleanup();
        resolve(active ?? worker);
      } else if (worker?.state === 'redundant') {
        cleanup();
        reject(ocError(ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Preview Service Worker became redundant before activation'));
      }
    };
    const onUpdateFound = () => attach(registration.installing ?? registration.waiting ?? registration.active);
    registration.addEventListener?.('updatefound', onUpdateFound);
    worker?.addEventListener?.('statechange', onStateChange);
    timer = setTimeout(() => {
      cleanup();
      reject(ocError(ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Preview Service Worker did not activate in time', {
        timeoutMs,
        state: worker?.state ?? null
      }));
    }, timeoutMs);
    onStateChange();
  });
}

function normalizeGuestPath(value) {
  const raw = String(value ?? '/');
  return raw.startsWith('/') ? raw : '/' + raw;
}

export class BrowserPreviewServiceWorkerBridge {
  #preview;
  #container;
  #scriptURL;
  #scope;
  #timeoutMs;
  #diagnostics;
  #baseURL;
  #registration = null;
  #listener = null;
  #closed = false;

  constructor({
    preview,
    serviceWorkerContainer = globalThis.navigator?.serviceWorker,
    scriptURL = '/opencontainer-sw.js',
    scope = '/',
    timeoutMs = 5000,
    diagnostics = null,
    baseURL = globalThis.location?.origin
  } = {}) {
    assertOc(preview && typeof preview.dispatch === 'function', ErrorCodes.INVALID_ARGUMENT, 'Preview authority is required');
    assertOc(serviceWorkerContainer && typeof serviceWorkerContainer.register === 'function', ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Service Worker API is unavailable');
    assertOc(typeof baseURL === 'string' && /^https?:\/\//.test(baseURL), ErrorCodes.INVALID_ARGUMENT, 'Browser preview bridge requires an http(s) base URL');
    this.#preview = preview;
    this.#container = serviceWorkerContainer;
    this.#scriptURL = scriptURL;
    this.#scope = scope;
    this.#timeoutMs = Math.max(1, Number(timeoutMs) || 5000);
    this.#diagnostics = diagnostics;
    this.#baseURL = baseURL;
  }

  get registration() { return this.#registration; }

  async start() {
    if (this.#closed) throw ocError(ErrorCodes.INVALID_STATE, 'Preview Service Worker bridge is closed');
    if (!this.#listener) {
      this.#listener = (event) => { void this.#receive(event); };
      this.#container.addEventListener('message', this.#listener);
    }
    this.#registration = await this.#container.register(this.#scriptURL, { scope: this.#scope, updateViaCache: 'none' });
    const lifecycle = await ensureCompatibleServiceWorker({
      container: this.#container,
      registration: this.#registration,
      timeoutMs: this.#timeoutMs
    });
    const controller = lifecycle.controller;
    return Object.freeze({
      scope: this.#registration.scope,
      controllerURL: controller.scriptURL,
      serviceWorkerCompatibilityId: lifecycle.compatibilityId,
      serviceWorkerActivation: lifecycle.activation
    });
  }

  url(receipt, path = '/') {
    assertOc(receipt && Number.isInteger(receipt.port) && receipt.owner && Number.isInteger(receipt.epoch), ErrorCodes.INVALID_ARGUMENT, 'Valid preview receipt is required');
    const guest = new URL(normalizeGuestPath(path), 'http://opencontainer-preview.invalid');
    const url = new URL('/__opencontainer__/preview/' + receipt.port + guest.pathname, this.#baseURL);
    for (const [key, value] of guest.searchParams) url.searchParams.append(key, value);
    url.searchParams.set('__oc_owner', receipt.owner);
    url.searchParams.set('__oc_epoch', String(receipt.epoch));
    return url.href;
  }

  close() {
    if (this.#closed) return false;
    this.#closed = true;
    if (this.#listener) this.#container.removeEventListener('message', this.#listener);
    this.#listener = null;
    return true;
  }

  async #receive(event) {
    const data = event.data;
    const port = event.ports?.[0];
    if (!data || data.type !== 'opencontainer:preview-fetch' || !port) return;
    try {
      const response = await this.#preview.dispatch(
        Number(data.port),
        {
          url: data.url,
          method: data.method,
          headers: data.headers ?? {},
          body: data.body == null ? null : Uint8Array.from(data.body)
        },
        { owner: data.owner, epoch: Number(data.epoch) }
      );
      const headers = Object.fromEntries(response.headers.entries());
      const body = String(data.method).toUpperCase() === 'HEAD'
        ? null
        : new Uint8Array(await response.arrayBuffer());
      port.postMessage({
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers,
        body
      });
      this.#diagnostics?.record('preview-edge.response', {
        port: Number(data.port),
        owner: data.owner,
        epoch: Number(data.epoch),
        status: response.status,
        bytes: body?.byteLength ?? 0
      });
    } catch (error) {
      this.#diagnostics?.record('preview-edge.failure', {
        port: Number(data.port),
        owner: data.owner,
        epoch: Number(data.epoch),
        code: error?.code,
        message: error?.message
      });
      port.postMessage({
        ok: false,
        code: error?.code ?? ErrorCodes.INVALID_STATE,
        message: error?.message ?? String(error),
        details: error?.details
      });
    }
  }
}
