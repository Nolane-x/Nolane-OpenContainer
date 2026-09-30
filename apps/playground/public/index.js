import { OpenContainer } from '/packages/sdk/src/index.js';
import { AiAuthority } from '/packages/ai-consumer/src/index.js';
import { createSandboxedPreviewFrame } from '/packages/preview/src/index.js';
import { ExternalWorkspaceSourceAuthority, ExternalSourceMode } from '/packages/vfs/src/index.js';

const DEFAULT_SOURCE='<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>OpenContainer Preview</title></head>\n<body><main><h1>Hello from OpenContainer</h1><p>Edit index.html, save, and the sandbox preview will refresh.</p></main></body>\n</html>\n';
const WORKSPACE_DIRECTORY='opencontainer-playground-workspace';
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];

const shellState={
  runtime:null,
  ai:new AiAuthority(),
  activeView:'preview',
  project:{state:'booting',lastReceipt:null},
  process:{state:'idle',pid:null,lastReceipt:null},
  aiLifecycle:{state:'ready',lastReceipt:null},
  pendingApprovals:[],
  linkedAuthority:null,
  linkedState:Object.freeze({
    mode:'none',
    state:'not-linked',
    externalRead:false,
    externalWrite:false,
    permissionRead:'unavailable',
    permissionReadwrite:'unavailable'
  }),
  linkedConflictActions:Object.freeze([]),
  recovery:{kind:null,snapshot:null},
  composing:false,
  lastDialogOpener:null,
  previewRoute:null,
  statusTimer:null
};

function pair(label,value){
  const dt=document.createElement('dt');
  const dd=document.createElement('dd');
  dt.textContent=label;
  dd.textContent=String(value??'—');
  return [dt,dd];
}

function renderDl(target,rows){
  target.replaceChildren();
  for(const [label,value] of rows)target.append(...pair(label,value));
}

function announce(message,{sticky=false}={}){
  const target=$('#authority-status');
  target.textContent=String(message);
  target.dataset.visible='true';
  if(shellState.statusTimer)clearTimeout(shellState.statusTimer);
  if(!sticky)shellState.statusTimer=setTimeout(()=>{target.dataset.visible='false';},2600);
}

function errorCode(error){
  return error?.code??error?.name??'Error';
}

function currentSource(){
  if(!shellState.runtime?.fs?.exists('index.html'))return '';
  return shellState.runtime.fs.readFile('index.html');
}

function currentRuntimeReceipt(){
  const runtime=shellState.runtime;
  if(!runtime)return null;
  return Object.freeze({
    status:runtime.status(),
    process:Object.freeze({
      activeCount:runtime.process.activeCount,
      rows:runtime.process.list()
    }),
    diagnostics:runtime.diagnostics.summary(),
    ai:Object.freeze({
      ...shellState.ai.modeReceipt(),
      pendingApprovalCount:shellState.pendingApprovals.length,
      lifecycle:shellState.aiLifecycle.state
    }),
    linked:shellState.linkedState
  });
}

function renderHeader(){
  const runtime=shellState.runtime;
  $('#runtime-state').textContent=shellState.project.state;
  $('#workspace-generation').textContent=runtime?.fs?.generation??'–';
  $('#isolated').textContent=String(globalThis.crossOriginIsolated);
}

function renderInspect(){
  if(!shellState.runtime)return;
  const receipt=currentRuntimeReceipt();
  renderDl($('#project-state'),[
    ['Lifecycle',shellState.project.state],
    ['Runtime state',receipt.status.state],
    ['Health',receipt.status.health],
    ['Workspace generation',receipt.status.generation],
    ['Checkpoint sequence',receipt.status.workspacePersistence?.sequence??'none']
  ]);
  renderDl($('#process-state'),[
    ['Lifecycle',shellState.process.state],
    ['Active',receipt.process.activeCount],
    ['PID',shellState.process.pid??'none'],
    ['Last code',shellState.process.lastReceipt?.code??'none'],
    ['Terminal reason',shellState.process.lastReceipt?.reason??'none']
  ]);
  renderDl($('#ai-state'),[
    ['Lifecycle',shellState.aiLifecycle.state],
    ['Mode',receipt.ai.mode],
    ['Can read',receipt.ai.canRead],
    ['Can mutate',receipt.ai.canMutate],
    ['Pending approvals',receipt.ai.pendingApprovalCount]
  ]);
  renderLinked();
  $('#diagnostic-receipt').textContent=JSON.stringify(receipt,null,2);
}

