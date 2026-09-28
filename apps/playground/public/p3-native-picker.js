import {
  ExternalWorkspaceSourceAuthority,
  ExternalSourceMode,
  MemoryVFS,
  OpfsCheckpointAuthority
} from '/packages/vfs/src/index.js';

const DB_NAME='opencontainer-p3-native-picker-court';
const STORE='court';
const KEY='active';
const MARKER='opencontainer-p3-native-picker-court.txt';
const MUST_NOT_WRITE='OPENCONTAINER_CONFLICT_SENTINEL_MUST_NOT_OVERWRITE';

const statusNode=document.getElementById('status');
const receiptNode=document.getElementById('receipt');
const prepareButton=document.getElementById('prepare');
const conflictButton=document.getElementById('verify-conflict');
const revocationButton=document.getElementById('verify-revocation');
const methodNode=document.getElementById('revocation-method');
const downloadButton=document.getElementById('download');
const copyButton=document.getElementById('copy');

function setStatus(message){statusNode.textContent=String(message);}

async function sha256Hex(bytes){
  const source=bytes instanceof Uint8Array?bytes:new TextEncoder().encode(String(bytes));
  const digest=await crypto.subtle.digest('SHA-256',source);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function readFileBytes(handle){
  const file=await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function readMarker(handle){
  const fileHandle=await handle.getFileHandle(MARKER);
  const bytes=await readFileBytes(fileHandle);
  return Object.freeze({
    bytes,
    text:new TextDecoder().decode(bytes),
    revision:await sha256Hex(bytes)
  });
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

async function loadCourt(){
  const db=await openDb();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const request=tx.objectStore(STORE).get(KEY);
      request.onsuccess=()=>resolve(request.result??null);
      request.onerror=()=>reject(request.error);
    });
  }finally{db.close();}
}

async function saveCourt(value){
  const db=await openDb();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(value,KEY);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error??new Error('IndexedDB transaction aborted'));
    });
  }finally{db.close();}
}

async function queryPermissions(handle){
  return Object.freeze({
    read:await handle.queryPermission({mode:'read'}),
    readwrite:await handle.queryPermission({mode:'readwrite'})
  });
}

