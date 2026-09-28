import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const REGISTRY_DIR='opencontainer-workspace-lifecycle';
const encoder=new TextEncoder();

function mutationId(value,name='mutationId'){
  assertOc(typeof value==='string'&&value.length>=1&&value.length<=128,ErrorCodes.INVALID_ARGUMENT,name+' must be a non-empty string up to 128 characters');
  assertOc(/^[A-Za-z0-9._:-]+$/.test(value),ErrorCodes.INVALID_ARGUMENT,name+' contains unsupported characters',{value});
  return value;
}

function recordName(directoryName){return encodeURIComponent(directoryName)+'.json';}

async function readText(directory,name){
  try{
    const handle=await directory.getFileHandle(name);
    const file=await handle.getFile();
    return await file.text();
  }catch(error){
    if(error?.name==='NotFoundError')return null;
    throw error;
  }
}

async function writeText(directory,name,text){
  const handle=await directory.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  try{await writable.write(text);await writable.close();}
  catch(error){try{await writable.abort?.();}catch{}throw error;}
}

async function directoryExists(root,name){
  try{await root.getDirectoryHandle(name);return true;}
  catch(error){if(error?.name==='NotFoundError')return false;throw error;}
}

async function sha256Hex(text){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(text));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function canonicalJson(value){
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}

function parseJson(text){
  if(!text)return null;
  try{return JSON.parse(text);}
  catch(error){
    throw ocError(ErrorCodes.IMPORT_INVALID,'Workspace lifecycle metadata is not valid JSON',{
      lifecycleMetadataCorrupt:true,
      cause:error?.message??String(error),
      silentActiveFallback:false
    });
  }
}

function parseManifest(text,slot){
  const value=parseJson(text);
  if(
    value?.version!==1||
    !Number.isInteger(value.sequence)||
    !Number.isInteger(value.generation)||
    typeof value.payload!=='string'||
    typeof value.sha256!=='string'
  )return null;
  return Object.freeze({...value,slot});
}

function normalizeRecord(record){
  if(!record)return null;
  const states=new Set(['active','tombstoned','purging','purged']);
  if(record?.version!==1||!states.has(record.state)){
    throw ocError(ErrorCodes.IMPORT_INVALID,'Workspace lifecycle metadata has an invalid shape',{
      lifecycleMetadataCorrupt:true,
      state:record?.state??null,
      silentActiveFallback:false
    });
  }
  return record;
}

async function verifyLifecycleRecord(record){
  if(!record)return null;
  const expected=record.lifecycleSha256;
  if(typeof expected!=='string'||expected.length!==64){
    throw ocError(ErrorCodes.IMPORT_INVALID,'Workspace lifecycle metadata is missing integrity identity',{
      lifecycleMetadataCorrupt:true,
      silentActiveFallback:false
    });
  }
  const body={...record};
  delete body.lifecycleSha256;
  const actual=await sha256Hex(canonicalJson(body));
  if(actual!==expected){
    throw ocError(ErrorCodes.IMPORT_INVALID,'Workspace lifecycle metadata digest mismatch',{
      lifecycleMetadataCorrupt:true,
      expectedSha256:expected,
      actualSha256:actual,
      silentActiveFallback:false
    });
  }
  return normalizeRecord(record);
}

async function sealLifecycleRecord(record){
  const body={...record};
  delete body.lifecycleSha256;
  return Object.freeze({...body,lifecycleSha256:await sha256Hex(canonicalJson(body))});
}

export async function readWorkspaceLifecycleRecord(root,directoryName){
  assertOc(root&&typeof root.getDirectoryHandle==='function',ErrorCodes.INVALID_ARGUMENT,'OPFS root directory handle is required');
  assertOc(typeof directoryName==='string'&&directoryName.length>0,ErrorCodes.INVALID_ARGUMENT,'workspace directoryName is required');
  const registry=await root.getDirectoryHandle(REGISTRY_DIR,{create:true});
  return verifyLifecycleRecord(parseJson(await readText(registry,recordName(directoryName))));
}

