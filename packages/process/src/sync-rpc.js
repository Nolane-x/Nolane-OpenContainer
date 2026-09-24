import { ErrorCodes, ocError } from '../../protocol/src/index.js';

const HEADER_INTS = 4;
const HEADER_BYTES = HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;
const STATE_PENDING = 0;
const STATE_OK = 1;
const STATE_ERROR = 2;
const DEFAULT_PAYLOAD_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function views(shared) {
  if (!(shared instanceof SharedArrayBuffer) || shared.byteLength < HEADER_BYTES + 1) {
    throw ocError(ErrorCodes.INVALID_ARGUMENT, 'Invalid SharedArrayBuffer RPC mailbox');
  }
  return {
    control: new Int32Array(shared, 0, HEADER_INTS),
    payload: new Uint8Array(shared, HEADER_BYTES)
  };
}

function safeEnvelope(ok, value, error) {
  if (ok) return { ok: true, value };
  return {
    ok: false,
    error: {
      code: error?.code ?? ErrorCodes.GUEST_WORKER_FAILED,
      message: error?.message ?? String(error ?? 'Synchronous host request failed'),
      details: error?.details
    }
  };
}

export function createSyncRpcMailbox(payloadBytes = DEFAULT_PAYLOAD_BYTES) {
  const size = Math.max(256, Number(payloadBytes) || DEFAULT_PAYLOAD_BYTES);
  return new SharedArrayBuffer(HEADER_BYTES + size);
}

export function settleSyncRpcMailbox(shared, { ok = true, value, error } = {}, { maxPayloadBytes = DEFAULT_PAYLOAD_BYTES } = {}) {
  const { control, payload } = views(shared);
  if (Atomics.load(control, 0) !== STATE_PENDING) return false;

  let envelope = safeEnvelope(ok, value, error);
  let bytes;
  try {
    bytes = encoder.encode(JSON.stringify(envelope));
  } catch (serializationError) {
    envelope = safeEnvelope(false, null, ocError(ErrorCodes.GUEST_WORKER_FAILED, 'Synchronous host response is not JSON-serializable', {
      cause: serializationError?.message
    }));
    bytes = encoder.encode(JSON.stringify(envelope));
  }

  const limit = Math.min(payload.byteLength, Math.max(1, Number(maxPayloadBytes) || DEFAULT_PAYLOAD_BYTES));
  if (bytes.byteLength > limit) {
    envelope = safeEnvelope(false, null, ocError(ErrorCodes.OUTPUT_LIMIT, 'Synchronous host response exceeds mailbox limit', {
      bytes: bytes.byteLength,
      limit
    }));
    bytes = encoder.encode(JSON.stringify(envelope));
  }
  if (bytes.byteLength > payload.byteLength) {
    const minimal = encoder.encode(JSON.stringify({
      ok: false,
      error: { code: ErrorCodes.OUTPUT_LIMIT, message: 'Synchronous host response mailbox is too small' }
    }));
    if (minimal.byteLength > payload.byteLength) {
      Atomics.store(control, 1, 0);
      Atomics.store(control, 0, STATE_ERROR);
      Atomics.notify(control, 0);
      return true;
    }
    bytes = minimal;
    envelope = null;
  }

  payload.fill(0, 0, bytes.byteLength);
  payload.set(bytes, 0);
  Atomics.store(control, 1, bytes.byteLength);
  Atomics.store(control, 0, envelope?.ok === true ? STATE_OK : STATE_ERROR);
  Atomics.notify(control, 0);
  return true;
}

export function waitSyncRpcMailbox(shared, { timeoutMs = 5000 } = {}) {
  const { control, payload } = views(shared);
  const timeout = Math.max(1, Number(timeoutMs) || 5000);

  let state = Atomics.load(control, 0);
  if (state === STATE_PENDING) {
    let outcome;
    try {
      outcome = Atomics.wait(control, 0, STATE_PENDING, timeout);
    } catch (error) {
      throw ocError(ErrorCodes.ESM_EDGE_UNAVAILABLE, 'Synchronous Worker RPC requires Atomics.wait support', {
        cause: error?.message
      });
    }
    if (outcome === 'timed-out') {
      throw ocError(ErrorCodes.WORKER_TIMEOUT, 'Synchronous Worker RPC timed out', { timeoutMs: timeout });
    }
    state = Atomics.load(control, 0);
  }

  const length = Atomics.load(control, 1);
  if (!Number.isInteger(length) || length <= 0 || length > payload.byteLength) {
    throw ocError(ErrorCodes.GUEST_WORKER_FAILED, 'Invalid synchronous Worker RPC response length', {
      state,
      length,
      capacity: payload.byteLength
    });
  }

  let envelope;
  try {
    envelope = JSON.parse(decoder.decode(payload.subarray(0, length)));
  } catch (error) {
    throw ocError(ErrorCodes.GUEST_WORKER_FAILED, 'Invalid synchronous Worker RPC response envelope', {
      cause: error?.message
    });
  }

  if (state === STATE_OK && envelope?.ok === true) return envelope.value;
  const remote = envelope?.error ?? {};
  throw ocError(
    remote.code ?? ErrorCodes.GUEST_WORKER_FAILED,
    remote.message ?? 'Synchronous Worker RPC failed',
    remote.details
  );
}

export const SyncRpcConstants = Object.freeze({
  HEADER_BYTES,
  STATE_PENDING,
  STATE_OK,
  STATE_ERROR,
  DEFAULT_PAYLOAD_BYTES
});