function publicReceipt(court){
  const conflict=court?.conflict??null;
  const revoke=court?.revocation??null;
  const initial=court?.initial??null;
  const pass=Boolean(
    court?.nativePickerHandle===true &&
    initial?.permissionReadwrite==='granted' &&
    conflict?.status==='PASS' &&
    conflict?.code==='OC_STALE_GENERATION' &&
    conflict?.silentOverwritePrevented===true &&
    revoke?.status==='PASS' &&
    ['denied','prompt'].includes(revoke?.permissionReadwrite) &&
    revoke?.permissionTransitionObserved===true &&
    revoke?.privilegedWriteBlocked===true &&
    revoke?.localCanonicalRecoverySurvived===true &&
    revoke?.requestPermissionCalledDuringVerification===false &&
    ['browser-site-settings-revoke','browser-permission-ui-revoke'].includes(revoke?.revocationMethod)
  );
  return Object.freeze({
    schema:'opencontainer.p3-native-picker-permission-browser.v1.0',
    status:pass?'PASS':'INCOMPLETE',
    sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-18',
    evidenceKind:'INTERACTIVE_NATIVE_BROWSER',
    operatorAssisted:true,
    createdAt:court?.createdAt??null,
    updatedAt:new Date().toISOString(),
    environment:Object.freeze({
      userAgent:navigator.userAgent,
      platform:navigator.userAgentData?.platform??navigator.platform??null,
      secureContext:globalThis.isSecureContext,
      crossOriginIsolated:globalThis.crossOriginIsolated,
      showDirectoryPickerAvailable:typeof globalThis.showDirectoryPicker==='function'
    }),
    privacy:Object.freeze({
      directoryNameRedacted:true,
      directoryPathRecorded:false,
      fileContentsRecorded:false
    }),
    nativePicker:Object.freeze({
      acquiredThroughShowDirectoryPicker:court?.nativePickerHandle===true,
      handleKind:court?.handleKind??null,
      mode:'readwrite',
      directoryNameRedacted:true
    }),
    initial:initial?Object.freeze({
      permissionRead:initial.permissionRead,
      permissionReadwrite:initial.permissionReadwrite,
      initialPermissionRequestCalled:initial.initialPermissionRequestCalled,
      markerRevision:initial.markerRevision,
      localRecoverySequence:initial.localRecoverySequence,
      localRecoveryGeneration:initial.localRecoveryGeneration
    }):null,
    externalEditConflict:conflict?Object.freeze({
      status:conflict.status,
      baselineRevision:conflict.baselineRevision,
      observedExternalRevision:conflict.observedExternalRevision,
      code:conflict.code,
      state:conflict.state,
      silentOverwritePrevented:conflict.silentOverwritePrevented,
      externalBytesPreserved:conflict.externalBytesPreserved,
      actions:conflict.actions
    }):null,
    permissionRevocation:revoke?Object.freeze({
      status:revoke.status,
      revocationMethod:revoke.revocationMethod,
      permissionRead:revoke.permissionRead,
      permissionReadwrite:revoke.permissionReadwrite,
      permissionTransitionObserved:revoke.permissionTransitionObserved,
      privilegedWriteBlocked:revoke.privilegedWriteBlocked,
      writeCode:revoke.writeCode,
      writeState:revoke.writeState,
      requestPermissionCalledDuringVerification:revoke.requestPermissionCalledDuringVerification,
      localCanonicalRecoverySurvived:revoke.localCanonicalRecoverySurvived,
      localRecoverySequence:revoke.localRecoverySequence,
      localRecoveryGeneration:revoke.localRecoveryGeneration
    }):null,
    invariants:Object.freeze({
      modeStayedLinkedFolder:court?.modeStayedLinkedFolder===true,
      noSilentModeChange:court?.modeStayedLinkedFolder===true,
      externalConflictCheckedBeforeOverwrite:conflict?.status==='PASS',
      nativePermissionTransitionExercised:revoke?.permissionTransitionObserved===true,
      localCanonicalUnaffectedByPermissionLoss:revoke?.localCanonicalRecoverySurvived===true
    }),
    productionClosed:false
  });
}

async function render(){
  const court=await loadCourt().catch(()=>null);
  const receipt=publicReceipt(court);
  receiptNode.textContent=JSON.stringify(receipt,null,2);
  conflictButton.disabled=!court?.nativePickerHandle;
  revocationButton.disabled=!court?.nativePickerHandle;
  downloadButton.disabled=receipt.status!=='PASS';
  copyButton.disabled=receipt.status!=='PASS';
  return {court,receipt};
}

