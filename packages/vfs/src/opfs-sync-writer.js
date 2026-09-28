let nextRequestId=0;

export function browserOpfsSyncWriterAvailable(){
  return (
    typeof globalThis.Worker==='function' &&
    typeof globalThis.URL==='function'
  );
}

export async function writeOpfsTextWithExplicitFlush(fileHandle,text){
  if(!browserOpfsSyncWriterAvailable()){
    throw new TypeError('Browser OPFS SyncAccessHandle writer is unavailable in this environment');
  }
  if(!fileHandle||typeof fileHandle!=='object'){
    throw new TypeError('FileSystemFileHandle is required for explicit OPFS flush');
  }

  const worker=new Worker(new URL('./opfs-sync-writer-worker.js',import.meta.url),{type:'module'});
  const id='opfs-sync-write-'+(++nextRequestId);
  try{
    const response=await new Promise((resolve,reject)=>{
      let settled=false;
      const cleanup=()=>{
        worker.removeEventListener('message',onMessage);
        worker.removeEventListener('error',onError);
      };
      const onMessage=event=>{
        if(event.data?.id!==id)return;
        if(settled)return;
        settled=true;
        cleanup();
        resolve(event.data);
      };
      const onError=event=>{
        if(settled)return;
        settled=true;
        cleanup();
        reject(event.error??new Error(event.message||'OPFS sync writer worker failed'));
      };
      worker.addEventListener('message',onMessage);
      worker.addEventListener('error',onError);
      worker.postMessage({id,handle:fileHandle,text:String(text)});
    });

    if(response?.ok!==true){
      const error=new Error(response?.error?.message??'OPFS explicit flush worker failed');
      if(response?.error?.name)error.name=response.error.name;
      throw error;
    }
    return Object.freeze({
      ...response.receipt,
      requestId:id
    });
  }finally{
    worker.terminate();
  }
}
