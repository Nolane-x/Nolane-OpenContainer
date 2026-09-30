import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const evidence=JSON.parse(readFileSync('release/P13-HISTORICAL-ARCHIVE-EVIDENCE.v1.0.json','utf8'));
const record=JSON.parse(readFileSync(evidence.archive.recordPath,'utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const policy=JSON.parse(readFileSync('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P13-20 historical record is repository-tracked and independently re-verifies',()=>{
  const out=execFileSync(process.execPath,['scripts/verify-historical-release-archive.mjs',evidence.archive.recordPath,'--require-repository'],{encoding:'utf8'});
  const receipt=JSON.parse(out);
  assert.equal(receipt.ok,true);
  assert.equal(receipt.version,'0.1.0-alpha.1');
  assert.equal(receipt.sourceCommit,'974fa1032c0d95c98889ca6f9bfaaa696c95fe9e');
  assert.equal(receipt.archiveFiles,7);
  assert.equal(receipt.repositoryTracked,true);
  assert.equal(receipt.productionClosed,false);
});

test('P13-20 retained archive binds exact main release evidence without external-publication overclaim',()=>{
  assert.equal(evidence.schema,'opencontainer.p13-historical-release-archive-evidence.v1.0');
  assert.equal(evidence.implementation.pullRequest,74);
  assert.equal(evidence.implementation.mergeCommit,'974fa1032c0d95c98889ca6f9bfaaa696c95fe9e');
  assert.equal(evidence.implementation.postMergeCi.runNumber,988);
  assert.equal(evidence.archive.recordSha256,'b10283f7c456c2a9f2af7713e23e37aaa37139e91d8fd0e91fd8472a76803375');
  assert.equal(evidence.archive.candidateArtifact.id,11101696511);
  assert.equal(evidence.releaseArtifact.sha256,'d9f81528025cd1daea0703ff1e5ac19a670a1277326974b952f9d2210e171bc0');
  assert.equal(evidence.releaseArtifact.releaseEvidenceArtifact.id,11101926421);
  assert.equal(record.sourceCommit,evidence.archive.sourceCommit);
  assert.equal(record.artifact.sha256,evidence.releaseArtifact.sha256);
  assert.equal(record.archivePolicy.automatedExpiry,false);
  assert.ok(record.archivePolicy.minimumYears>=10);
  assert.equal(record.archivePolicy.deletionRequiresSupersedingArchive,true);
  assert.equal(evidence.boundaries.artifactBytesArchived,false);
  assert.equal(evidence.boundaries.externalPublicationClaimed,false);
  assert.equal(evidence.boundaries.signingClaimed,false);
  assert.equal(evidence.boundaries.legalClosureClaimed,false);
});

test('P13-20 is promoted alone and other external P13 trust gates remain open',()=>{
  const row=ledger.overrides.find(x=>x.id==='P13-20');
  assert.deepEqual(
    {state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},
    {state:'EVIDENCE',promotion:'RELEASE-VERIFIED',evidence:'p13-historical-release-archive',closure_met:true}
  );
  assert.equal(policy.gateAuthority['P13-20'].machineClosable,true);
  assert.equal(policy.gateAuthority['P13-20'].state,'CLOSED_BY_HISTORY');
  assert.equal(policy.gateAuthority['P13-20'].evidence,'p13-historical-release-archive');
  for(const id of ['P13-03','P13-04','P13-07','P13-09','P13-10','P13-16','P13-17']){
    const current=ledger.overrides.find(x=>x.id===id);
    assert.ok(!current||current.closure_met!==true,id);
  }
  assert.equal(ledger.overrides.filter(x=>x.domain==='P13'&&x.closure_met===true).length,13);
  assert.ok(ledger.overrides.length>=272,'later gate promotions may legitimately extend reconciliation rows');
  assert.ok(ledger.overrides.filter(x=>x.closure_met===true).length>=263,'later gate promotions may legitimately increase global closure');
  assert.equal(ledger.production_closed,false);
});

test('P13-20 promotion is registered and repeated by the critical campaign',()=>{
  const entry=registry.entries.find(x=>x.key==='p13-historical-release-archive');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'RELEASE-VERIFIED',status:'PASS'});
  assert.ok(flake.contract.testFiles.includes('tests/p13-historical-archive-source-audit.test.js'));
  assert.ok(flake.contract.testFiles.includes('tests/p13-historical-archive-evidence.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=103);
  assert.equal(flake.contract.iterations,5);
});
