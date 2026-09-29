import { ErrorCodes, ocError } from '../../protocol/src/index.js';

const byteEncoder=new TextEncoder();
function estimateEnvelopeBytes(value,seen=new WeakSet(),depth=0){
  if(value===null||value===undefined)return 4;
  if(typeof value==='string')return byteEncoder.encode(value).byteLength;
  if(typeof value==='number'||typeof value==='boolean'||typeof value==='bigint')return 16;
  if(value instanceof ArrayBuffer)return value.byteLength;
  if(ArrayBuffer.isView(value))return value.byteLength;
  if(typeof value!=='object')return 16;
  if(depth>=8||seen.has(value))return 32;
  seen.add(value);
  if(Array.isArray(value))return value.reduce((sum,item)=>sum+estimateEnvelopeBytes(item,seen,depth+1),16);
  let total=16;
  for(const [key,item] of Object.entries(value))total+=byteEncoder.encode(key).byteLength+estimateEnvelopeBytes(item,seen,depth+1);
  return total;
}

function workerErrorFromEnvelope(error) {
  if (!error) return ocError(ErrorCodes.INVALID_STATE, 'Worker request failed');
  return ocError(error.code || ErrorCodes.INVALID_STATE, error.message || 'Worker request failed', error.details);
}

export class WorkerRpcAuthority {
  #transport = null;
  #listener = null;
  #errorListener = null;
  #messageErrorListener = null;
  #diagnostics;
  #maxPending;
  #pending = new Map();
  #epoch = 0;
  #session = null;
  #nextId = 0;
  #closed = false;
  #requestTimeoutMs;
  #resources;

  constructor({ transport = null, maxPending = 64, requestTimeoutMs = 0, diagnostics, resources = null } = {}) {
    this.#diagnostics = diagnostics;
    this.#maxPending = Math.max(1, Number(maxPending) || 1);
    this.#requestTimeoutMs = Math.max(0, Number(requestTimeoutMs) || 0);
    this.#resources = resources;
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
    this.#errorListener = (event) => this.#failTransport(
      ocError(ErrorCodes.GUEST_WORKER_FAILED,'Worker transport failed',{
        message:event?.message??null,
        filename:event?.filename??null,
        lineno:event?.lineno??null,
        colno:event?.colno??null
      })
    );
    this.#messageErrorListener = () => this.#failTransport(
      ocError(ErrorCodes.GUEST_WORKER_FAILED,'Worker transport emitted messageerror')
    );
    if (typeof transport.addEventListener === 'function') {
      transport.addEventListener('message', this.#listener);
      transport.addEventListener('error', this.#errorListener);
      transport.addEventListener('messageerror', this.#messageErrorListener);
    }

    this.#diagnostics?.record('worker.session', this.identity);
    return this.identity;
  }

  request(method, payload, { transfer, background=false } = {}) {
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

    const inFlightBytes=estimateEnvelopeBytes(envelope);
    const lease=this.#resources?.acquireTask
      ? this.#resources.acquireTask({background,inFlightBytes})
      : this.#resources?.reserve({tasks:1,inFlightBytes})??null;

    let resolve;
    let reject;
    const response = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    let timer = null;
    if (this.#requestTimeoutMs > 0) {
      timer = setTimeout(() => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        pending.lease?.release();
        const error = ocError(ErrorCodes.WORKER_TIMEOUT, 'Worker RPC request timed out', {
          session: this.#session,
          epoch: this.#epoch,
          id,
          method,
          timeoutMs: this.#requestTimeoutMs
        });
        this.#diagnostics?.record('worker.timeout', error.details);
        pending.reject(error);
      }, this.#requestTimeoutMs);
    }

    this.#pending.set(id, { resolve, reject, method, timer, lease, inFlightBytes, background:background===true });
    try {
      if (transfer !== undefined) this.#transport.postMessage(envelope, transfer);
      else this.#transport.postMessage(envelope);
    } catch (error) {
      this.#pending.delete(id);
      if (timer) clearTimeout(timer);
      lease?.release();
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
    if (pending.timer) clearTimeout(pending.timer);
    let publishError=null;
    try{pending.lease?.assertPublish?.();}
    catch(error){publishError=error;}
    pending.lease?.release();

    if(publishError)pending.reject(publishError);
    else if (message.ok === false) pending.reject(workerErrorFromEnvelope(message.error));
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
    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.lease?.release();
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #failTransport(error) {
    if (!this.#transport) return false;
    this.#diagnostics?.record('worker.transport-failed', {
      session: this.#session,
      epoch: this.#epoch,
      code: error?.code ?? ErrorCodes.GUEST_WORKER_FAILED,
      message: error?.message ?? String(error)
    });
    this.#rejectPending(error);
    this.#detach();
    this.#transport = null;
    return true;
  }

  #detach() {
    if (this.#transport && typeof this.#transport.removeEventListener === 'function') {
      if(this.#listener)this.#transport.removeEventListener('message', this.#listener);
      if(this.#errorListener)this.#transport.removeEventListener('error', this.#errorListener);
      if(this.#messageErrorListener)this.#transport.removeEventListener('messageerror', this.#messageErrorListener);
    }
    this.#listener = null;
    this.#errorListener = null;
    this.#messageErrorListener = null;
  }
}