export function workspaceLifecycleBlocksPublication(record){
  return ['tombstoned','purging','purged'].includes(record?.state);
}

export class OpfsWorkspaceLifecycleAuthority{
  #root;
  #directoryName;
  #lockManager;
  #lockName;
  #registry=null;

  constructor({
    root,
    directoryName='opencontainer-workspace',
    lockManager=globalThis.navigator?.locks??null,
    lockName=null
  }={}){
    assertOc(root&&typeof root.getDirectoryHandle==='function',ErrorCodes.INVALID_ARGUMENT,'OPFS root directory handle is required');
    assertOc(typeof directoryName==='string'&&directoryName.length>0,ErrorCodes.INVALID_ARGUMENT,'workspace directoryName is required');
    if(lockManager!==null)assertOc(typeof lockManager?.request==='function',ErrorCodes.INVALID_ARGUMENT,'Workspace lifecycle lock manager must expose request()');
    this.#root=root;
    this.#directoryName=directoryName;
    this.#lockManager=lockManager;
    this.#lockName=lockName??'opencontainer:opfs-checkpoint:'+directoryName;
  }

  get directoryName(){return this.#directoryName;}
  get lockName(){return this.#lockName;}
  get crossContextLocking(){return this.#lockManager!==null;}

  async open(){
    this.#registry=await this.#root.getDirectoryHandle(REGISTRY_DIR,{create:true});
    await this.inspect();
    return this;
  }

  async inspect(){
    this.#assertOpen();
    return this.#withLock(async()=>{
      let record=await this.#readRecord();
      const exists=await directoryExists(this.#root,this.#directoryName);

      if(record?.state==='purging'&&!exists){
        record={
          ...record,
          state:'purged',
          recoverable:false,
          recoverability:'none',
          purgedAt:record.purgedAt??new Date().toISOString(),
          reconciledFromUnknownOutcome:true
        };
        await this.#writeRecord(record);
      }

      if(!record){
        return Object.freeze({
          state:exists?'active':'absent',
          directoryName:this.#directoryName,
          workspaceExists:exists,
          recoverable:exists,
          recoverability:exists?'canonical-state':'none',
          actionClass:null,
          mutationId:null
        });
      }

      const recoverable=
        record.state==='tombstoned'
          ? exists&&record.recoverable===true
          : record.state==='active'
            ? exists
            : false;

      return Object.freeze({
        ...structuredClone(record),
        directoryName:this.#directoryName,
        workspaceExists:exists,
        recoverable,
        recoverability:
          record.state==='tombstoned'
            ? (recoverable?'tombstone+checkpoint':'unrecoverable-missing-storage')
            : record.state==='purged'
              ? 'none'
              : record.recoverability??(recoverable?'canonical-state':'none')
      });
    });
  }

  async deleteRecoverably({mutationId:id,recoveryPoint}={}){
    this.#assertOpen();
    const deleteMutationId=mutationId(id,'delete mutationId');
    return this.#withLock(async()=>{
      const record=await this.#readRecord();
      if(record?.state==='tombstoned'&&record.deleteMutationId===deleteMutationId){
        return this.#deleteReceipt(record,{idempotent:true});
      }
      if(record?.state==='purging'||record?.state==='purged'){
        throw ocError(ErrorCodes.INVALID_STATE,'Workspace is already in irreversible purge lifecycle',{
          state:record.state,
          deleteMutationId:record.deleteMutationId??null,
          purgeMutationId:record.purgeMutationId??null
        });
      }
      if(record?.state==='tombstoned'&&record.deleteMutationId!==deleteMutationId){
        throw ocError(ErrorCodes.INVALID_STATE,'Workspace is already tombstoned by a different mutation',{
          activeMutationId:record.deleteMutationId,
          requestedMutationId:deleteMutationId
        });
      }

      const verified=await this.#verifyRecoveryPoint(recoveryPoint,{requireCurrent:true});
      const next={
        version:1,
        state:'tombstoned',
        actionClass:'D2',
        deleteMutationId,
        recoverable:true,
        recoverability:'tombstone+checkpoint',
        recoveryPoint:verified,
        deletedAt:new Date().toISOString()
      };
      await this.#writeRecord(next);
      return this.#deleteReceipt(next,{idempotent:false});
    });
  }