function renderLinked(){
  const state=shellState.linkedState;
  renderDl($('#linked-state'),[
    ['Mode',state?.mode??'none'],
    ['State',state?.state??'not-linked'],
    ['Read permission',state?.permissionRead??'unavailable'],
    ['Write permission',state?.permissionReadwrite??'unavailable'],
    ['External write',state?.externalWrite===true],
    ['Conflict',state?.state==='external-change-detected'],
    ['Recovery actions',shellState.linkedConflictActions.length?shellState.linkedConflictActions.join(', '):'none']
  ]);
}

function renderAi(){
  const receipt=shellState.ai.modeReceipt();
  $('#ai-mode-label').textContent=receipt.humanLabel;
  for(const button of $$('[data-ai-mode]')){
    button.setAttribute('aria-pressed',String(button.dataset.aiMode===receipt.mode));
  }
  const list=$('#approval-list');
  list.replaceChildren();
  for(const [index,approval] of shellState.pendingApprovals.entries()){
    const li=document.createElement('li');
    li.className='approval-item';
    li.dataset.approvalId=approval.id;
    const copy=document.createElement('div');
    const strong=document.createElement('strong');
    strong.textContent='Write approval';
    const small=document.createElement('small');
    small.textContent=approval.id+' · '+String(approval.scope??'workspace');
    copy.append(strong,small);
    const use=document.createElement('button');
    use.type='button';
    use.textContent='Apply';
    use.dataset.applyApproval=approval.id;
    use.dataset.approvalIndex=String(index);
    li.append(copy,use);
    list.append(li);
  }
  if(shellState.pendingApprovals.length===0){
    const empty=document.createElement('li');
    empty.className='approval-item';
    empty.textContent='No pending approvals';
    list.append(empty);
  }
}

function updatePreview(){
  const mount=$('#preview-mount');
  mount.replaceChildren();
  if(!shellState.runtime?.fs?.exists('index.html')){
    const empty=document.createElement('div');
    empty.className='empty-state';
    empty.textContent='index.html is removed. Restore the recovery point to preview it again.';
    mount.append(empty);
    return;
  }
  const frame=createSandboxedPreviewFrame({
    html:currentSource(),
    title:'OpenContainer workspace preview',
    documentRef:document
  });
  frame.dataset.previewGeneration=String(shellState.runtime.fs.generation);
  mount.append(frame);
}

function setView(view,{pushHistory=false,focus=true}={}){
  if(!['preview','inspect','ai'].includes(view))return false;
  shellState.activeView=view;
  $('#app').dataset.activeView=view;
  for(const button of $$('.surface-tab')){
    const active=button.dataset.view===view;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-selected',String(active));
    button.setAttribute('tabindex',active?'0':'-1');
  }
  for(const section of $$('.surface-view')){
    const active=section.dataset.surface===view;
    section.classList.toggle('is-active',active);
    section.hidden=!active;
  }
  if(view==='inspect')renderInspect();
  if(view==='ai')renderAi();
  if(pushHistory&&history.state?.opencontainerView!==view){
    history.pushState({opencontainerView:view},'',new URL(location.href));
  }
  if(focus)$('#workspace-canvas').focus({preventScroll:true});
  return true;
}

async function withUiTask(callback,{inFlightBytes=0,background=false}={}){
  const governor=shellState.runtime?.resources??null;
  const lease=governor?.acquireTask({owner:'ui',inFlightBytes,background})??null;
  try{return await callback();}
  finally{lease?.release();}
}

async function persistCanonical(label){
  const receipt=await shellState.runtime.persistWorkspace();
  shellState.project.lastReceipt=Object.freeze({
    kind:label,
    generation:shellState.runtime.fs.generation,
    sequence:receipt.sequence,
    sha256:receipt.sha256??null
  });
  renderHeader();
  renderInspect();
  return receipt;
}

