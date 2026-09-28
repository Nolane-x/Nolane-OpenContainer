import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser=JSON.parse(await readFile(resolve('.artifacts/critical-flake/browser-receipt.json'),'utf8'));
const errors=[];

function parseAcceptance(log){
  const prefix='browser acceptance PASS ';
  const index=log.indexOf(prefix);
  if(index<0)return null;
  const start=index+prefix.length;
  const end=log.indexOf('\ndistribution browser PASS',start);
  const raw=(end>=0?log.slice(start,end):log.slice(start)).trim();
  try{return JSON.parse(raw);}catch{return null;}
}

if(browser.status!=='PASS')errors.push('critical browser receipt is not PASS');
if(browser.unexplainedFailures!==0)errors.push('critical browser receipt has unexplained failures');
if(browser.fullProductPathPasses!==browser.iterations)errors.push('not every browser iteration passed full product path');

const runs=[];
for(const run of browser.runs??[]){
  const log=await readFile(resolve('.artifacts/critical-flake',run.logFile),'utf8');
  const acceptance=parseAcceptance(log);
  if(!acceptance||!Array.isArray(acceptance.stages)){
    errors.push('browser acceptance receipt missing for iteration '+run.iteration);
    continue;
  }
  const stage=acceptance.stages.find(item=>item.name==='p3-external-source-boundary-pass')??null;
  if(!stage){
    errors.push('P3 external source boundary stage missing for iteration '+run.iteration);
    continue;
  }

  const imported=stage.importedCopy??{};
  const readOnly=stage.readOnlySource??{};
  const linked=stage.linkedFolder??{};

  if(imported.mode!=='imported-copy'||imported.detached!==true||imported.externalWrite!==false)errors.push('imported-copy mode semantics drifted');
  if(imported.localStayedPinned!==true||imported.silentModeChange!==false)errors.push('imported-copy remained silently linked');
  if(readOnly.mode!=='read-only-source'||readOnly.state!=='read-only'||readOnly.externalWrite!==false)errors.push('read-only-source mode semantics drifted');
  if(readOnly.writeCode!=='OC_STORAGE_READ_ONLY'||readOnly.sourceUnchanged!==true)errors.push('read-only-source privileged write was not blocked');
  if(linked.mode!=='linked-folder')errors.push('linked-folder mode drifted');
  if(linked.permissionRevokedCode!=='OC_INVALID_STATE'||linked.permissionRevokedState!=='read-only')errors.push('permission revocation was not checked before privileged write');
  if(linked.localCanonicalUnaffected!==true)errors.push('permission loss damaged local canonical recovery copy');
  if(linked.permissionNeededState!=='permission-needed')errors.push('prompt permission state was not surfaced');
  if(linked.conflictCode!=='OC_STALE_GENERATION'||linked.conflictState!=='external-change-detected')errors.push('external edit conflict did not block privileged overwrite');
  if(!Array.isArray(linked.conflictActions)||!linked.conflictActions.includes('compare')||!linked.conflictActions.includes('merge'))errors.push('external edit conflict recovery actions drifted');
  if(linked.permissionRechecked!==true||linked.finalExternalValue!=='merged-version')errors.push('reconciled linked write did not recheck permission/publish');
  if(stage.nativePickerPermissionRevocationExercised!==false)errors.push('native picker evidence flag drifted');

  runs.push(Object.freeze({
    iteration:run.iteration,
    outputSha256:run.outputSha256,
    evidenceScope:stage.evidenceScope,
    nativePickerPermissionRevocationExercised:stage.nativePickerPermissionRevocationExercised,
    importedCopy:imported,
    readOnlySource:readOnly,
    linkedFolder:linked
  }));
}

const receipt=Object.freeze({
  schema:'opencontainer.p3-external-source-boundary-browser.v1.0',
  status:errors.length?'FAIL':'PASS',
  testedCheckoutCommit:browser.sourceCommit,
  profile:browser.profile,
  iterations:browser.iterations,
  fullProductPathPasses:browser.fullProductPathPasses,
  unexplainedFailures:browser.unexplainedFailures,
  closureScope:Object.freeze({
    p3_17:'candidate',
    p3_18:'partial-native-picker-permission-revocation-open'
  }),
  nativePickerPermissionRevocationExercised:false,
  runs:Object.freeze(runs),
  errors:Object.freeze(errors),
  productionClosed:false
});

await mkdir(resolve('.artifacts/p3-external-source'),{recursive:true});
await writeFile(resolve('.artifacts/p3-external-source/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
