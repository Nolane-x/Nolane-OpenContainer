import { ErrorCodes, ocError } from './index.js';

export const SERVICE_WORKER_COMPATIBILITY_ID='opencontainer-sw-edge-v1:rpc1:snapshot1:opfs1';

function timeoutError(message,details){
  return ocError(ErrorCodes.ESM_EDGE_UNAVAILABLE,message,details);
}

function incompatible(message,details){
  return ocError(ErrorCodes.SERVICE_WORKER_INCOMPATIBLE,message,details);
}

function waitForWorkerState(worker,states,timeoutMs){
  if(worker&&states.includes(worker.state))return Promise.resolve(worker);
  return new Promise((resolve,reject)=>{
    let timer=null;
    const cleanup=()=>{
      clearTimeout(timer);
      worker?.removeEventListener?.('statechange',onStateChange);
    };
    const onStateChange=()=>{
      if(worker?.state==='redundant'){
        cleanup();
        reject(timeoutError('Service Worker became redundant before compatibility promotion',{state:worker.state}));
        return;
      }
      if(states.includes(worker?.state)){
        cleanup();
        resolve(worker);
      }
    };
    worker?.addEventListener?.('statechange',onStateChange);
    timer=setTimeout(()=>{
      cleanup();
      reject(timeoutError('Service Worker did not reach a compatible lifecycle state in time',{
        timeoutMs,
        state:worker?.state??null,
        expectedStates:states
      }));
    },timeoutMs);
    onStateChange();
  });
}

function waitForController(container,timeoutMs){
  if(container.controller)return Promise.resolve(container.controller);
  return new Promise((resolve,reject)=>{
    let timer=null;
    const cleanup=()=>{
      clearTimeout(timer);
      container.removeEventListener?.('controllerchange',onChange);
    };
    const onChange=()=>{
      if(!container.controller)return;
      cleanup();
      resolve(container.controller);
    };
    container.addEventListener?.('controllerchange',onChange);
    timer=setTimeout(()=>{
      cleanup();
      reject(timeoutError('Compatible Service Worker did not claim the page in time',{timeoutMs}));
    },timeoutMs);
    onChange();
  });
}

function workerRpc(worker,message,timeoutMs){
  if(!worker||typeof worker.postMessage!=='function'){
    return Promise.reject(timeoutError('Service Worker messaging is unavailable',{state:worker?.state??null}));
  }
  if(typeof MessageChannel!=='function'){
    return Promise.reject(timeoutError('MessageChannel is unavailable for Service Worker compatibility handshake'));
  }
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    let timer=null;
    const cleanup=()=>{
      clearTimeout(timer);
      try{channel.port1.close();}catch{}
    };
    channel.port1.onmessage=(event)=>{
      cleanup();
      const data=event.data;
      if(!data?.ok){
        reject(incompatible(data?.message??'Service Worker compatibility handshake was rejected',{
          code:data?.code??null,
          expected:SERVICE_WORKER_COMPATIBILITY_ID,
          actual:data?.compatibilityId??null
        }));
        return;
      }
      resolve(data);
    };
    timer=setTimeout(()=>{
      cleanup();
      reject(timeoutError('Service Worker compatibility handshake timed out',{
        timeoutMs,
        type:message.type,
        state:worker?.state??null
      }));
    },timeoutMs);
    worker.postMessage(message,[channel.port2]);
  });
}

async function queryCompatibility(worker,timeoutMs){
  const receipt=await workerRpc(worker,{type:'opencontainer:sw-compatibility-query'},timeoutMs);
  if(receipt.compatibilityId!==SERVICE_WORKER_COMPATIBILITY_ID){
    throw incompatible('Service Worker compatibility profile does not match the current runtime',{
      expected:SERVICE_WORKER_COMPATIBILITY_ID,
      actual:receipt.compatibilityId??null
    });
  }
  return receipt;
}

async function authorize(worker,action,timeoutMs){
  const receipt=await workerRpc(worker,{
    type:action,
    expectedCompatibilityId:SERVICE_WORKER_COMPATIBILITY_ID
  },timeoutMs);
  if(receipt.compatibilityId!==SERVICE_WORKER_COMPATIBILITY_ID){
    throw incompatible('Service Worker authorization returned a mismatched compatibility profile',{
      expected:SERVICE_WORKER_COMPATIBILITY_ID,
      actual:receipt.compatibilityId??null,
      action
    });
  }
  return receipt;
}

async function waitingCandidate(registration,timeoutMs){
  if(registration.waiting)return registration.waiting;
  if(registration.installing){
    await waitForWorkerState(registration.installing,['installed','activated'],timeoutMs);
    return registration.waiting??registration.active??registration.installing;
  }
  return null;
}

export async function ensureCompatibleServiceWorker({
  container,
  registration,
  timeoutMs=5000
}={}){
  if(!container||!registration)throw timeoutError('Service Worker compatibility lifecycle requires a container and registration');

  const current=container.controller??null;
  if(current){
    try{
      const profile=await queryCompatibility(current,timeoutMs);
      return Object.freeze({
        controller:current,
        compatibilityId:profile.compatibilityId,
        activation:'existing-compatible'
      });
    }catch(error){
      const candidate=await waitingCandidate(registration,timeoutMs);
      if(!candidate)throw error;
    }
  }

  if(registration.active?.state==='activated'&&!container.controller){
    await queryCompatibility(registration.active,timeoutMs);
    await authorize(registration.active,'opencontainer:sw-claim',timeoutMs);
    const controller=await waitForController(container,timeoutMs);
    const profile=await queryCompatibility(controller,timeoutMs);
    return Object.freeze({
      controller,
      compatibilityId:profile.compatibilityId,
      activation:'compatible-active-claim'
    });
  }

  const candidate=await waitingCandidate(registration,timeoutMs);
  if(!candidate){
    throw timeoutError('No compatible Service Worker candidate is available',{
      activeState:registration.active?.state??null,
      waitingState:registration.waiting?.state??null,
      installingState:registration.installing?.state??null
    });
  }

  if(candidate.state==='activated'){
    await queryCompatibility(candidate,timeoutMs);
  }else{
    await waitForWorkerState(candidate,['installed'],timeoutMs);
    await queryCompatibility(candidate,timeoutMs);
    await authorize(candidate,'opencontainer:sw-activate',timeoutMs);
    await waitForWorkerState(candidate,['activated'],timeoutMs);
    await queryCompatibility(candidate,timeoutMs);
  }

  if(!container.controller){
    await authorize(candidate,'opencontainer:sw-claim',timeoutMs);
  }
  const controller=await waitForController(container,timeoutMs);
  const profile=await queryCompatibility(controller,timeoutMs);
  return Object.freeze({
    controller,
    compatibilityId:profile.compatibilityId,
    activation:'compatibility-authorized'
  });
}
