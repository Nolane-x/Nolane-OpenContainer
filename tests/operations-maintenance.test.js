import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryVFS } from '../packages/vfs/src/index.js';
import { DiagnosticJournal, parseSupportBundle } from '../packages/diagnostics/src/index.js';
import {
  assessRuntimeOperationsPolicy,
  backupExportRecommendation,
  endOfLifeDisposition,
  exerciseIncident,
  exerciseVulnerabilityWorkflow,
  issueRegressionCheck,
  knownIssueQuery,
  localHealthReceipt,
  validateKnownIssues
} from '../packages/operations/src/index.js';

const policy=JSON.parse(readFileSync('release/OPERATIONS-POLICY.v1.0.json','utf8'));
const known=JSON.parse(readFileSync('release/KNOWN-ISSUES.v1.0.json','utf8'));
const disasters=JSON.parse(readFileSync('release/OPERATIONS-DISASTER-SCENARIOS.v1.0.json','utf8'));
const regressions=JSON.parse(readFileSync('release/SECURITY-REGRESSION-REGISTRY.v1.0.json','utf8'));

test('P17 supported-line policy and known-bad runtime fail closed to read-only while preserving export',()=>{
  const fs=new MemoryVFS();
  fs.mount({'state.txt':'safe'});
  const active=assessRuntimeOperationsPolicy({policy,runtimeVersion:'0.1.0-alpha.1',fs});
  assert.equal(active.mode,'read-write');
  assert.equal(active.mutationAllowed,true);

  const bad=assessRuntimeOperationsPolicy({policy,runtimeVersion:'0.1.0-alpha.bad',fs});
  assert.equal(bad.blocked,true);
  assert.equal(bad.mode,'read-only');
  assert.equal(bad.exportAllowed,true);
  assert.equal(fs.readOnly,true);
  assert.match(fs.readOnlyReason,/known-bad-runtime/);
  assert.throws(()=>fs.beginTransaction().writeFile('state.txt','corrupt').commit(),/read-only/i);
  assert.equal(fs.readFile('state.txt'),'safe');
});

test('P17 vulnerability workflow exercises triage embargo fix advisory and disclosure without claiming a verified private channel',()=>{
  const receipt=exerciseVulnerabilityWorkflow(policy,{
    id:'VULN-DRILL-001',
    severity:'CRITICAL',
    affectedVersions:['0.1.0-alpha.1'],
    owner:'security-owner',
    receivedAt:'2026-09-27T00:00:00Z'
  });
  assert.deepEqual(receipt.states,['RECEIVED','TRIAGED','EMBARGOED','FIX_READY','ADVISORY_READY','DISCLOSED']);
  assert.equal(receipt.privateChannelVerified,false);
  assert.equal(receipt.status,'PASS');
});

test('P17 disaster scenarios cover containment recovery notification evidence and post-incident regression',()=>{
  assert.equal(disasters.scenarios.length,4);
  const receipts=disasters.scenarios.map(scenario=>exerciseIncident(policy,scenario));
  assert.deepEqual(receipts.map(x=>x.scenario),policy.disasterExercise.scenarios);
  for(const receipt of receipts){
    assert.equal(receipt.status,'PASS');
    assert.ok(receipt.containment.length>0,receipt.scenario);
    assert.ok(receipt.recovery.length>0,receipt.scenario);
    assert.ok(receipt.notification.length>0,receipt.scenario);
    assert.ok(receipt.evidencePreservation.length>0,receipt.scenario);
  }
});

test('P17 local health is telemetry-free and requires no central service',()=>{
  const journal=new DiagnosticJournal();
  const fs=new MemoryVFS();
  const scope={
    document:{},
    isSecureContext:true,
    crossOriginIsolated:true,
    SharedArrayBuffer:class {},
    WebAssembly:{},
    Worker:class {},
    MessageChannel:class {},
    navigator:{serviceWorker:{},storage:{getDirectory(){},estimate(){}},locks:{request(){}}}
  };
  const receipt=localHealthReceipt({policy,runtimeVersion:'0.1.0-alpha.1',fs,diagnostics:journal,scope});
  assert.equal(receipt.telemetryFree,true);
  assert.equal(receipt.centralServiceRequired,false);
  assert.equal(receipt.remoteRequestCount,0);
  assert.equal(receipt.browser.opfs,true);
  assert.equal(receipt.browser.webLocks,true);
  assert.equal(receipt.diagnostics.telemetry.remoteEnabled,false);
});

