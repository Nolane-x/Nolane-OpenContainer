const mutations=new Map();

function respond(request,{ok=true,value=null,error=null,transfer=[]}={}){
  const envelope={
    v:1,
    type:'response',
    session:request.session,
    epoch:request.epoch,
    id:request.id,
    ok
  };
  if(ok)envelope.value=value;
  else envelope.error=error??{code:'OC_GUEST_WORKER_FAILED',message:'worker request failed'};
  self.postMessage(envelope,transfer);
}

self.addEventListener('message',(event)=>{
  const request=event.data;
  if(!request||request.v!==1||request.type!=='request')return;
  const method=request.method;
  const payload=request.payload??{};

  if(method==='echo'){
    respond(request,{value:payload});
    return;
  }
  if(method==='delayed-mutation'){
    mutations.set(String(payload.mutationId),payload.value);
    setTimeout(()=>respond(request,{value:{applied:true,mutationId:String(payload.mutationId)}}),Number(payload.delayMs)||80);
    return;
  }
  if(method==='reconcile-mutation'){
    const id=String(payload.mutationId);
    respond(request,{value:{mutationId:id,applied:mutations.has(id),value:mutations.get(id)??null}});
    return;
  }
  if(method==='delayed-echo'){
    setTimeout(()=>respond(request,{value:payload.value}),Number(payload.delayMs)||80);
    return;
  }
  if(method==='transfer-checksum'){
    const buffer=payload.buffer;
    const bytes=new Uint8Array(buffer);
    let checksum=0;
    for(let i=0;i<bytes.length;i+=4096)checksum=(checksum+bytes[i])>>>0;
    respond(request,{value:{byteLength:bytes.byteLength,checksum}});
    return;
  }
  if(method==='crash'){
    setTimeout(()=>{throw new Error('P2 intentional worker crash');},0);
    return;
  }
  respond(request,{ok:false,error:{code:'OC_INVALID_ARGUMENT',message:'Unknown P2 worker method',details:{method}}});
});
