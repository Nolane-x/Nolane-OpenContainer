import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { WorkerRpcAuthority } from './worker-authority.js';

export class BrowserGuestWorkerAuthority {
  #publication;
  #Worker;
  #workerURL;
  #diagnostics;
  #maxPending;
  #worker = null;
  #rpc = null;
  #hostListener = null;
  #closed = false;

  constructor({
    publication,
    WorkerImpl = globalThis.Worker,
    workerURL = '/opencontainer-guest-worker.mjs',
    diagnostics,
    maxPending = 64
  } = {}) {
    assertOc(publication && typeof publication.resolveDynamic === 'function', ErrorCodes.INVALID_ARGUMENT, 'Native ESM publication authority is required');
    assertOc(typeof WorkerImpl === 'function', ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Dedicated Worker API is unavailable');
    this.#publication = publication;
    this.#Worker = WorkerImpl;
    this.#workerURL = workerURL;
    this.#diagnostics = diagnostics;
    this.#maxPending = maxPending;
  }

  get identity() { return this.#rpc?.identity ?? null; }

  start() {
    if (this.#closed) throw ocError(ErrorCodes.WORKER_CLOSED, 'Browser guest worker authority is closed');
    if (this.#worker) return this.identity;

    this.#worker = new this.#Worker(this.#workerURL, {
      type: 'module',
      name: 'opencontainer-guest-' + this.#publication.session
    });

    this.#hostListener = (event) => {
      const message = event.data;
      if (!message || message.type !== 'opencontainer:host-request') return;
      void this.#handleHostRequest(message);
    };
    this.#worker.addEventListener('message', this.#hostListener);
    this.#worker.addEventListener('error', (event) => {
      this.#diagnostics?.record('browser-worker.error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    this.#rpc = new WorkerRpcAuthority({
      transport: this.#worker,
      maxPending: this.#maxPending,
      diagnostics: this.#diagnostics
    });
    return this.identity;
  }

  async execute(entryURL, { exportNames = null } = {}) {
    if (!this.#worker) this.start();
    assertOc(typeof entryURL === 'string' && entryURL.length > 0, ErrorCodes.INVALID_ARGUMENT, 'Guest module entry URL is required');
    return this.#rpc.request('execute-module', {
      entryURL,
      exportNames: Array.isArray(exportNames) ? [...exportNames] : null,
      publicationSession: this.#publication.session
    });
  }

  restart() {
    if (this.#closed) throw ocError(ErrorCodes.WORKER_CLOSED, 'Browser guest worker authority is closed');
    this.#destroyWorker();
    return this.start();
  }

  close() {
    if (this.#closed) return false;
    this.#closed = true;
    this.#destroyWorker();
    return true;
  }

  async #handleHostRequest(message) {
    if (!this.#worker) return;
    let response;
    try {
      if (message.method !== 'resolve-dynamic') {
        throw ocError(ErrorCodes.INVALID_ARGUMENT, 'Unknown guest-worker host request', { method: message.method });
      }
      const value = this.#publication.resolveDynamic(message.payload?.referrer, message.payload?.specifier);
      response = { type: 'opencontainer:host-response', id: message.id, ok: true, value };
    } catch (error) {
      response = {
        type: 'opencontainer:host-response',
        id: message.id,
        ok: false,
        error: {
          code: error?.code ?? ErrorCodes.GUEST_WORKER_FAILED,
          message: error?.message ?? String(error),
          details: error?.details
        }
      };
    }
    this.#worker.postMessage(response);
  }

  #destroyWorker() {
    if (this.#rpc) this.#rpc.close();
    this.#rpc = null;
    if (this.#worker && this.#hostListener) this.#worker.removeEventListener('message', this.#hostListener);
    if (this.#worker) this.#worker.terminate();
    this.#worker = null;
    this.#hostListener = null;
  }
}