prepareButton.addEventListener('click',async()=>{
  try{
    setStatus('Opening native directory picker...');
    if(typeof globalThis.showDirectoryPicker!=='function')throw new Error('showDirectoryPicker() is unavailable in this browser.');
    const handle=await globalThis.showDirectoryPicker({
      mode:'readwrite',
      id:'opencontainer-p3-native-picker-v1'
    });
    if(handle?.kind!=='directory')throw new Error('Native picker did not return a directory handle.');

    let permissions=await queryPermissions(handle);
    let initialPermissionRequestCalled=false;
    if(permissions.readwrite!=='granted'){
      initialPermissionRequestCalled=true;
      await handle.requestPermission({mode:'readwrite'});
      permissions=await queryPermissions(handle);
    }
    if(permissions.readwrite!=='granted'){
      throw new Error('Read/write permission must be granted during preparation.');
    }

    const courtId=crypto.randomUUID();
    const baseline='OPENCONTAINER_NATIVE_PICKER_BASELINE_'+courtId;
    const markerHandle=await handle.getFileHandle(MARKER,{create:true});
    const writable=await markerHandle.createWritable();
    await writable.write(baseline);
    await writable.close();

    const authority=new ExternalWorkspaceSourceAuthority({
      mode:ExternalSourceMode.LINKED_FOLDER,
      handle
    });
    const observed=await authority.readFile(MARKER);
    if(observed.data!==baseline)throw new Error('Baseline marker read-after-write verification failed.');

    const opfsRoot=await navigator.storage.getDirectory();
    const localDirectory='opencontainer-p3-native-picker-recovery-'+courtId;
    const localFs=new MemoryVFS();
    localFs.mount({
      'external-marker.txt':baseline,
      'evidence-boundary.json':JSON.stringify({
        version:1,
        sourceMode:'linked-folder',
        directoryNameRedacted:true,
        markerRevision:observed.revision
      })
    });
    const localAuthority=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:localDirectory,
      lockManager:navigator.locks
    }).open();
    const recovery=await localAuthority.checkpoint(localFs);

    const court={
      version:1,
      createdAt:new Date().toISOString(),
      courtId,
      handle,
      handleKind:handle.kind,
      nativePickerHandle:true,
      localDirectory,
      marker:MARKER,
      baselineRevision:observed.revision,
      modeStayedLinkedFolder:authority.mode===ExternalSourceMode.LINKED_FOLDER,
      initial:{
        permissionRead:permissions.read,
        permissionReadwrite:permissions.readwrite,
        initialPermissionRequestCalled,
        markerRevision:observed.revision,
        localRecoverySequence:recovery.sequence,
        localRecoveryGeneration:recovery.generation
      },
      conflict:null,
      revocation:null
    };
    await saveCourt(court);
    setStatus('Prepared. Now edit the marker file outside this page, then run step 2.');
    await render();
  }catch(error){
    setStatus('PREPARE FAILED: '+(error?.stack??error));
  }
});

conflictButton.addEventListener('click',async()=>{
  try{
    const court=await loadCourt();
    if(!court?.handle)throw new Error('Prepare the court first.');
    setStatus('Checking native external edit conflict...');
    const permissions=await queryPermissions(court.handle);
    if(permissions.readwrite!=='granted'){
      throw new Error('Read/write permission is not currently granted. Run the conflict court before revoking permission.');
    }

    const current=await readMarker(court.handle);
    if(current.revision===court.baselineRevision){
      throw new Error('No external edit detected. Edit '+MARKER+' outside this page before verifying.');
    }

    const authority=new ExternalWorkspaceSourceAuthority({
      mode:ExternalSourceMode.LINKED_FOLDER,
      handle:court.handle
    });
    let code=null;
    let state=null;
    let actions=[];
    let silentOverwritePrevented=false;
    try{
      await authority.writeFile(court.marker,MUST_NOT_WRITE,{expectedRevision:court.baselineRevision});
      throw new Error('Conflict court unexpectedly overwrote externally edited bytes.');
    }catch(error){
      if(error?.message==='Conflict court unexpectedly overwrote externally edited bytes.')throw error;
      code=error?.code??null;
      state=error?.details?.state??null;
      actions=Array.isArray(error?.details?.actions)?error.details.actions:[];
      silentOverwritePrevented=error?.details?.silentOverwritePrevented===true;
    }
    const after=await readMarker(court.handle);
    const externalBytesPreserved=after.revision===current.revision&&after.text!==MUST_NOT_WRITE;
    const pass=
      code==='OC_STALE_GENERATION' &&
      state==='external-change-detected' &&
      silentOverwritePrevented &&
      externalBytesPreserved &&
      actions.includes('compare') &&
      actions.includes('merge');

    court.conflict={
      status:pass?'PASS':'FAIL',
      baselineRevision:court.baselineRevision,
      observedExternalRevision:current.revision,
      code,
      state,
      actions,
      silentOverwritePrevented,
      externalBytesPreserved
    };
    court.modeStayedLinkedFolder=court.modeStayedLinkedFolder&&authority.mode===ExternalSourceMode.LINKED_FOLDER;
    await saveCourt(court);
    setStatus(pass
      ? 'External edit conflict PASS. Now revoke this site/folder permission in Chrome and run step 3.'
      : 'External edit conflict FAIL.');
    await render();
  }catch(error){
    setStatus('CONFLICT VERIFY FAILED: '+(error?.stack??error));
  }
});

