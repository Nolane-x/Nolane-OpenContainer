const encoder=new TextEncoder();

self.addEventListener('message',async event=>{
  const message=event.data??{};
  const id=message.id??null;
  try{
    const handle=message.handle;
    if(!handle||typeof handle.createSyncAccessHandle!=='function'){
      throw new Error('FileSystemFileHandle.createSyncAccessHandle() is unavailable in this worker');
    }
    const access=await handle.createSyncAccessHandle({mode:'readwrite'});
    const steps=[];
    try{
      const bytes=encoder.encode(String(message.text??''));
      access.truncate(0);
      steps.push('truncate');
      const written=access.write(bytes,{at:0});
      steps.push('write');
      if(written!==bytes.byteLength){
        throw new Error('Short OPFS SyncAccessHandle write: '+written+'/'+bytes.byteLength);
      }
      access.truncate(bytes.byteLength);
      steps.push('truncate-final');
      access.flush();
      steps.push('flush');
      access.close();
      steps.push('close');
      self.postMessage({
        id,
        ok:true,
        receipt:{
          schema:'opencontainer.opfs-sync-write.v1.0',
          mode:'readwrite',
          bytes:bytes.byteLength,
          written,
          steps,
          flushCompleted:true,
          closeCompleted:true
        }
      });
      return;
    }catch(error){
      try{access.close();}catch{}
      throw error;
    }
  }catch(error){
    self.postMessage({
      id,
      ok:false,
      error:{
        name:error?.name??'Error',
        message:error?.message??String(error)
      }
    });
  }
});
