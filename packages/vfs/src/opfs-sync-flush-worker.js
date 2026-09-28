const encoder=new TextEncoder();

function errorEnvelope(error){
  return {
    name:error?.name??'Error',
    message:error?.message??String(error),
    stack:typeof error?.stack==='string'?error.stack:null
  };
}

function bytesEqual(a,b){
  if(a.byteLength!==b.byteLength)return false;
  for(let i=0;i<a.byteLength;i++)if(a[i]!==b[i])return false;
  return true;
}

self.onmessage=async(event)=>{
  const {id,directory,name,content}=event.data??{};
  let access=null;
  let closed=false;
  try{
    if(!directory||typeof directory.getFileHandle!=='function')throw new TypeError('OPFS directory handle is required');
    if(typeof name!=='string'||!name)throw new TypeError('OPFS file name is required');
    const file=await directory.getFileHandle(name,{create:true});
    if(typeof file.createSyncAccessHandle!=='function'){
      throw new TypeError('FileSystemSyncAccessHandle is unavailable in this Dedicated Worker');
    }
    access=await file.createSyncAccessHandle();
    const bytes=encoder.encode(String(content));
    access.truncate(0);
    const written=access.write(bytes,{at:0});
    if(written!==bytes.byteLength)throw new Error('SyncAccessHandle short write: '+written+'/'+bytes.byteLength);
    access.truncate(bytes.byteLength);
    access.flush();

    const size=access.getSize();
    const verify=new Uint8Array(size);
    const read=access.read(verify,{at:0});
    if(read!==bytes.byteLength||!bytesEqual(verify,bytes)){
      throw new Error('SyncAccessHandle read-after-flush verification failed');
    }
    access.close();
    closed=true;

    self.postMessage({
      id,
      ok:true,
      receipt:{
        schema:'opencontainer.opfs-sync-flush-write.v1.0',
        name,
        bytes:bytes.byteLength,
        bytesWritten:written,
        bytesReadAfterFlush:read,
        sizeAfterFlush:size,
        writeCalled:true,
        truncateCalled:true,
        flushCalled:true,
        closeCalled:true,
        readAfterFlushVerified:true,
        dedicatedWorker:true,
        syncAccessHandle:true,
        apiBoundary:'flush-attempts-cached-modifications-to-underlying-storage-device',
        powerLossGuaranteed:false,
        osFsyncGuaranteed:false
      }
    });
  }catch(error){
    if(access&&!closed){
      try{access.close();closed=true;}catch{}
    }
    self.postMessage({id,ok:false,error:errorEnvelope(error)});
  }
};
