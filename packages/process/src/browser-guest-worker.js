import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';
import { WorkerRpcAuthority } from './worker-authority.js';
import { settleSyncRpcMailbox } from './sync-rpc.js';

const WORKER_PROFILE_URLS = Object.freeze({
  strict: '/opencontainer-guest-worker.mjs',
  toolchain: '/opencontainer-toolchain-worker.mjs'
});

export class BrowserGuestWorkerAuthority {
  #publication;
  #Worker;
  #workerURL;
  #profile;
  #diagnostics;
  #maxPending;
  #worker = null;
  #rpc = null;
  #hostListener = null;
  #closed = false;
  #syncRequestHandler;
  #maxSyncResponseBytes;
  #resources;
  #workerLease = null;

  constructor({
    publication,
    WorkerImpl = globalThis.Worker,
    profile = 'strict',
    workerURL = null,
    diagnostics,
    maxPending = 64,
    requestTimeoutMs = 5000,
    syncRequestHandler = null,
    maxSyncResponseBytes = 1024 * 1024,
    resources = null
  } = {}) {
    assertOc(publication && typeof publication.resolveDynamic === 'function', ErrorCodes.INVALID_ARGUMENT, 'Native ESM publication authority is required');
    assertOc(typeof WorkerImpl === 'function', ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Dedicated Worker API is unavailable');
    assertOc(
      Object.prototype.hasOwnProperty.call(WORKER_PROFILE_URLS, profile),
      ErrorCodes.INVALID_ARGUMENT,
      'Browser guest Worker profile must be strict or toolchain',
      { profile }
    );
    assertOc(
      workerURL === null || (typeof workerURL === 'string' && workerURL.length > 0),
      ErrorCodes.INVALID_ARGUMENT,
      'Browser guest Worker URL override must be a non-empty string',
      { workerURL }
    );
    this.#publication = publication;
    this.#Worker = WorkerImpl;
    this.#profile = profile;
    this.#workerURL = workerURL ?? WORKER_PROFILE_URLS[profile];
    this.#diagnostics = diagnostics;
    this.#maxPending = maxPending;
    this.requestTimeoutMs = Math.max(1, Number(requestTimeoutMs) || 5000);
    this.#syncRequestHandler = syncRequestHandler;
    this.#maxSyncResponseBytes = Math.max(1024, Number(maxSyncResponseBytes) || 1024 * 1024);
    this.#resources = resources;
  }

  get identity() { return this.#rpc?.identity ?? null; }
  get profile() { return this.#profile; }

  start() {
    if (this.#closed) throw ocError(ErrorCodes.WORKER_CLOSED, 'Browser guest worker authority is closed');
    if (this.#worker) return this.identity;

    const lease = this.#resources?.reserve({ workers: 1 }) ?? null;
    try {
      this.#worker = new this.#Worker(this.#workerURL, {
        type: 'module',
        name: 'opencontainer-' + this.#profile + '-' + this.#publication.session
      });
      this.#workerLease = lease;
    } catch (error) {
      lease?.release();
      throw error;
    }

    this.#hostListener = (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === 'opencontainer:host-request') {
        void this.#handleHostRequest(message);
        return;
      }
      if (message.type === 'opencontainer:host-sync-request') {
        void this.#handleHostSyncRequest(message);
        return;
      }
      if (message.type === 'opencontainer:guest-diagnostic') {
        this.#diagnostics?.record('browser-worker.guest-diagnostic', {
          kind: message.kind,
          detail: message.detail
        });
      }
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
    this.#worker.addEventListener('messageerror', (event) => {
      this.#diagnostics?.record('browser-worker.messageerror', {
        dataType: typeof event.data
      });
    });

    this.#rpc = new WorkerRpcAuthority({
      transport: this.#worker,
      maxPending: this.#maxPending,
      diagnostics: this.#diagnostics,
      requestTimeoutMs: this.requestTimeoutMs
    });
    return this.identity;
  }

  async execute(entryURL, { exportNames = null, observeNestedWorkers = false } = {}) {
    if (!this.#worker) this.start();
    assertOc(typeof entryURL === 'string' && entryURL.length > 0, ErrorCodes.INVALID_ARGUMENT, 'Guest module entry URL is required');
    try {
      return await this.#rpc.request('execute-module', {
        entryURL,
        exportNames: Array.isArray(exportNames) ? [...exportNames] : null,
        publicationSession: this.#publication.session,
        observeNestedWorkers: observeNestedWorkers === true
      });
    } catch (error) {
      if (error?.code === ErrorCodes.WORKER_TIMEOUT) {
        // A timed-out Dedicated Worker may still be executing hostile or runaway
        // guest code. Rejecting the RPC alone is not a resource boundary: hard
        // termination is required so CPU/memory abuse cannot survive the deadline.
        this.#diagnostics?.record('browser-worker.timeout-terminated', {
          entryURL,
          publicationSession: this.#publication.session,
          timeoutMs: this.requestTimeoutMs
        });
        this.#destroyWorker();
      }
      throw error;
    }
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

  async #handleHostSyncRequest(message) {
    const shared = message.shared;
    try {
      if (!(shared instanceof SharedArrayBuffer)) {
        throw ocError(ErrorCodes.INVALID_ARGUMENT, 'Guest sync request is missing SharedArrayBuffer mailbox');
      }
      if (typeof this.#syncRequestHandler !== 'function') {
        throw ocError(ErrorCodes.BUILTIN_UNAVAILABLE, 'No synchronous guest host handler is installed', {
          method: message.method
        });
      }
      const value = await this.#syncRequestHandler(message.method, message.payload);
      settleSyncRpcMailbox(shared, { ok: true, value }, { maxPayloadBytes: this.#maxSyncResponseBytes });
      this.#diagnostics?.record('browser-worker.sync-response', {
        method: message.method,
        ok: true
      });
    } catch (error) {
      try {
        settleSyncRpcMailbox(shared, { ok: false, error }, { maxPayloadBytes: this.#maxSyncResponseBytes });
      } catch {}
      this.#diagnostics?.record('browser-worker.sync-response', {
        method: message.method,
        ok: false,
        error: error?.message
      });
    }
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
    this.#workerLease?.release();
    this.#workerLease = null;
  }
}
