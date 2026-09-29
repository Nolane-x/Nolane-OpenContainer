self.onmessage=(event)=>{
  const message=event.data??{};
  if(message.type==='sab'){
    const view=new Int32Array(message.buffer);
    const before=Atomics.load(view,0);
    const after=Atomics.add(view,0,1)+1;
    self.postMessage({type:'sab-result',before,after,crossOriginIsolated:self.crossOriginIsolated===true});
    return;
  }
  self.postMessage({type:'echo',value:message.value??null,crossOriginIsolated:self.crossOriginIsolated===true});
};
