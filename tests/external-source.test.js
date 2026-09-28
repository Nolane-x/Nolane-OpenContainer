import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryVFS,
  ExternalWorkspaceSourceAuthority,
  ExternalSourceMode,
  ExternalSourceState
} from '../packages/vfs/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

class FakeNotFoundError extends Error{constructor(){super('not found');this.name='NotFoundError';}}

class FakeFileHandle{
  kind='file';
  constructor(data=''){this.data=String(data);}
  async getFile(){
    const bytes=new TextEncoder().encode(this.data);
    return {
      size:bytes.byteLength,
      async text(){return new TextDecoder().decode(bytes);},
      async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
    };
  }
  async createWritable(){
    const handle=this;
    let next='';
    return {
      async write(value){
        if(value instanceof Uint8Array)next=new TextDecoder().decode(value);
        else next=String(value);
      },
      async close(){handle.data=next;},
      async abort(){}
    };
  }
}

class FakeDirectoryHandle{
  kind='directory';
  constructor({permissionRead='granted',permissionReadwrite='granted'}={}){
    this.files=new Map();
    this.dirs=new Map();
    this.permissionRead=permissionRead;
    this.permissionReadwrite=permissionReadwrite;
    this.requested=0;
  }
  async queryPermission({mode='read'}={}){
    return mode==='readwrite'?this.permissionReadwrite:this.permissionRead;
  }
  async requestPermission({mode='read'}={}){
    this.requested++;
    return mode==='readwrite'?this.permissionReadwrite:this.permissionRead;
  }
  async getDirectoryHandle(name,{create=false}={}){
    if(this.dirs.has(name))return this.dirs.get(name);
    if(!create)throw new FakeNotFoundError();
    const child=new FakeDirectoryHandle({
      permissionRead:this.permissionRead,
      permissionReadwrite:this.permissionReadwrite
    });
    this.dirs.set(name,child);
    return child;
  }
  async getFileHandle(name,{create=false}={}){
    if(this.files.has(name))return this.files.get(name);
    if(!create)throw new FakeNotFoundError();
    const file=new FakeFileHandle();
    this.files.set(name,file);
    return file;
  }
  async *entries(){
    for(const entry of this.dirs)yield entry;
    for(const entry of this.files)yield entry;
  }
}

async function put(root,path,data){
  const parts=path.split('/');
  let dir=root;
  for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});
  const file=await dir.getFileHandle(parts.at(-1),{create:true});
  const writable=await file.createWritable();
  await writable.write(data);
  await writable.close();
  return file;
}

test('P3 imported-copy is staged once then detached without silent linked behavior',async()=>{
  const source=new FakeDirectoryHandle();
  await put(source,'src/main.js','export default 1');
  await put(source,'README.md','hello');

  const fs=new MemoryVFS();
  fs.mount({'existing.txt':'keep'});
  const authority=new ExternalWorkspaceSourceAuthority({
    mode:ExternalSourceMode.IMPORTED_COPY,
    handle:source
  });

  const receipt=await authority.importCopyInto(fs);
  assert.equal(receipt.mode,'imported-copy');
  assert.equal(receipt.detached,true);
  assert.equal(receipt.externalWrite,false);
  assert.equal(receipt.silentModeChange,false);
  assert.equal(authority.mode,'imported-copy');
  assert.equal(authority.detached,true);
  assert.equal(fs.readFile('existing.txt'),'keep');
  assert.equal(fs.readFile('src/main.js'),'export default 1');
  assert.equal(fs.readFile('README.md'),'hello');

  await put(source,'src/main.js','external later edit');
  assert.equal(fs.readFile('src/main.js'),'export default 1');

  const state=await authority.inspect();
  assert.equal(state.mode,'imported-copy');
  assert.equal(state.externalRead,false);
  assert.equal(state.externalWrite,false);
  assert.equal(state.detached,true);

  await assert.rejects(
    ()=>authority.writeFile('src/main.js','nope'),
    error=>error.code===ErrorCodes.STORAGE_READ_ONLY&&error.details?.mode==='imported-copy'
  );
});

