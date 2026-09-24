import { ErrorCodes, ocError } from '../../protocol/src/index.js';

function workerErrorFromEnvelope(error) {
  if (!error) return ocError(ErrorCodes.INVALID_STATE, 'Worker request failed');
  return ocError(error.code || ErrorCodes.INVALID_STATE, error.message || 'Worker request failed', error.details);
}

export class WorkerRpcAuthority {
  #transport = null;
  #listener = null;
  #diagnostics;
  #maxPending;
  #pending = new Map();
  #epoch = 0;
  #session = null;
  #nextId = 0;
  #closed = false;

  constructor({ transport = null, maxPending = 64, diagnostics } = {}) {
    this.#diagnostics = diagnostics;
    this.#maxPending = Math.max(1, Number(maxPending) || 1);
    if (transport) this.restart(transport);
  }

  get identity() {
    return Object.freeze({ session: this.#session, epoch: this.#epoch });
  }

  get pendingCount() {
    return this.#pending.size;
  }

  restart(transport = this.#transport) {
    if (this.#closed) throw ocError(ErrorCodes.WORKER_CLOSED, 'Worker authority is closed');
    if (!transport || typeof transport.postMessage !== 'function') {
      throw ocError(ErrorCodes.INVALID_ARGUMENT, 'Worker transport must expose postMessage()');
    }

    this.#detach();
    this.#rejectPending(
      ocError(ErrorCodes.WORKER_STALE, 'Worker session restarted', { epoch: this.#epoch })
    );

    this.#transport = transport;
    this.#epoch += 1;
    this.#session = 'worker-session-' + this.#epoch;
    this.#nextId = 0;

    this.#listener = (event) => this.receive(event && 'data' in event ? event.data : event);
    if (typeof transport.addEventListener === 'function') {
      transport.addEventListener('message', this.#listener);
    }

    this.#diagnostics?.record('worker.session', this.identity);
    return this.identity;
  }

  request(method, payload, { transfer } = {}) {
    if (this.#closed) throw ocError(ErrorCodes.WORKER_CLOSED, 'Worker authority is closed');
    if (!this.#transport) throw ocError(ErrorCodes.INVALID_STATE, 'Worker transport is not attached');
    if (typeof method !== 'string' || !method) {
      throw ocError(ErrorCodes.INVALID_ARGUMENT, 'Worker RPC method must be a non-empty string');
    }
    if (this.#pending.size >= this.#maxPending) {
      throw ocError(ErrorCodes.RESOURCE_EXHAUSTED, 'Worker RPC pending limit reached', {
        pending: this.#pending.size,
        limit: this.#maxPending
      });
    }

    const id = ++this.#nextId;
    const envelope = Object.freeze({
      v: 1,
      type: 'request',
      session: this.#session,
      epoch: this.#epoch,
      id,
      method,
      payload
    });

    let resolve;
    let reject;
    const response = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.#pending.set(id, { resolve, reject, method });
    try {
      if (transfer !== undefined) this.#transport.postMessage(envelope, transfer);
      else this.#transport.postMessage(envelope);
    } catch (error) {
      this.#pending.delete(id);
      reject(error);
    }

    this.#diagnostics?.record('worker.request', {
      session: this.#session,
      epoch: this.#epoch,
      id,
      method
    });

    return response;
  }

  receive(message) {
    if (!message || message.v !== 1 || message.type !== 'response') return false;

    if (message.session !== this.#session || message.epoch !== this.#epoch) {
      this.#diagnostics?.record('worker.stale-response', {
        expectedSession: this.#session,
        expectedEpoch: this.#epoch,
        actualSession: message.session,
        actualEpoch: message.epoch,
        id: message.id
      });
      return false;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return false;
    this.#pending.delete(message.id);

    if (message.ok === false) pending.reject(workerErrorFromEnvelope(message.error));
    else pending.resolve(message.value);

    this.#diagnostics?.record('worker.response', {
      session: this.#session,
      epoch: this.#epoch,
      id: message.id,
      method: pending.method,
      ok: message.ok !== false
    });

    return true;
  }

  close() {
    if (this.#closed) return false;
    this.#closed = true;
    this.#detach();
    this.#rejectPending(ocError(ErrorCodes.WORKER_CLOSED, 'Worker authority closed'));
    this.#transport = null;
    this.#diagnostics?.record('worker.closed', { epoch: this.#epoch });
    return true;
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #detach() {
    if (this.#transport && this.#listener && typeof this.#transport.removeEventListener === 'function') {
      this.#transport.removeEventListener('message', this.#listener);
    }
    this.#listener = null;
  }
}