async function saveSource(){
  const editor=$('#source-editor');
  const tx=shellState.runtime.fs.beginTransaction();
  tx.writeFile('index.html',editor.value);
  const generation=tx.commit();
  const checkpoint=await persistCanonical('save');
  updatePreview();
  $('#save-state').textContent='Saved · generation '+generation+' · checkpoint '+checkpoint.sequence;
  announce('Saved after canonical checkpoint '+checkpoint.sequence);
  return Object.freeze({generation,checkpoint});
}

async function runProcess(command='ui:healthy'){
  shellState.process.state='running';
  shellState.process.lastReceipt=null;
  renderInspect();
  const process=shellState.runtime.spawn(command);
  shellState.process.pid=process.pid;
  try{
    const code=await process.exit;
    const terminal=await process.terminal;
    shellState.process.lastReceipt=terminal;
    shellState.process.state=code===0?'idle':'failed';
    if(code!==0)showRecovery({
      kind:'process',
      title:'A process failed',
      message:'The workspace and AI session are still available. Recover only the failed process.'
    });
    return terminal;
  }finally{
    renderInspect();
  }
}

function showRecovery({kind,title,message,snapshot=null}){
  shellState.recovery={kind,snapshot};
  $('#recovery-title').textContent=title;
  $('#recovery-message').textContent=message;
  $('#recover-process').textContent=kind==='source'?'Restore source':'Recover process';
  $('#recovery-panel').hidden=false;
}

function hideRecovery(){
  $('#recovery-panel').hidden=true;
  shellState.recovery={kind:null,snapshot:null};
}

async function removeSource(){
  if(!shellState.runtime.fs.exists('index.html'))return null;
  const snapshot=shellState.runtime.snapshot('before-source-remove');
  const tx=shellState.runtime.fs.beginTransaction();
  tx.remove('index.html');
  const generation=tx.commit();
  const checkpoint=await persistCanonical('remove-source');
  $('#source-editor').value='';
  $('#save-state').textContent='Removed · generation '+generation+' · recoverable';
  updatePreview();
  showRecovery({
    kind:'source',
    snapshot,
    title:'Source removed',
    message:'A verified in-session recovery point exists. Restore will publish a new canonical checkpoint.'
  });
  announce('Removed after recovery point '+snapshot.id);
  return Object.freeze({snapshot,generation,checkpoint});
}

async function restoreSource(){
  const snapshot=shellState.recovery.snapshot;
  if(!snapshot)throw new Error('No source recovery point is available');
  const generation=shellState.runtime.restore(snapshot);
  const checkpoint=await persistCanonical('restore-source');
  $('#source-editor').value=currentSource();
  $('#save-state').textContent='Restored · generation '+generation+' · checkpoint '+checkpoint.sequence;
  updatePreview();
  hideRecovery();
  announce('Restored after canonical checkpoint '+checkpoint.sequence);
  return Object.freeze({generation,checkpoint});
}

function setAiMode(mode){
  const receipt=shellState.ai.setMode(mode);
  shellState.aiLifecycle.lastReceipt=receipt;
  renderAi();
  renderInspect();
  announce(receipt.humanLabel);
  return receipt;
}

function createApproval(){
  const receipt=shellState.ai.approve({
    action:'write',
    scope:'index.html'
  });
  shellState.pendingApprovals.push(receipt);
  renderAi();
  renderInspect();
  announce('Approval created: '+receipt.id);
  return receipt;
}

async function applyApproval(id){
  const index=shellState.pendingApprovals.findIndex(item=>item.id===id);
  if(index<0)throw new Error('Approval is no longer pending');
  const receipt=shellState.ai.authorize({
    action:'write',
    approval:id,
    readOnly:false
  });
  const source=currentSource()||DEFAULT_SOURCE;
  const suffix='\n<!-- Applied through '+id+' -->\n';
  const tx=shellState.runtime.fs.beginTransaction();
  tx.writeFile('index.html',source.replace(/\s*$/,'')+suffix);
  tx.commit();
  const checkpoint=await persistCanonical('ai-approved-write');
  shellState.pendingApprovals.splice(index,1);
  $('#source-editor').value=currentSource();
  updatePreview();
  renderAi();
  renderInspect();
  const buttons=$$('[data-apply-approval]');
  const target=buttons[Math.min(index,Math.max(0,buttons.length-1))]??$('#create-approval');
  target.focus();
  announce('Applied '+receipt.approvalId+' at checkpoint '+checkpoint.sequence);
  return Object.freeze({receipt,checkpoint,focusTarget:target.id||target.dataset.applyApproval||'create-approval'});
}