test('P3 read-only-source remains read-only even if backing handle reports readwrite permission',async()=>{
  const source=new FakeDirectoryHandle({permissionRead:'granted',permissionReadwrite:'granted'});
  await put(source,'notes.txt','source');
  const authority=new ExternalWorkspaceSourceAuthority({
    mode:ExternalSourceMode.READ_ONLY_SOURCE,
    handle:source
  });

  const state=await authority.inspect();
  assert.equal(state.mode,'read-only-source');
  assert.equal(state.state,ExternalSourceState.READ_ONLY);
  assert.equal(state.externalRead,true);
  assert.equal(state.externalWrite,false);

  const read=await authority.readFile('notes.txt');
  assert.equal(read.data,'source');
  await assert.rejects(
    ()=>authority.writeFile('notes.txt','overwrite'),
    error=>error.code===ErrorCodes.STORAGE_READ_ONLY&&error.details?.mode==='read-only-source'
  );
  assert.equal((await source.getFileHandle('notes.txt')).data,'source');
  assert.equal(authority.mode,'read-only-source');
});

test('P3 linked-folder rechecks permission before every privileged write and never silently changes mode',async()=>{
  const source=new FakeDirectoryHandle({permissionRead:'granted',permissionReadwrite:'granted'});
  await put(source,'app.txt','v1');
  const authority=new ExternalWorkspaceSourceAuthority({
    mode:ExternalSourceMode.LINKED_FOLDER,
    handle:source
  });

  const observed=await authority.readFile('app.txt');
  assert.equal(observed.data,'v1');
  source.permissionReadwrite='denied';

  await assert.rejects(
    ()=>authority.writeFile('app.txt','v2'),
    error=>{
      assert.equal(error.code,ErrorCodes.INVALID_STATE);
      assert.equal(error.details?.state,ExternalSourceState.READ_ONLY);
      assert.equal(error.details?.privilegedWriteBlocked,true);
      assert.equal(error.details?.localCanonicalUnaffected,true);
      assert.equal(error.details?.silentModeChange,false);
      return true;
    }
  );
  assert.equal((await source.getFileHandle('app.txt')).data,'v1');
  assert.equal(authority.mode,'linked-folder');
  assert.equal(authority.lastState.state,ExternalSourceState.READ_ONLY);

  source.permissionReadwrite='prompt';
  assert.equal((await authority.inspect()).state,ExternalSourceState.PERMISSION_NEEDED);
  assert.equal(await authority.requestWritePermission(),'prompt');
  assert.equal(source.requested,1);
  assert.equal(authority.mode,'linked-folder');
});

test('P3 linked-folder blocks external-edit conflict before privileged overwrite',async()=>{
  const source=new FakeDirectoryHandle();
  await put(source,'app.txt','v1');
  const authority=new ExternalWorkspaceSourceAuthority({
    mode:ExternalSourceMode.LINKED_FOLDER,
    handle:source
  });

  const observed=await authority.readFile('app.txt');
  assert.equal(observed.data,'v1');

  await put(source,'app.txt','outside-edit');
  await assert.rejects(
    ()=>authority.writeFile('app.txt','opencontainer-edit'),
    error=>{
      assert.equal(error.code,ErrorCodes.STALE_GENERATION);
      assert.equal(error.details?.state,ExternalSourceState.EXTERNAL_CHANGE_DETECTED);
      assert.equal(error.details?.expectedRevision,observed.revision);
      assert.notEqual(error.details?.currentRevision,observed.revision);
      assert.equal(error.details?.privilegedWriteBlocked,true);
      assert.equal(error.details?.silentOverwritePrevented,true);
      assert.deepEqual(error.details?.actions,[
        'compare','reload-external-version','save-opencontainer-version-as-copy','merge'
      ]);
      return true;
    }
  );
  assert.equal((await source.getFileHandle('app.txt')).data,'outside-edit');

  const refreshed=await authority.readFile('app.txt');
  const written=await authority.writeFile('app.txt','merged',{
    expectedRevision:refreshed.revision
  });
  assert.equal(written.permissionRechecked,true);
  assert.equal(written.silentOverwritePrevented,true);
  assert.equal((await source.getFileHandle('app.txt')).data,'merged');
  assert.equal(authority.lastState.state,ExternalSourceState.CONNECTED);
});

test('P3 external source path traversal is rejected before handle access',async()=>{
  const source=new FakeDirectoryHandle();
  const authority=new ExternalWorkspaceSourceAuthority({
    mode:ExternalSourceMode.LINKED_FOLDER,
    handle:source
  });
  await assert.rejects(
    ()=>authority.readFile('../escape.txt'),
    error=>error.code===ErrorCodes.PATH_ESCAPE
  );
});
