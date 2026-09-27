import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export async function readJson(path){
  return JSON.parse(await readFile(resolve(repoRoot,path),'utf8'));
}

export function gitHead(){
  const r=spawnSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'});
  if(r.status!==0)throw new Error('git rev-parse HEAD failed');
  return r.stdout.trim();
}

function sha256(bytes){
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sourceDigest(path){
  const bytes=await readFile(resolve(repoRoot,path));
  return {path,bytes:bytes.length,sha256:sha256(bytes)};
}

function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}

export function validateReleaseCompatibilityReport({report,candidate,baseline,scope,knownIssues,profile,humanDoc}){
  const errors=[];
  if(report?.schema!=='opencontainer.release-compatibility-report.v1.0')errors.push('invalid release compatibility report schema');
  if(report?.sourceGate!=='OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P11-14')errors.push('report is not bound to P11-14');
  if(report?.releaseId!==candidate?.releaseId)errors.push('releaseId drift');
  if(report?.channel!==candidate?.channel)errors.push('channel drift');
  if(report?.version!==candidate?.version)errors.push('version drift');
  if(report?.profileId!==profile?.profileId)errors.push('production profile drift');
  if(report?.declaredEvidenceProfile!==scope?.declaredEvidenceProfile?.id)errors.push('declared evidence profile drift');
  if(!same(report?.limitations,baseline?.limitations))errors.push('known limitations are not an exact baseline copy');
  if(!same(report?.unsupportedClasses,scope?.unsupportedClasses))errors.push('unsupported classes are not an exact product-scope copy');

  const issueIds=(knownIssues?.entries??[]).map(x=>x.id);
  if(!same(report?.knownIssueIds,issueIds))errors.push('known issue IDs are incomplete or reordered');
  for(const item of knownIssues?.entries??[]){
    if(!item.version||!item.profile||!item.browser)errors.push(item.id+': known issue lacks release/profile/browser mapping');
    if(item.workaround!==null&&item.safeWorkaround!==true)errors.push(item.id+': workaround is not explicitly safe');
  }

  const forbidden=(report?.forbiddenClaims??[]).join('\n').toLowerCase();
  for(const phrase of ['cross-browser support','weak-device support','externally published @nolane/opencontainer package','production closed']){
    if(!forbidden.includes(phrase))errors.push('missing forbidden claim boundary: '+phrase);
  }
  if(report?.productionClosed!==false)errors.push('report must keep productionClosed=false');
  if(profile?.browser?.crossBrowserReleaseMatrixClosed!==false)errors.push('profile unexpectedly claims cross-browser matrix closure');
  if(!(baseline?.limitations??[]).some(x=>/cross-browser versions/.test(x)))errors.push('baseline must preserve unfrozen browser-minimum limitation');

  const doc=String(humanDoc??'');
  const lower=doc.toLowerCase();
  for(const limitation of report?.limitations??[]){
    if(!lower.includes(String(limitation).toLowerCase()))errors.push('human report omits limitation: '+limitation);
  }
  for(const item of report?.unsupportedClasses??[]){
    if(!doc.includes(item.id)||!lower.includes(item.statement.toLowerCase()))errors.push('human report omits unsupported class '+item.id);
  }
  for(const id of report?.knownIssueIds??[]){
    if(!doc.includes(id))errors.push('human report omits known issue '+id);
  }
  if(!doc.includes('P11-12')||!doc.includes('P11-13'))errors.push('human report omits open P11-12/P11-13 boundaries');
  if(!doc.includes('production_closed=false'))errors.push('human report omits production closure boundary');
  return errors;
}

export async function buildReleaseCompatibilityReceipt(){
  const [report,candidate,baseline,scope,knownIssues,profile,humanDoc]=await Promise.all([
    readJson('release/RELEASE-COMPATIBILITY-REPORT.v1.0.json'),
    readJson('release/RELEASE-CANDIDATE.v0.1.json'),
    readJson('docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json'),
    readJson('release/PRODUCT-SCOPE.v1.0.json'),
    readJson('release/KNOWN-ISSUES.v1.0.json'),
    readJson('docs/production/PRODUCTION-PROFILE.json'),
    readFile(resolve(repoRoot,'docs/compatibility/RELEASE-COMPATIBILITY-REPORT.md'),'utf8')
  ]);
  const errors=validateReleaseCompatibilityReport({report,candidate,baseline,scope,knownIssues,profile,humanDoc});
  const sources=await Promise.all([
    'release/RELEASE-COMPATIBILITY-REPORT.v1.0.json',
    'release/RELEASE-CANDIDATE.v0.1.json',
    'docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json',
    'release/PRODUCT-SCOPE.v1.0.json',
    'release/KNOWN-ISSUES.v1.0.json',
    'docs/production/PRODUCTION-PROFILE.json',
    'docs/compatibility/RELEASE-COMPATIBILITY-REPORT.md'
  ].map(sourceDigest));

  return {
    schema:'opencontainer.release-compatibility-report-receipt.v1.0',
    sourceCommit:gitHead(),
    releaseId:report.releaseId,
    channel:report.channel,
    version:report.version,
    profileId:report.profileId,
    declaredEvidenceProfile:report.declaredEvidenceProfile,
    compatibilityAxes:[...baseline.axes],
    limitations:[...report.limitations],
    unsupportedClasses:report.unsupportedClasses.map(x=>({...x})),
    knownIssues:(knownIssues.entries??[]).map(x=>({
      id:x.id,status:x.status,version:x.version,profile:x.profile,browser:x.browser,area:x.area,
      summary:x.summary,workaround:x.workaround,safeWorkaround:x.safeWorkaround,relatedGates:[...x.relatedGates]
    })),
    openBoundaries:[...report.requiredOpenBoundaries],
    forbiddenClaims:[...report.forbiddenClaims],
    sourceDigests:sources,
    limitationCount:report.limitations.length,
    unsupportedClassCount:report.unsupportedClasses.length,
    knownIssueCount:report.knownIssueIds.length,
    productionClosed:false,
    errors,
    status:errors.length?'FAIL':'PASS'
  };
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const receipt=await buildReleaseCompatibilityReceipt();
  const outDir=resolve(repoRoot,'.artifacts','compatibility');
  await mkdir(outDir,{recursive:true});
  await writeFile(resolve(outDir,'release-compatibility-report.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
  if(receipt.status!=='PASS')process.exitCode=1;
}
