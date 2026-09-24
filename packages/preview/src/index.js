import { ErrorCodes, ocError } from '../../protocol/src/index.js';

export class PreviewAuthority {
  #routes=new Map();#epoch=0;
  get epoch(){return this.#epoch;}
  publish({port,owner,handler}){
    if(!Number.isInteger(port)||port<1||port>65535||!owner||typeof handler!=='function')throw ocError(ErrorCodes.INVALID_ARGUMENT,'Invalid preview route');
    const epoch=++this.#epoch;const route=Object.freeze({port,owner,epoch,handler});this.#routes.set(port,route);
    return Object.freeze({port,owner,epoch,url:'opencontainer://preview/'+port+'?epoch='+epoch});
  }
  revoke(port,{owner}={}){
    const route=this.#routes.get(port);if(!route)return false;if(owner&&route.owner!==owner)return false;
    this.#routes.delete(port);this.#epoch++;return true;
  }
  async dispatch(port,request={},proof={}){
    const route=this.#routes.get(port);if(!route)throw ocError(ErrorCodes.NOT_FOUND,'Preview route not found',{port});
    if(proof.epoch!==undefined&&proof.epoch!==route.epoch)throw ocError(ErrorCodes.PREVIEW_STALE,'Stale preview epoch',{expected:route.epoch,actual:proof.epoch});
    if(proof.owner!==undefined&&proof.owner!==route.owner)throw ocError(ErrorCodes.PREVIEW_STALE,'Stale preview owner',{expected:route.owner,actual:proof.owner});
    return route.handler(request);
  }
  list(){return [...this.#routes.values()].map(({handler,...route})=>Object.freeze(route));}
}