test('P17 support bundle parser preserves backward readability for v0.1 and v0.2 metadata',()=>{
  const legacy=parseSupportBundle({
    schema:'opencontainer.support-bundle.v0.1',
    fingerprint:'ocfp:0123456789abcdef',
    profile:{runtimeVersion:'0.0.9-alpha.1'},
    browser:{browser:true},
    privacy:{workspaceContentsIncluded:false,secretsIncluded:false}
  });
  assert.equal(legacy.sourceSchema,'opencontainer.support-bundle.v0.1');
  assert.equal(legacy.runtimeVersion,'0.0.9-alpha.1');
  const current=parseSupportBundle({
    schema:'opencontainer.support-bundle.v0.2',
    fingerprint:'ocfp:fedcba9876543210',
    profile:{runtimeVersion:'0.1.0-alpha.1',profileId:'opencontainer-alpha-chromium-node24-v1'},
    browser:{browser:true,opfs:true},
    privacy:{workspaceContentsIncluded:false,secretsIncluded:false}
  });
  assert.equal(current.sourceSchema,'opencontainer.support-bundle.v0.2');
  assert.equal(current.profileId,'opencontainer-alpha-chromium-node24-v1');
  assert.throws(()=>parseSupportBundle({schema:'opencontainer.support-bundle.v9.0'}),/Unsupported support bundle schema/);
});

test('P17 backup/export and EOL behavior preserve readability without false browser durability guarantees',()=>{
  const backup=backupExportRecommendation(policy,{importance:'important',beforeRiskyChange:true});
  assert.equal(backup.recommendExport,true);
  assert.equal(backup.browserStorageGuarantee,'best-effort');
  assert.equal(backup.nagging,false);
  assert.equal(backup.falseDurabilityGuarantee,false);
  const eol=endOfLifeDisposition(policy,{runtimeVersion:'0.0.8-alpha.1',hasPortableExport:true});
  assert.equal(eol.supported,false);
  assert.equal(eol.projectReadability,true);
  assert.equal(eol.portableExport,true);
  assert.equal(eol.destructiveStorageDowngrade,false);
});

test('P17 confirmed critical/high issue rule is backed by executable retained regressions',()=>{
  const receipt=issueRegressionCheck({policy,registry:regressions});
  assert.equal(receipt.status,'PASS');
  assert.equal(receipt.checked,12);
  assert.deepEqual(receipt.violations,[]);
});

test('P17 known issues remain version/profile/browser mapped with only safe or null workarounds',()=>{
  assert.deepEqual(validateKnownIssues(policy,known),[]);
  const profileIssues=knownIssueQuery({database:known,version:'0.1.0-alpha.1',profile:'desktop-chrome153-ubuntu2404-x64-ci'});
  assert.equal(profileIssues.length,2);
  assert.ok(profileIssues.every(x=>typeof x.browser==='string'));
  assert.ok(known.entries.some(x=>x.relatedGates.includes('P12-17')));
});

test('P17 dependency and browser-watch maintenance policies remain explicit and telemetry independent',()=>{
  assert.equal(policy.dependencyMaintenance.routineAudit,'every CI run');
  assert.match(policy.dependencyMaintenance.emergencyHighCritical,/same-day/);
  assert.deepEqual(policy.browserRegressionWatch.primitives,['OPFS','Web Locks','Service Worker','SharedArrayBuffer','crossOriginIsolated']);
  assert.equal(policy.browserRegressionWatch.centralTelemetryRequired,false);
  assert.equal(policy.browserRegressionWatch.freezeOnRegression,true);
});
