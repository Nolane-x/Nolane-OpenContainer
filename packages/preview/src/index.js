import { ErrorCodes, ocError } from '../../protocol/src/index.js';

function normalizePreviewIdentity(identity={}){
  const normalize=(value)=>value==null?null:String(value);
  return Object.freeze({
    workspace:normalize(identity?.workspace),
    session:normalize(identity?.session),
    version:normalize(identity?.version)
  });
}

function identityRequired(identity){
  return identity.workspace!==null||identity.session!==null||identity.version!==null;
}

function assertIdentityMatches(expected,actual){
  if(!identityRequired(expected))return;
  const received=normalizePreviewIdentity(actual);
  for(const key of ['workspace','session','version']){
    if(received[key]!==expected[key]){
      throw ocError(ErrorCodes.PREVIEW_STALE,'Stale preview '+key+' identity',{key,expected:expected[key],actual:received[key]});
    }
  }
}

export class PreviewAuthority {
  #routes=new Map();#epoch=0;
  get epoch(){return this.#epoch;}
  publish({port,owner,handler,identity={}}){
    if(!Number.isInteger(port)||port<1||port>65535||!owner||typeof handler!=='function')throw ocError(ErrorCodes.INVALID_ARGUMENT,'Invalid preview route');
    const epoch=++this.#epoch;
    const routeIdentity=normalizePreviewIdentity(identity);
    const route=Object.freeze({port,owner,epoch,identity:routeIdentity,handler});this.#routes.set(port,route);
    return Object.freeze({port,owner,epoch,identity:routeIdentity,url:'opencontainer://preview/'+port+'?epoch='+epoch});
  }
  revoke(port,{owner}={}){
    const route=this.#routes.get(port);if(!route)return false;if(owner&&route.owner!==owner)return false;
    this.#routes.delete(port);this.#epoch++;return true;
  }
  async dispatch(port,request={},proof={}){
    const route=this.#routes.get(port);if(!route)throw ocError(ErrorCodes.NOT_FOUND,'Preview route not found',{port});
    if(proof.epoch!==undefined&&proof.epoch!==route.epoch)throw ocError(ErrorCodes.PREVIEW_STALE,'Stale preview epoch',{expected:route.epoch,actual:proof.epoch});
    if(proof.owner!==undefined&&proof.owner!==route.owner)throw ocError(ErrorCodes.PREVIEW_STALE,'Stale preview owner',{expected:route.owner,actual:proof.owner});
    assertIdentityMatches(route.identity,proof.identity);
    return route.handler(request);
  }
  list(){return [...this.#routes.values()].map(({handler,...route})=>Object.freeze(route));}
}

export { BrowserPreviewServiceWorkerBridge } from './browser-service-worker.js';


export function createSandboxedPreviewFrame({
  url='about:blank',
  html=null,
  documentRef=globalThis.document,
  title='OpenContainer preview',
  credentialless=false
}={}){
  if(!documentRef||typeof documentRef.createElement!=='function'){
    throw ocError(ErrorCodes.INVALID_STATE,'Sandboxed preview frame requires a browser document');
  }
  const frame=documentRef.createElement('iframe');
  frame.src=String(url??'about:blank');
  if(typeof html==='string')frame.srcdoc=html;
  frame.title=String(title);
  frame.referrerPolicy='no-referrer';
  frame.setAttribute('sandbox','allow-scripts allow-forms allow-modals allow-pointer-lock allow-downloads');
  frame.setAttribute('allow','');
  if('credentialless' in frame)frame.credentialless=credentialless===true;
  frame.dataset.opencontainerPreview='sandboxed';
  return frame;
}