async function submitAiPrompt(){
  const prompt=$('#ai-prompt').value.trim();
  if(!prompt)return Object.freeze({sent:false,reason:'empty'});
  const mode=shellState.ai.modeReceipt();
  let authority=null;
  if(mode.mode!=='Discuss'){
    authority=shellState.ai.authorize({action:'inspect',readOnly:true});
  }
  shellState.aiLifecycle.lastReceipt=Object.freeze({
    sent:true,
    mode:mode.mode,
    workspaceGeneration:shellState.runtime.fs.generation,
    authority
  });
  $('#ai-prompt').value='';
  announce(mode.mode==='Discuss'?'Discuss message accepted locally':'Read-only workspace inspection authorized');
  renderInspect();
  return shellState.aiLifecycle.lastReceipt;
}

async function attachLinkedFolder(handle){
  shellState.linkedAuthority=new ExternalWorkspaceSourceAuthority({
    mode:ExternalSourceMode.LINKED_FOLDER,
    handle
  });
  shellState.linkedState=await shellState.linkedAuthority.inspect();
  shellState.linkedConflictActions=Object.freeze([]);
  renderLinked();
  renderInspect();
  announce('Linked folder state: '+shellState.linkedState.state);
  return shellState.linkedState;
}

async function refreshLinkedState(){
  if(!shellState.linkedAuthority)return shellState.linkedState;
  shellState.linkedState=await shellState.linkedAuthority.inspect();
  renderLinked();
  renderInspect();
  return shellState.linkedState;
}

async function readLinkedFile(path='linked.txt'){
  if(!shellState.linkedAuthority)throw new Error('No linked folder authority is attached');
  const before=await refreshLinkedState();
  const result=await shellState.linkedAuthority.readFile(path);
  shellState.linkedState=await shellState.linkedAuthority.inspect();
  shellState.linkedConflictActions=Object.freeze([]);
  renderLinked();
  renderInspect();
  announce('External file revision observed');
  return Object.freeze({before,result,state:shellState.linkedState});
}

async function writeLinkedFile(path,data,{expectedRevision=undefined}={}){
  if(!shellState.linkedAuthority)throw new Error('No linked folder authority is attached');
  const before=await refreshLinkedState();
  try{
    const result=await shellState.linkedAuthority.writeFile(path,data,{expectedRevision});
    shellState.linkedState=await shellState.linkedAuthority.inspect();
    shellState.linkedConflictActions=Object.freeze([]);
    announce('External write applied after permission recheck');
    renderLinked();
    renderInspect();
    return Object.freeze({ok:true,before,result,state:shellState.linkedState});
  }catch(error){
    shellState.linkedState=shellState.linkedAuthority.lastState??await shellState.linkedAuthority.inspect();
    shellState.linkedConflictActions=Object.freeze([...(error?.details?.actions??[])]);
    renderLinked();
    renderInspect();
    announce('External write blocked: '+errorCode(error),{sticky:true});
    return Object.freeze({
      ok:false,
      before,
      error:Object.freeze({code:errorCode(error),message:error?.message??String(error),details:error?.details??null}),
      state:shellState.linkedState
    });
  }
}

async function pickLinkedFolder(){
  if(typeof globalThis.showDirectoryPicker!=='function'){
    announce('Linked folders are unavailable in this browser profile',{sticky:true});
    return Object.freeze({ok:false,reason:'picker-unavailable'});
  }
  const handle=await globalThis.showDirectoryPicker({mode:'readwrite'});
  const state=await attachLinkedFolder(handle);
  if(state.permissionReadwrite!=='granted'){
    announce('Folder linked, but write permission is '+state.permissionReadwrite,{sticky:true});
  }
  return Object.freeze({ok:true,name:handle.name,state});
}

async function clearDiagnostics(){
  shellState.runtime.diagnostics.clear();
  renderInspect();
  announce('Diagnostics cleared. This action cannot be undone.');
  return shellState.runtime.diagnostics.summary();
}