  async restoreRecoverable({deleteMutationId:deleteId,restoreMutationId:restoreId}={}){
    this.#assertOpen();
    const expectedDelete=mutationId(deleteId,'deleteMutationId');
    const restoreMutationId=mutationId(restoreId,'restoreMutationId');
    return this.#withLock(async()=>{
      const record=await this.#readRecord();
      if(
        record?.state==='active'&&
        record.restoredFromDeleteMutationId===expectedDelete&&
        record.restoreMutationId===restoreMutationId
      ){
        return Object.freeze({
          state:'active',
          restored:true,
          idempotent:true,
          recoverable:true,
          deleteMutationId:expectedDelete,
          restoreMutationId,
          recoveryPoint:Object.freeze(structuredClone(record.recoveryPoint))
        });
      }
      if(record?.state!=='tombstoned'||record.deleteMutationId!==expectedDelete){
        throw ocError(ErrorCodes.INVALID_STATE,'Recoverable workspace tombstone does not match restore request',{
          state:record?.state??'active',
          expectedDeleteMutationId:expectedDelete,
          actualDeleteMutationId:record?.deleteMutationId??null
        });
      }

      const verified=await this.#verifyRecoveryPoint(record.recoveryPoint);
      const next={
        version:1,
        state:'active',
        actionClass:'D2-RESTORE',
        restoredFromDeleteMutationId:expectedDelete,
        restoreMutationId,
        recoverable:true,
        recoverability:'canonical-state',
        recoveryPoint:verified,
        restoredAt:new Date().toISOString()
      };
      await this.#writeRecord(next);
      return Object.freeze({
        state:'active',
        restored:true,
        idempotent:false,
        recoverable:true,
        deleteMutationId:expectedDelete,
        restoreMutationId,
        recoveryPoint:Object.freeze(structuredClone(verified))
      });
    });
  }

  async purge({
    deleteMutationId:deleteId,
    purgeMutationId:purgeId,
    confirmation,
    simulateAckLossAfterCommit=false
  }={}){
    this.#assertOpen();
    const expectedDelete=mutationId(deleteId,'deleteMutationId');
    const purgeMutationId=mutationId(purgeId,'purgeMutationId');
    assertOc(
      confirmation?.action==='PERMANENT_PURGE'&&
      confirmation?.target===this.#directoryName&&
      confirmation?.recoverability==='none-after-purge',
      ErrorCodes.INVALID_ARGUMENT,
      'Permanent purge requires explicit target-specific irreversible confirmation',
      {required:{action:'PERMANENT_PURGE',target:this.#directoryName,recoverability:'none-after-purge'}}
    );

    return this.#withLock(async()=>{
      let record=await this.#readRecord();
      const existsBefore=await directoryExists(this.#root,this.#directoryName);

      if(record?.state==='purged'){
        if(record.deleteMutationId!==expectedDelete||record.purgeMutationId!==purgeMutationId){
          throw ocError(ErrorCodes.INVALID_STATE,'Workspace was purged by a different mutation',{
            deleteMutationId:record.deleteMutationId??null,
            purgeMutationId:record.purgeMutationId??null
          });
        }
        return this.#purgeReceipt(record,{idempotent:true,reconciled:false});
      }

      if(record?.state==='purging'){
        if(record.deleteMutationId!==expectedDelete||record.purgeMutationId!==purgeMutationId){
          throw ocError(ErrorCodes.INVALID_STATE,'A different permanent purge mutation is already in progress',{
            deleteMutationId:record.deleteMutationId??null,
            purgeMutationId:record.purgeMutationId??null
          });
        }
      }else{
        if(record?.state!=='tombstoned'||record.deleteMutationId!==expectedDelete){
          throw ocError(ErrorCodes.INVALID_STATE,'Permanent purge requires the exact recoverable tombstone first',{
            state:record?.state??'active',
            expectedDeleteMutationId:expectedDelete,
            actualDeleteMutationId:record?.deleteMutationId??null
          });
        }
        record={
          version:1,
          state:'purging',
          actionClass:'D4',
          deleteMutationId:expectedDelete,
          purgeMutationId,
          recoverable:existsBefore,
          recoverability:existsBefore?'transitioning-to-none':'none',
          recoveryPoint:record.recoveryPoint,
          purgeStartedAt:new Date().toISOString()
        };
        await this.#writeRecord(record);
      }

      try{
        await this.#root.removeEntry(this.#directoryName,{recursive:true});
      }catch(error){
        if(error?.name!=='NotFoundError')throw error;
      }

      const terminal={
        ...record,
        state:'purged',
        actionClass:'D4',
        recoverable:false,
        recoverability:'none',
        purgedAt:new Date().toISOString()
      };
      await this.#writeRecord(terminal);

      if(simulateAckLossAfterCommit){
        throw ocError(ErrorCodes.INVALID_STATE,'Permanent purge committed but acknowledgement was lost',{
          unknownOutcome:true,
          mutationCommitted:true,
          reconciliationRequired:true,
          deleteMutationId:expectedDelete,
          purgeMutationId
        });
      }

      return this.#purgeReceipt(terminal,{idempotent:false,reconciled:false});
    });
  }

  async reconcileMutation({purgeMutationId:purgeId}={}){
    this.#assertOpen();
    const purgeMutationId=mutationId(purgeId,'purgeMutationId');
    return this.#withLock(async()=>{
      let record=await this.#readRecord();
      const exists=await directoryExists(this.#root,this.#directoryName);
      if(record?.state==='purging'&&record.purgeMutationId===purgeMutationId&&!exists){
        record={
          ...record,
          state:'purged',
          recoverable:false,
          recoverability:'none',
          purgedAt:record.purgedAt??new Date().toISOString(),
          reconciledFromUnknownOutcome:true
        };
        await this.#writeRecord(record);
      }
      if(!record||record.purgeMutationId!==purgeMutationId){
        return Object.freeze({
          state:'unknown',
          terminal:false,
          mutationFound:false,
          purgeMutationId,
          workspaceExists:exists
        });
      }
      return Object.freeze({
        state:record.state,
        terminal:record.state==='purged',
        mutationFound:true,
        purgeMutationId,
        deleteMutationId:record.deleteMutationId??null,
        recoverable:record.state!=='purged'&&exists&&record.recoverable===true,
        workspaceExists:exists,
        reconciledFromUnknownOutcome:record.reconciledFromUnknownOutcome===true
      });
    });
  }

  async #verifyRecoveryPoint(reference,{requireCurrent=false}={}){
    assertOc(
      reference&&
      Number.isInteger(reference.sequence)&&reference.sequence>=1&&
      Number.isInteger(reference.generation)&&reference.generation>=0&&
      typeof reference.payload==='string'&&reference.payload.length>0&&
      typeof reference.sha256==='string'&&reference.sha256.length>0,
      ErrorCodes.INVALID_ARGUMENT,
      'Recoverable delete requires an exact checkpoint recovery point'
    );
    let workspace;
    try{workspace=await this.#root.getDirectoryHandle(this.#directoryName);}
    catch(error){
      if(error?.name==='NotFoundError')throw ocError(ErrorCodes.NOT_FOUND,'Workspace storage is missing before recoverable delete');
      throw error;
    }
    const [a,b]=await Promise.all([
      readText(workspace,'manifest-a.json'),
      readText(workspace,'manifest-b.json')
    ]);
    const roots=[parseManifest(a,'a'),parseManifest(b,'b')].filter(Boolean);
    const root=roots.find(item=>
      item.sequence===reference.sequence&&
      item.generation===reference.generation&&
      item.payload===reference.payload&&
      item.sha256===reference.sha256
    );
    assertOc(root,ErrorCodes.IMPORT_INVALID,'Delete recovery point is not a retained canonical/fallback root',{
      sequence:reference.sequence,generation:reference.generation,payload:reference.payload
    });
    const generations=await workspace.getDirectoryHandle('generations');
    const payload=await readText(generations,reference.payload);
    assertOc(payload!==null,ErrorCodes.IMPORT_INVALID,'Delete recovery payload is missing',{payload:reference.payload});
    assertOc(await sha256Hex(payload)===reference.sha256,ErrorCodes.IMPORT_INVALID,'Delete recovery payload digest mismatch',{payload:reference.payload});

    if(requireCurrent){
      const valid=[];
      for(const candidate of roots){
        const text=await readText(generations,candidate.payload);
        if(text===null)continue;
        if(await sha256Hex(text)!==candidate.sha256)continue;
        let snapshot=null;
        try{snapshot=JSON.parse(text);}catch{}
        if(snapshot?.version!==1||snapshot.generation!==candidate.generation||!Array.isArray(snapshot.entries))continue;
        valid.push(candidate);
      }
      valid.sort((a,b)=>b.sequence-a.sequence);
      const current=valid[0]??null;
      if(
        !current||
        current.sequence!==reference.sequence||
        current.generation!==reference.generation||
        current.payload!==reference.payload||
        current.sha256!==reference.sha256
      ){
        throw ocError(ErrorCodes.STALE_GENERATION,'Recoverable delete recovery point is no longer the current canonical root',{
          requestedSequence:reference.sequence,
          currentSequence:current?.sequence??null,
          requestedGeneration:reference.generation,
          currentGeneration:current?.generation??null,
          deleteAborted:true,
          blindOverwritePrevented:true
        });
      }
    }

    return Object.freeze({
      sequence:reference.sequence,
      generation:reference.generation,
      payload:reference.payload,
      sha256:reference.sha256
    });
  }

  #deleteReceipt(record,{idempotent}){
    return Object.freeze({
      state:'tombstoned',
      actionClass:'D2',
      mutationId:record.deleteMutationId,
      recoverable:true,
      recoverability:'tombstone+checkpoint',
      recoveryPoint:Object.freeze(structuredClone(record.recoveryPoint)),
      idempotent
    });
  }

  #purgeReceipt(record,{idempotent,reconciled}){
    return Object.freeze({
      state:'purged',
      actionClass:'D4',
      deleteMutationId:record.deleteMutationId,
      purgeMutationId:record.purgeMutationId,
      recoverable:false,
      recoverability:'none',
      idempotent,
      reconciled
    });
  }

  async #readRecord(){
    return verifyLifecycleRecord(parseJson(await readText(this.#registry,recordName(this.#directoryName))));
  }

  async #writeRecord(record){
    const sealed=await sealLifecycleRecord(record);
    await writeText(this.#registry,recordName(this.#directoryName),JSON.stringify(sealed));
    const verified=await this.#readRecord();
    assertOc(
      verified?.state===record.state&&verified?.lifecycleSha256===sealed.lifecycleSha256,
      ErrorCodes.INVALID_STATE,
      'Workspace lifecycle record failed read-after-write verification',
      {
        expectedState:record.state,
        actualState:verified?.state??null,
        expectedSha256:sealed.lifecycleSha256,
        actualSha256:verified?.lifecycleSha256??null
      }
    );
    return verified;
  }

  async #withLock(callback){
    if(!this.#lockManager)return callback();
    return this.#lockManager.request(this.#lockName,{mode:'exclusive'},callback);
  }

  #assertOpen(){
    assertOc(this.#registry,ErrorCodes.INVALID_STATE,'Workspace lifecycle authority is not open');
  }
}
