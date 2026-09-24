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
    await this.#container.ready;
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
      port.postMessage({ ok: false, notOwner: true, code: 'OC_ESM_SESSION_NOT_OWNED' });
      return;
    }

    try {
      const response = await this.#publication.response(data.url);
      port.postMessage({
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text()
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
