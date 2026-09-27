import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const readJson=async path=>JSON.parse(await readFile(resolve(repoRoot,path),'utf8'));

function gitHead(){
  const r=spawnSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'});
  if(r.status!==0)throw new Error('git rev-parse HEAD failed');
  return r.stdout.trim();
}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}

export function validateReleaseCompatibilityMatrix({matrix,candidate,scope,profile,ledger,humanDoc}){
  const errors=[];
  if(matrix?.schema!=='opencontainer.release-compatibility-matrix.v1.0')errors.push('invalid compatibility matrix schema');
  if(matrix?.sourceGate!=='OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P15-05')errors.push('matrix is not bound to P15-05');
  if(matrix?.releaseId!==candidate?.releaseId)errors.push('releaseId drift');
  if(matrix?.version!==candidate?.version)errors.push('version drift');
  if(matrix?.channel!==candidate?.channel)errors.push('channel drift');
  if(matrix?.productionProfileId!==profile?.profileId)errors.push('production profile drift');
  if(matrix?.browserMinimumsFrozen!==false)errors.push('browser minimums must remain unfrozen');
  if(matrix?.crossBrowserReleaseMatrixClosed!==false)errors.push('matrix cannot claim cross-browser closure');
  if(matrix?.resourceFloorClaimed!==false)errors.push('matrix cannot claim a resource floor');

  const rows=matrix?.rows??[];
  const ids=rows.map(x=>x.id);
  const required=['chrome-linux-declared','chrome-windows','chrome-macos','firefox-linux','safari-macos','chrome-android','chrome-linux-weak-device'];
  if(!same(ids,required))errors.push('matrix row set/order drift');

  const supported=rows.filter(x=>x.status==='SUPPORTED-EVIDENCE-BACKED');
  if(supported.length!==1)errors.push('exactly one evidence-backed support row is allowed');
  const declared=supported[0];
  const evidence=scope?.declaredEvidenceProfile;
  if(declared){
    if(declared.evidenceProfile!==evidence?.id)errors.push('declared evidence profile drift');
    if(declared.browser?.product!==evidence?.browser?.product)errors.push('declared browser product drift');
    if(declared.browser?.version!==evidence?.browser?.exactEvidenceVersion)errors.push('declared browser version drift');
    if(declared.os?.family!=='Linux'||declared.os?.distribution!=='Ubuntu'||declared.os?.version!==evidence?.os?.version||declared.os?.arch!==evidence?.os?.arch)errors.push('declared OS profile drift');
    if(declared.device?.class!==evidence?.device?.class)errors.push('declared device class drift');
    if(declared.browser?.minimumVersionClaimed!==false)errors.push('declared row cannot freeze a browser minimum');
  }

  for(const row of rows.filter(x=>x!==declared)){
    if(row.status.startsWith('SUPPORTED'))errors.push(row.id+': unsupported evidence promotion');
    if(row.evidenceProfile!==null||row.evidence!==null)errors.push(row.id+': unverified row carries evidence');
    if(row.browser?.minimumVersionClaimed!==false)errors.push(row.id+': browser minimum unexpectedly claimed');
  }

  if(profile?.browser?.crossBrowserReleaseMatrixClosed!==false)errors.push('production profile unexpectedly claims matrix closure');
  if((ledger?.overrides??[]).some(x=>x.id==='P11-13'&&x.closure_met===true))errors.push('P11-13 unexpectedly closed by P15 publication matrix');
  if(matrix?.productionClosed!==false)errors.push('matrix must keep productionClosed=false');

  const doc=String(humanDoc??'');
  for(const row of rows){
    if(!doc.includes(row.id)||!doc.includes(row.status)||!doc.includes(row.claim))errors.push('human matrix omits row '+row.id);
  }
  if(!doc.includes('P11-13')||!doc.includes('P14-13'))errors.push('human matrix omits browser-floor/regression boundaries');
  if(!doc.includes('production_closed=false'))errors.push('human matrix omits production boundary');
  return errors;
}

export async function buildReleaseCompatibilityMatrixReceipt(){
  const [matrix,candidate,scope,profile,ledger,humanDoc]=await Promise.all([
    readJson('release/RELEASE-COMPATIBILITY-MATRIX.v1.0.json'),
    readJson('release/RELEASE-CANDIDATE.v0.1.json'),
    readJson('release/PRODUCT-SCOPE.v1.0.json'),
    readJson('docs/production/PRODUCTION-PROFILE.json'),
    readJson('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'),
    readFile(resolve(repoRoot,'docs/compatibility/RELEASE-COMPATIBILITY-MATRIX.md'),'utf8')
  ]);
  const errors=validateReleaseCompatibilityMatrix({matrix,candidate,scope,profile,ledger,humanDoc});
  const sourcePaths=[
    'release/RELEASE-COMPATIBILITY-MATRIX.v1.0.json',
    'release/RELEASE-CANDIDATE.v0.1.json',
    'release/PRODUCT-SCOPE.v1.0.json',
    'docs/production/PRODUCTION-PROFILE.json',
    'docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json',
    'docs/compatibility/RELEASE-COMPATIBILITY-MATRIX.md'
  ];
  const sourceDigests=[];
  for(const path of sourcePaths){
    const bytes=await readFile(resolve(repoRoot,path));
    sourceDigests.push({path,bytes:bytes.length,sha256:digest(bytes)});
  }
  return {
    schema:'opencontainer.release-compatibility-matrix-receipt.v1.0',
    sourceCommit:gitHead(),
    releaseId:matrix.releaseId,
    version:matrix.version,
    channel:matrix.channel,
    productionProfileId:matrix.productionProfileId,
    rows:matrix.rows.map(row=>({...row})),
    evidenceBackedRows:matrix.rows.filter(x=>x.status==='SUPPORTED-EVIDENCE-BACKED').length,
    unverifiedRows:matrix.rows.filter(x=>x.status!=='SUPPORTED-EVIDENCE-BACKED').length,
    browserMinimumsFrozen:false,
    crossBrowserReleaseMatrixClosed:false,
    resourceFloorClaimed:false,
    sourceDigests,
    errors,
    status:errors.length?'FAIL':'PASS',
    productionClosed:false
  };
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const receipt=await buildReleaseCompatibilityMatrixReceipt();
  const out=resolve(repoRoot,'.artifacts','compatibility');
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'release-compatibility-matrix.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
  if(receipt.status!=='PASS')process.exitCode=1;
}