revocationButton.addEventListener('click',async()=>{
  try{
    const court=await loadCourt();
    if(!court?.handle)throw new Error('Prepare the court first.');
    if(court?.conflict?.status!=='PASS')throw new Error('Complete the external edit conflict court first.');
    const revocationMethod=methodNode.value;
    if(!['browser-site-settings-revoke','browser-permission-ui-revoke'].includes(revocationMethod)){
      throw new Error('Select the browser UI method used to revoke permission.');
    }

    setStatus('Verifying native permission transition without requesting permission again...');
    const permissions=await queryPermissions(court.handle);
    if(permissions.readwrite==='granted'){
      throw new Error('Native read/write permission is still granted. Revoke it in Chrome before verifying.');
    }

    const authority=new ExternalWorkspaceSourceAuthority({
      mode:ExternalSourceMode.LINKED_FOLDER,
      handle:court.handle
    });
    let writeCode=null;
    let writeState=null;
    let privilegedWriteBlocked=false;
    try{
      await authority.writeFile(court.marker,'OPENCONTAINER_MUST_NOT_WRITE_AFTER_REVOKE',{
        expectedRevision:court.conflict.observedExternalRevision
      });
      throw new Error('Privileged write unexpectedly succeeded after native permission revocation.');
    }catch(error){
      if(error?.message==='Privileged write unexpectedly succeeded after native permission revocation.')throw error;
      writeCode=error?.code??null;
      writeState=error?.details?.state??null;
      privilegedWriteBlocked=error?.details?.privilegedWriteBlocked===true;
    }

    const opfsRoot=await navigator.storage.getDirectory();
    const localAuthority=await new OpfsCheckpointAuthority({
      root:opfsRoot,
      directoryName:court.localDirectory,
      lockManager:navigator.locks
    }).open();
    const localFs=new MemoryVFS();
    const restoredGeneration=await localAuthority.restoreInto(localFs);
    const localCanonicalRecoverySurvived=
      restoredGeneration!==null &&
      localFs.exists('external-marker.txt') &&
      typeof localFs.readFile('external-marker.txt')==='string' &&
      localAuthority.current?.sequence===court.initial.localRecoverySequence;

    const permissionTransitionObserved=
      court.initial.permissionReadwrite==='granted' &&
      ['denied','prompt'].includes(permissions.readwrite);

    const pass=
      permissionTransitionObserved &&
      writeCode==='OC_INVALID_STATE' &&
      privilegedWriteBlocked &&
      localCanonicalRecoverySurvived &&
      authority.mode===ExternalSourceMode.LINKED_FOLDER;

    court.revocation={
      status:pass?'PASS':'FAIL',
      revocationMethod,
      permissionRead:permissions.read,
      permissionReadwrite:permissions.readwrite,
      permissionTransitionObserved,
      privilegedWriteBlocked,
      writeCode,
      writeState,
      requestPermissionCalledDuringVerification:false,
      localCanonicalRecoverySurvived,
      localRecoverySequence:localAuthority.current?.sequence??null,
      localRecoveryGeneration:localAuthority.current?.generation??restoredGeneration??null
    };
    court.modeStayedLinkedFolder=court.modeStayedLinkedFolder&&authority.mode===ExternalSourceMode.LINKED_FOLDER;
    await saveCourt(court);
    const {receipt}=await render();
    setStatus(receipt.status==='PASS'
      ? 'P3 native picker court PASS. Download the receipt JSON and retain it as declared-profile evidence.'
      : 'Native permission revocation verification did not satisfy every invariant.');
  }catch(error){
    setStatus('REVOCATION VERIFY FAILED: '+(error?.stack??error));
  }
});

downloadButton.addEventListener('click',async()=>{
  const {receipt}=await render();
  if(receipt.status!=='PASS')return;
  const blob=new Blob([JSON.stringify(receipt,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download='opencontainer-p3-native-picker-permission-receipt.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

copyButton.addEventListener('click',async()=>{
  const {receipt}=await render();
  if(receipt.status!=='PASS')return;
  await navigator.clipboard.writeText(JSON.stringify(receipt,null,2));
  setStatus('PASS receipt copied to clipboard.');
});

await render();
