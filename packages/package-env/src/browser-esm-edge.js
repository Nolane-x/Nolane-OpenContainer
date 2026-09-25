import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

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
      reject(ocError(ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Service Worker did not claim the page in time', { timeoutMs }));
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
        return;
      }
      if (worker?.state === 'redundant') {
        cleanup();
        reject(ocError(ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Service Worker became redundant before activation'));
      }
    };

    const onUpdateFound = () => {
      attach(registration.installing ?? registration.waiting ?? registration.active);
    };

    registration.addEventListener?.('updatefound', onUpdateFound);
    worker?.addEventListener?.('statechange', onStateChange);
    timer = setTimeout(() => {
      cleanup();
      reject(ocError(ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Service Worker did not activate in time', {
        timeoutMs,
        state: worker?.state ?? null
      }));
    }, timeoutMs);
    onStateChange();
  });
}

export class BrowserEsmServiceWorkerBridge {
  #publication;
  #container;
  #scriptURL;
  #scope;
  #timeoutMs;
  #registration = null;
  #listener = null;
  #closed = false;

  constructor({
    publication,
    serviceWorkerContainer = globalThis.navigator?.serviceWorker,
    scriptURL = '/opencontainer-sw.js',
    scope = '/',
    timeoutMs = 5000
  } = {}) {
    assertOc(publication && typeof publication.response === 'function', ErrorCodes.INVALID_ARGUMENT, 'Native ESM publication authority is required');
    assertOc(serviceWorkerContainer && typeof serviceWorkerContainer.register === 'function', ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Service Worker API is unavailable');
    this.#publication = publication;
    this.#container = serviceWorkerContainer;
    this.#scriptURL = scriptURL;
    this.#scope = scope;
    this.#timeoutMs = timeoutMs;
  }

  get session() { return this.#publication.session; }
  get registration() { return this.#registration; }

  async start() {
    if (this.#closed) throw ocError(ErrorCodes.INVALID_STATE, 'ESM Service Worker bridge is closed');
    if (!this.#listener) {
      this.#listener = (event) => { void this.#receive(event); };
      this.#container.addEventListener('message', this.#listener);
    }

    this.#registration = await this.#container.register(this.#scriptURL, { scope: this.#scope, updateViaCache: 'none' });
    await waitForRegistrationActive(this.#registration, this.#timeoutMs);
    const controller = await waitForController(this.#container, this.#timeoutMs);

    return Object.freeze({
      session: this.session,
      scope: this.#registration.scope,
      controllerURL: controller.scriptURL
    });
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
    if (!data || data.type !== 'opencontainer:esm-fetch' || !port) return;

    if (data.session !== this.session) {
      // Multiple publication bridges may coexist on one Window while a new
      // generation/session is promoted. A non-owner must stay silent so it
      // cannot win the shared MessagePort race ahead of the actual owner.
      return;
    }

    try {
      const response = await this.#publication.response(data.url);
      const headers = Object.fromEntries(response.headers.entries());
      const contentType = response.headers.get('content-type') ?? '';
      const binary = contentType.split(';', 1)[0].trim().toLowerCase() === 'application/wasm';
      const body = binary
        ? new Uint8Array(await response.arrayBuffer())
        : await response.text();
      port.postMessage({
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers,
        body
      });
    } catch (error) {
      port.postMessage({
        ok: false,
        code: error?.code ?? ErrorCodes.GUEST_WORKER_FAILED,
        message: error?.message ?? String(error),
        details: error?.details
      });
    }
  }
}