async function boot(){
  const root=await navigator.storage.getDirectory();
  const runtime=await OpenContainer.boot({
    workspacePersistence:{
      root,
      directoryName:WORKSPACE_DIRECTORY,
      lockManager:navigator.locks
    }
  });
  shellState.runtime=runtime;
  shellState.project.state='ready';

  if(!runtime.fs.exists('index.html')){
    runtime.mount({
      'index.html':DEFAULT_SOURCE,
      'README.md':'# OpenContainer Playground\n\nThis workspace is persisted through OPFS.\n'
    });
    await runtime.persistWorkspace();
  }

  runtime.registerCommand('ui:healthy',async({stdout})=>{
    stdout('OpenContainer UI process ready');
    return 0;
  });
  runtime.registerCommand('ui:fail',async()=>{
    throw new Error('Intentional UI process failure');
  });
  shellState.previewRoute=runtime.listen(4173,()=>new Response(currentSource()||'',{
    headers:{'content-type':'text/html; charset=utf-8'}
  }),{
    owner:'playground-ui',
    identity:{workspace:'playground',session:'ui',version:String(runtime.fs.generation)}
  });

  $('#preview-route').textContent=shellState.previewRoute.url;
  $('#source-editor').value=currentSource();
  updatePreview();
  renderHeader();
  renderAi();
  renderInspect();
  const initialView=history.state?.opencontainerView;
  setView(['preview','inspect','ai'].includes(initialView)?initialView:'preview',{focus:false});

  $('#app').dataset.ready='true';
  document.documentElement.dataset.opencontainerReady='true';
  announce('Runtime ready at generation '+runtime.fs.generation);
  return runtime;
}

for(const tab of $$('.surface-tab')){
  tab.addEventListener('click',()=>setView(tab.dataset.view,{pushHistory:true}));
  tab.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const tabs=$$('.surface-tab');
    const current=tabs.indexOf(tab);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:
      event.key==='ArrowRight'?(current+1)%tabs.length:(current-1+tabs.length)%tabs.length;
    tabs[next].focus();
    setView(tabs[next].dataset.view,{pushHistory:true,focus:false});
  });
}

$('#save-source').addEventListener('click',()=>withUiTask(()=>saveSource()).catch(error=>announce('Save failed: '+errorCode(error),{sticky:true})));
$('#run-process').addEventListener('click',()=>withUiTask(()=>runProcess()).then(receipt=>announce('Process exited '+receipt.code)).catch(error=>announce('Process failed: '+errorCode(error),{sticky:true})));
$('#refresh-inspect').addEventListener('click',()=>{renderInspect();announce('Inspection refreshed from runtime state');});
$('#link-folder').addEventListener('click',()=>{
  pickLinkedFolder().catch(error=>announce('Link folder failed: '+errorCode(error),{sticky:true}));
});

for(const button of $$('[data-ai-mode]'))button.addEventListener('click',()=>setAiMode(button.dataset.aiMode));
$('#create-approval').addEventListener('click',()=>{
  try{createApproval();}catch(error){announce('Approval blocked: '+errorCode(error),{sticky:true});}
});
$('#approval-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-apply-approval]');
  if(!button)return;
  withUiTask(()=>applyApproval(button.dataset.applyApproval)).catch(error=>announce('Approval not applied: '+errorCode(error),{sticky:true}));
});

$('#ai-prompt').addEventListener('compositionstart',()=>{
  shellState.composing=true;
  $('#composition-state').textContent='Composing';
});
$('#ai-prompt').addEventListener('compositionend',()=>{
  shellState.composing=false;
  $('#composition-state').textContent='Ready';
});
$('#ai-prompt').addEventListener('keydown',event=>{
  if(event.key!=='Enter')return;
  if(shellState.composing){
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if(event.ctrlKey||event.metaKey){
    event.preventDefault();
    $('#ai-form').requestSubmit();
  }
});
$('#ai-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(shellState.composing)return;
  withUiTask(()=>submitAiPrompt(),{inFlightBytes:4096}).catch(error=>announce('AI action blocked: '+errorCode(error),{sticky:true}));
});

