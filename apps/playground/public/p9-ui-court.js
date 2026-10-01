import { projectFailureScenario } from '/packages/ui-contract/src/index.js';
function rect(selector){
  const node=document.querySelector(selector);
  return node?node.getBoundingClientRect().toJSON():null;
}
function visible(node){
  if(!node||node.closest('[hidden]'))return false;
  const r=node.getBoundingClientRect();
  return r.width>0&&r.height>0&&getComputedStyle(node).visibility!=='hidden';
}
function source(){
  return globalThis.__openContainerUi.runtime().fs.readFile('index.html');
}
function layout(){
  return Object.freeze({
    innerWidth,
    innerHeight,
    scrollWidth:document.documentElement.scrollWidth,
    scrollHeight:document.documentElement.scrollHeight,
    app:rect('#app'),
    canvas:rect('#workspace-canvas'),
    topbar:rect('.topbar'),
    tabs:rect('.surface-tabs'),
    visibleSurfaces:[...document.querySelectorAll('.surface-view')].filter(node=>!node.hidden).map(node=>node.dataset.surface),
    visibleButtons:[...document.querySelectorAll('button')].filter(visible).map(node=>node.id||node.dataset.view||node.dataset.aiMode||node.textContent.trim())
  });
}
function initial(){
  return Object.freeze({
    isolated:globalThis.crossOriginIsolated===true,
    activeView:globalThis.__openContainerUi.activeView(),
    receipt:globalThis.__openContainerUi.receipt(),
    layout:layout(),
    ready:globalThis.__openContainerUi.ready()
  });
}
function setSource(value){
  const editor=document.querySelector('#source-editor');
  editor.value=String(value);
  return editor.value;
}
function status(){
  return Object.freeze({
    save:document.querySelector('#save-state').textContent,
    authority:document.querySelector('#authority-status').textContent,
    recoveryHidden:document.querySelector('#recovery-panel').hidden,
    recoveryTitle:document.querySelector('#recovery-title').textContent,
    activeId:document.activeElement?.id??null,
    activeView:globalThis.__openContainerUi.activeView(),
    lifecycle:globalThis.__openContainerUi.lifecycle(),
    approvals:globalThis.__openContainerUi.pendingApprovals()
  });
}
function startComposition(value){
  globalThis.__openContainerUi.setView('ai');
  const prompt=document.querySelector('#ai-prompt');
  prompt.value=String(value);
  prompt.focus();
  prompt.dispatchEvent(new CompositionEvent('compositionstart',{data:String(value)}));
  return Object.freeze({value:prompt.value,state:document.querySelector('#composition-state').textContent});
}
function endComposition(value=''){
  const prompt=document.querySelector('#ai-prompt');
  prompt.dispatchEvent(new CompositionEvent('compositionend',{data:String(value)}));
  return Object.freeze({value:prompt.value,state:document.querySelector('#composition-state').textContent});
}
function stressLocalization(){
  document.documentElement.dir='rtl';
  document.documentElement.style.fontSize='200%';
  for(const tab of document.querySelectorAll('.surface-tab')){
    tab.dataset.originalText=tab.textContent;
    tab.textContent='Localized workspace surface label with substantial expansion';
  }
  for(const button of document.querySelectorAll('.surface-actions button')){
    button.dataset.originalText=button.textContent;
    button.textContent='Expanded localized action label for responsive layout verification';
  }
  return layout();
}
function resetLocalization(){
  document.documentElement.dir='ltr';
  document.documentElement.style.fontSize='';
  for(const node of document.querySelectorAll('[data-original-text]')){
    node.textContent=node.dataset.originalText;
    delete node.dataset.originalText;
  }
  return layout();
}

class FakeNotFoundError extends Error{
  constructor(){super('not found');this.name='NotFoundError';}
}
class FakeFileHandle{
  kind='file';
  constructor(data=''){this.data=String(data);}
  async getFile(){
    const handle=this;
    const bytes=new TextEncoder().encode(handle.data);
    return {
      size:bytes.byteLength,
      async text(){return handle.data;},
      async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
    };
  }
  async createWritable(){
    const handle=this;
    let next='';
    return {
      async write(value){
        next=value instanceof Uint8Array?new TextDecoder().decode(value):String(value);
      },
      async close(){handle.data=next;},
      async abort(){}
    };
  }
}
class FakeDirectoryHandle{
  kind='directory';
  name='p9-linked';
  constructor(){
    this.files=new Map([['linked.txt',new FakeFileHandle('outside-v1')]]);
    this.dirs=new Map();
    this.permissionRead='granted';
    this.permissionReadwrite='granted';
  }
  async queryPermission({mode='read'}={}){
    return mode==='readwrite'?this.permissionReadwrite:this.permissionRead;
  }
  async requestPermission({mode='read'}={}){
    return mode==='readwrite'?this.permissionReadwrite:this.permissionRead;
  }
  async getDirectoryHandle(name,{create=false}={}){
    if(this.dirs.has(name))return this.dirs.get(name);
    if(!create)throw new FakeNotFoundError();
    const dir=new FakeDirectoryHandle();
    this.dirs.set(name,dir);
    return dir;
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
async function linkedConflictCourt(){
  const dir=new FakeDirectoryHandle();
  globalThis.__p9FakeLinkedDirectory=dir;
  await globalThis.__openContainerUi.attachLinkedFolder(dir);
  const observed=await globalThis.__openContainerUi.readLinkedFile('linked.txt');
  dir.files.get('linked.txt').data='outside-v2';
  const conflict=await globalThis.__openContainerUi.writeLinkedFile('linked.txt','opencontainer-overwrite');
  const conflictView=Object.freeze({
    text:document.querySelector('#linked-state').textContent,
    receipt:globalThis.__openContainerUi.receipt().linked
  });
  const refreshed=await globalThis.__openContainerUi.readLinkedFile('linked.txt');
  dir.permissionReadwrite='denied';
  const denied=await globalThis.__openContainerUi.writeLinkedFile('linked.txt','must-not-write',{
    expectedRevision:refreshed.result.revision
  });
  const deniedView=Object.freeze({
    text:document.querySelector('#linked-state').textContent,
    receipt:globalThis.__openContainerUi.receipt().linked
  });
  return Object.freeze({observed,conflict,conflictView,refreshed,denied,deniedView});
}
function diagnosticsCopy(){
  return Object.freeze({
    buttonClass:document.querySelector('#open-clear-diagnostics').className,
    description:document.querySelector('#diagnostics-description').textContent,
    sourceRemoveClass:document.querySelector('#open-destructive').className,
    sourceRemoveDescription:document.querySelector('#destructive-description').textContent
  });
}
function surfaceHistory(){
  return Object.freeze({
    state:history.state,
    length:history.length,
    activeView:globalThis.__openContainerUi.activeView(),
    source:source()
  });
}

globalThis.__p9RenderedCourt=Object.freeze({
  initial,
  layout,
  source,
  setSource,
  status,
  startComposition,
  endComposition,
  stressLocalization,
  resetLocalization,
  linkedConflictCourt,
  diagnosticsCopy,
  surfaceHistory,
  projectFailureScenario
});
export default globalThis.__p9RenderedCourt;
