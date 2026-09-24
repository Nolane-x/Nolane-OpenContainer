import { createSyncRpcMailbox, waitSyncRpcMailbox } from '/packages/process/src/sync-rpc.js';

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

function cloneExports(namespace, exportNames) {
  const names = exportNames ?? Object.keys(namespace);
  const out = {};
  for (const name of names) {
    if (!(name in namespace)) continue;
    const value = namespace[name];
    if (typeof value === 'function' || typeof value === 'symbol') continue;
    out[name] = structuredClone(value);
  }
  return out;
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
    const namespace = await import(message.payload.entryURL);
    response = {
      v: 1,
      type: 'response',
      session: message.session,
      epoch: message.epoch,
      id: message.id,
      ok: true,
      value: {
        exports: cloneExports(namespace, message.payload.exportNames),
        workerCrossOriginIsolated: globalThis.crossOriginIsolated === true,
        publicationSession: message.payload.publicationSession
      }
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
        details: error?.details
      }
    };
  }

  self.postMessage(response);
});