function focusableDialogControls(dialog){
  return [...dialog.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(node=>{
    const style=getComputedStyle(node);
    return style.visibility!=='hidden'&&style.display!=='none';
  });
}

function trapDialogFocus(dialog,event){
  if(event.key!=='Tab'||!dialog.open)return;
  const controls=focusableDialogControls(dialog);
  if(controls.length===0){
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first=controls[0];
  const last=controls.at(-1);
  const active=document.activeElement;
  if(event.shiftKey&&(active===first||!dialog.contains(active))){
    event.preventDefault();
    last.focus();
    return;
  }
  if(!event.shiftKey&&(active===last||!dialog.contains(active))){
    event.preventDefault();
    first.focus();
  }
}

const destructiveDialog=$('#destructive-dialog');
destructiveDialog.addEventListener('keydown',event=>trapDialogFocus(destructiveDialog,event));
$('#open-destructive').addEventListener('click',event=>{
  shellState.lastDialogOpener=event.currentTarget;
  destructiveDialog.showModal();
  destructiveDialog.querySelector('button[value=cancel]')?.focus();
});
destructiveDialog.addEventListener('close',()=>{
  const confirmed=destructiveDialog.returnValue==='confirm';
  shellState.lastDialogOpener?.focus();
  if(confirmed)removeSource().catch(error=>announce('Remove failed: '+errorCode(error),{sticky:true}));
});

const diagnosticsDialog=$('#diagnostics-dialog');
diagnosticsDialog.addEventListener('keydown',event=>trapDialogFocus(diagnosticsDialog,event));
$('#open-clear-diagnostics').addEventListener('click',event=>{
  shellState.lastDialogOpener=event.currentTarget;
  diagnosticsDialog.showModal();
  diagnosticsDialog.querySelector('button[value=cancel]')?.focus();
});
diagnosticsDialog.addEventListener('close',()=>{
  const confirmed=diagnosticsDialog.returnValue==='confirm';
  shellState.lastDialogOpener?.focus();
  if(confirmed)clearDiagnostics().catch(error=>announce('Diagnostics clear failed: '+errorCode(error),{sticky:true}));
});

$('#recover-process').addEventListener('click',()=>{
  if(shellState.recovery.kind==='source'){
    restoreSource().catch(error=>announce('Restore failed: '+errorCode(error),{sticky:true}));
    return;
  }
  if(shellState.recovery.kind==='process'){
    runProcess('ui:healthy').then(()=>{
      hideRecovery();
      announce('Process recovered; project and AI lifecycles were unchanged');
    }).catch(error=>announce('Recovery failed: '+errorCode(error),{sticky:true}));
  }
});

window.addEventListener('popstate',event=>{
  const view=event.state?.opencontainerView;
  if(['preview','inspect','ai'].includes(view))setView(view,{pushHistory:false,focus:false});
});

globalThis.__openContainerUi=Object.freeze({
  ready:()=>$('#app').dataset.ready==='true',
  runtime:()=>shellState.runtime,
  receipt:()=>currentRuntimeReceipt(),
  activeView:()=>shellState.activeView,
  setView:(view)=>setView(view,{pushHistory:false,focus:false}),
  saveSource,
  removeSource,
  restoreSource,
  runProcess,
  simulateProcessFailure:()=>runProcess('ui:fail'),
  setAiMode,
  createApproval,
  applyApproval,
  pendingApprovals:()=>Object.freeze(shellState.pendingApprovals.map(item=>Object.freeze({...item}))),
  attachLinkedFolder,
  pickLinkedFolder,
  refreshLinkedState,
  readLinkedFile,
  writeLinkedFile,
  clearDiagnostics,
  lifecycle:()=>Object.freeze({
    project:Object.freeze({...shellState.project}),
    process:Object.freeze({...shellState.process}),
    ai:Object.freeze({...shellState.aiLifecycle})
  }),
  setDirection:(direction)=>{
    document.documentElement.dir=direction==='rtl'?'rtl':'ltr';
    return document.documentElement.dir;
  }
});

boot().catch(error=>{
  shellState.project.state='failed';
  const receipt=Object.freeze({
    name:error?.name??'Error',
    code:errorCode(error),
    message:error?.message??String(error),
    stack:typeof error?.stack==='string'?error.stack:null
  });
  globalThis.__openContainerBootError=receipt;
  renderHeader();
  $('#app').dataset.ready='error';
  $('#app').dataset.bootErrorCode=receipt.code;
  announce('Runtime boot failed: '+receipt.code,{sticky:true});
  console.error(error);
});
