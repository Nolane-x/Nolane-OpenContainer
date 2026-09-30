function checksum(bytes){
  let sum=0;
  for(let index=0;index<bytes.length;index+=4096)sum=(sum+bytes[index])>>>0;
  return sum;
}

self.postMessage({type:'ready'});

self.addEventListener('message',(event)=>{
  const request=event.data;
  if(!request||request.v!==1||request.type!=='request')return;
  if(request.method!=='roundtrip'){
    self.postMessage({
      v:1,type:'response',session:request.session,epoch:request.epoch,id:request.id,ok:false,
      error:{code:'OC_INVALID_ARGUMENT',message:'Unknown P7 worker method'}
    });
    return;
  }
  const buffer=request.payload?.buffer;
  if(!(buffer instanceof ArrayBuffer)){
    self.postMessage({
      v:1,type:'response',session:request.session,epoch:request.epoch,id:request.id,ok:false,
      error:{code:'OC_INVALID_ARGUMENT',message:'P7 roundtrip requires ArrayBuffer'}
    });
    return;
  }
  const bytes=new Uint8Array(buffer);
  const value={buffer,byteLength:bytes.byteLength,checksum:checksum(bytes)};
  self.postMessage({
    v:1,type:'response',session:request.session,epoch:request.epoch,id:request.id,ok:true,value
  },[buffer]);
});
