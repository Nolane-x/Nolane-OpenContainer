import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MemoryVFS } from '../packages/vfs/src/index.js';
import { DiagnosticJournal, parseSupportBundle } from '../packages/diagnostics/src/index.js';
import {
  assessRuntimeOperationsPolicy,
  backupExportRecommendation,
  endOfLifeDisposition,
  exerciseIncident,
  exerciseVulnerabilityWorkflow,
  issueRegressionCheck,
  localHealthReceipt,
  validateKnownIssues
} from '../packages/operations/src/index.js';

const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const [policy,known,disasters,regressions]=await Promise.all([
  readJson('release/OPERATIONS-POLICY.v1.0.json'),
  readJson('release/KNOWN-ISSUES.v1.0.json'),
  readJson('release/OPERATIONS-DISASTER-SCENARIOS.v1.0.json'),
  readJson('release/SECURITY-REGRESSION-REGISTRY.v1.0.json')
]);
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
if(git.status!==0)throw new Error('git rev-parse HEAD failed');
const sourceCommit=git.stdout.trim();

const fs=new MemoryVFS();
fs.mount({'project.txt':'recoverable'});
const active=assessRuntimeOperationsPolicy({policy,runtimeVersion:policy.releaseSupport.activeVersion,fs});
const badFs=new MemoryVFS();
badFs.mount({'project.txt':'preserve'});
const blocked=assessRuntimeOperationsPolicy({policy,runtimeVersion:policy.runtimeBlock.blockedVersions[0],fs:badFs});
let blockedMutation=false;
try{badFs.beginTransaction().writeFile('project.txt','forbidden').commit();}catch{blockedMutation=true;}

const vulnerability=exerciseVulnerabilityWorkflow(policy,{
  id:'VULN-DRILL-001',
  severity:'CRITICAL',
  affectedVersions:[policy.releaseSupport.activeVersion],
  owner:'security-owner',
  receivedAt:'2026-09-27T00:00:00Z'
});
const incidents=disasters.scenarios.map(scenario=>exerciseIncident(policy,scenario));
const health=localHealthReceipt({
  policy,
  runtimeVersion:policy.releaseSupport.activeVersion,
  fs,
  diagnostics:new DiagnosticJournal(),
  scope:{
    document:{},
    isSecureContext:true,
    crossOriginIsolated:true,
    SharedArrayBuffer:class {},
    WebAssembly:{},
    Worker:class {},
    MessageChannel:class {},
    navigator:{serviceWorker:{},storage:{getDirectory(){},estimate(){}},locks:{request(){}}}
  }
});
const regression=issueRegressionCheck({policy,registry:regressions});
const knownIssueErrors=validateKnownIssues(policy,known);
const backup=backupExportRecommendation(policy,{importance:'important',beforeRiskyChange:true});
const eol=endOfLifeDisposition(policy,{runtimeVersion:'0.0.8-alpha.1',hasPortableExport:true});
const supportV1=parseSupportBundle({
  schema:'opencontainer.support-bundle.v0.1',
  fingerprint:'ocfp:0123456789abcdef',
  profile:{runtimeVersion:'0.0.9-alpha.1'},
  browser:{browser:true},
  privacy:{workspaceContentsIncluded:false,secretsIncluded:false}
});
const supportV2=parseSupportBundle({
  schema:'opencontainer.support-bundle.v0.2',
  fingerprint:'ocfp:fedcba9876543210',
  profile:{runtimeVersion:policy.releaseSupport.activeVersion,profileId:'opencontainer-alpha-chromium-node24-v1'},
  browser:{browser:true,opfs:true},
  privacy:{workspaceContentsIncluded:false,secretsIncluded:false}
});

const failures=[];
if(active.mode!=='read-write')failures.push('active runtime line is not writable');
if(blocked.mode!=='read-only'||!blockedMutation)failures.push('known-bad runtime did not block mutation');
if(vulnerability.status!=='PASS'||!vulnerability.states.includes('EMBARGOED'))failures.push('vulnerability lifecycle drill failed');
for(const receipt of incidents){
  if(receipt.status!=='PASS'||!receipt.containment.length||!receipt.recovery.length||!receipt.notification.length||!receipt.evidencePreservation.length){
    failures.push('incident drill incomplete: '+receipt.scenario);
  }
}
if(health.remoteRequestCount!==0||health.centralServiceRequired!==false||health.telemetryFree!==true)failures.push('health check is not local/telemetry-free');
if(regression.status!=='PASS')failures.push('issue-to-regression rule failed');
failures.push(...knownIssueErrors.map(x=>'known issue: '+x));
if(!backup.recommendExport||backup.falseDurabilityGuarantee)failures.push('backup/export recommendation invalid');
if(!eol.portableExport||!eol.projectReadability||eol.destructiveStorageDowngrade)failures.push('EOL readability/export rule invalid');
if(supportV1.sourceSchema!=='opencontainer.support-bundle.v0.1'||supportV2.sourceSchema!=='opencontainer.support-bundle.v0.2')failures.push('support bundle backward parser failed');

const raw={
  active,blocked,blockedMutation,vulnerability,incidents,health,regression,
  knownIssueCount:known.entries.length,
  backup,eol,supportSchemas:[supportV1.sourceSchema,supportV2.sourceSchema],
  dependencyMaintenance:policy.dependencyMaintenance,
  browserRegressionWatch:policy.browserRegressionWatch
};
const rawText=JSON.stringify(raw,null,2)+'\n';
const receipt={
  schema:'opencontainer.operations-drill-receipt.v1.0',
  sourceCommit,
  status:failures.length?'FAIL':'PASS',
  failures,
  processGateCount:14,
  vulnerabilityStates:vulnerability.states.length,
  incidentScenarios:incidents.length,
  knownIssues:known.entries.length,
  regressionEntries:regression.checked,
  localHealthRemoteRequests:health.remoteRequestCount,
  supportSchemas:[supportV1.sourceSchema,supportV2.sourceSchema],
  blockedRuntimeMutation:blockedMutation,
  rawSha256:createHash('sha256').update(rawText).digest('hex'),
  productionClosed:false
};
const outDir=resolve('.artifacts/operations');
await mkdir(outDir,{recursive:true});
await writeFile(resolve(outDir,'raw-results.json'),rawText);
await writeFile(resolve(outDir,'operations-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(failures.length)process.exitCode=1;
