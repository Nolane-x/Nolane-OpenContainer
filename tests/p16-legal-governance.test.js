import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { inspectTarArchive } from '../packages/package-env/src/index.js';

const policy=JSON.parse(readFileSync('release/P16-LEGAL-GOVERNANCE-POLICY.v1.0.json','utf8'));
const corpusAudit=JSON.parse(readFileSync('release/P16-TEST-CORPUS-LICENSE-AUDIT.v1.0.json','utf8'));
const corpus=JSON.parse(readFileSync('compat/REAL-REPOSITORY-CORPUS.v0.1.json','utf8'));
const bcr=JSON.parse(readFileSync('release/P16-BCR-LICENSE-REVIEW.v1.0.json','utf8'));
const p6=JSON.parse(readFileSync('release/P6-TOOLCHAIN-VITE-EVIDENCE.v1.0.json','utf8'));
const clean=JSON.parse(readFileSync('release/P16-CLEAN-ROOM-SOURCE-REGISTER.v1.0.json','utf8'));
const runner=readFileSync('scripts/p16-legal-governance-readiness.mjs','utf8');
const evidence=JSON.parse(readFileSync('release/P16-LEGAL-GOVERNANCE-EVIDENCE.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('P16 keeps final project license and FTO counsel gates externally open',()=>{
  assert.equal(policy.projectLicense.finalLicenseFrozen,false);
  assert.equal(policy.projectLicense.state,'OPEN_EXTERNAL');
  assert.equal(policy.fto.counselRequired,true);
  assert.equal(policy.fto.decisionRecorded,false);
  assert.equal(policy.fto.state,'OPEN_EXTERNAL');
  for(const id of ['P16-01','P16-05']){
    assert.equal(policy.gateAuthority[id].machineClosable,false);
    assert.equal(policy.gateAuthority[id].state,'OPEN_EXTERNAL');
  }
  assert.equal(policy.productionClosed,false);
});

test('P16 machine-auditable governance gates are promoted only from retained CI evidence',()=>{
  const target=['P16-02','P16-03','P16-04','P16-06','P16-07','P16-08','P16-09','P16-10','P16-11','P16-12','P16-13','P16-14'];
  for(const id of target){
    assert.equal(policy.gateAuthority[id].machineClosable,true,id);
    assert.equal(policy.gateAuthority[id].state,'PROMOTED_CI_EVIDENCE',id);
    assert.equal(policy.gateAuthority[id].evidenceTarget,'p16-legal-governance',id);
    const row=ledger.overrides.find(x=>x.id===id);
    assert.deepEqual({domain:row.domain,state:row.state,promotion:row.promotion,evidence:row.evidence,closure_met:row.closure_met},{domain:'P16',state:'EVIDENCE',promotion:'PASS-INTEGRATION',evidence:'p16-legal-governance',closure_met:true},id);
  }
  for(const id of ['P16-01','P16-05']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain external-open');
  }
  assert.equal(ledger.overrides.filter(x=>x.domain==='P16'&&x.closure_met===true).length,12);
  assert.equal(ledger.overrides.length,286);
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('P16 corpus audit covers all frozen real repositories and resolves NOASSERTION entries explicitly',()=>{
  assert.equal(corpusAudit.externalCases.length,corpus.cases.length);
  assert.equal(corpusAudit.externalCases.length,13);
  for(const item of corpus.cases){
    const review=corpusAudit.externalCases.find(x=>x.id===item.id);
    assert.ok(review,item.id);
    assert.equal(review.commit,item.commit);
    assert.equal(review.licenseBlobSha,item.license.blobSha);
    assert.notEqual(review.reviewedSpdx,'NOASSERTION',item.id);
    assert.equal(review.shippedInOpenContainerRelease,false,item.id);
    assert.equal(review.legalOpinion,false,item.id);
  }
  assert.equal(corpusAudit.decision.unresolvedLicenseIdentity,0);
  assert.equal(corpusAudit.externalCases.find(x=>x.id==='readable-stream').reviewedSpdx,'MIT');
  assert.equal(corpusAudit.externalCases.find(x=>x.id==='browserify-zlib').reviewedSpdx,'MIT');
  for(const row of corpusAudit.projectAuthored)assert.ok(existsSync(row.path),row.path);
});

test('P16 BCR review matches exact P6 identities and retained tarballs carry required notices',async()=>{
  const expected=[
    p6.artifactIdentity.rolldownBrowser,
    p6.artifactIdentity.lightningCss
  ];
  assert.equal(bcr.bcrEntries.length,2);
  for(const source of expected){
    const item=bcr.bcrEntries.find(x=>x.packageName===source.package&&x.toolVersion===source.version&&x.artifactDigest===source.tarballSha256&&x.adapterSemanticProfile===source.semanticProfile);
    assert.ok(item,source.package);
    const bytes=readFileSync(item.retainedTarball);
    assert.equal(sha256(bytes),item.artifactDigest);
    const archive=await inspectTarArchive(new Uint8Array(bytes),{requiredPrefix:'package/',maxFiles:20_000,maxUnpackedBytes:256*1024*1024});
    const entries=archive.entries.filter(x=>x.type==='file');
    const files=new Set(entries.map(x=>x.path));
    const packageJsonEntry=entries.find(x=>x.path==='package/package.json');
    assert.ok(packageJsonEntry,item.packageName+' missing package/package.json');
    const packageJson=JSON.parse(new TextDecoder().decode(packageJsonEntry.data));
    assert.equal(packageJson.license,item.license,item.packageName+' package metadata license drift');
    for(const required of item.requiredArchiveNotices??[])assert.ok(files.has(required),item.packageName+' missing '+required);
    for(const retained of item.retainedDistributionNotices??[]){
      assert.ok(existsSync(retained),item.packageName+' missing retained distribution notice '+retained);
      const notice=readFileSync(retained,'utf8');
      assert.match(notice,/Mozilla Public License Version 2\.0/);
      assert.match(notice,/Exhibit B/);
    }
  }
  const lightning=bcr.bcrEntries.find(x=>x.packageName==='lightningcss-wasm');
  assert.equal(lightning.archiveLicenseOmissionObserved,true);
  assert.deepEqual(lightning.requiredArchiveNotices,[]);
  assert.deepEqual(lightning.retainedDistributionNotices,['third_party/licenses/lightningcss-wasm-1.33.0.MPL-2.0.txt']);
  assert.deepEqual(
    readdirSync('toolchain/vendor').filter(x=>!x.startsWith('.')).map(x=>'toolchain/vendor/'+x).sort(),
    bcr.bcrEntries.map(x=>x.retainedTarball).sort()
  );
});

test('P16 clean-room governance and AI/jurisdiction language preserve legal boundaries',()=>{
  assert.equal(clean.policy.proprietaryImplementationAllowed,false);
  assert.ok(clean.entries.length>=5);
  for(const path of Object.values(policy.documents))assert.ok(existsSync(path),path);
  const contributing=readFileSync('CONTRIBUTING.md','utf8');
  const governance=readFileSync('GOVERNANCE.md','utf8');
  const trademarks=readFileSync('TRADEMARKS.md','utf8');
  const egress=readFileSync('docs/legal/AI-PROVIDER-DATA-EGRESS.md','utf8');
  const jurisdiction=readFileSync('docs/legal/JURISDICTION-ASSUMPTIONS.md','utf8');
  assert.match(contributing,/DCO-1\.1/);
  assert.match(contributing,/No separate CLA/);
  assert.match(governance,/Security Maintainer/);
  assert.match(governance,/Release Approver/);
  assert.match(trademarks,/separate from any source-code license/i);
  assert.match(egress,/does not automatically upload/i);
  assert.match(egress,/provider's terms/i);
  assert.match(jurisdiction,/no public-beta\/commercial launch jurisdiction/i);
  assert.match(jurisdiction,/P16-05/);
  assert.equal(policy.jurisdiction.universalFtoClaim,false);
  assert.equal(policy.jurisdiction.commercialLaunchBlockedUntilCounsel,true);
});

test('P16 executable readiness court consumes actual release notices and retained tarballs',()=>{
  for(const token of [
    '.artifacts/release/third-party-notices.json',
    '.artifacts/release/dependency-license-inventory.json',
    'inspectTarArchive',
    'toolchain/vendor',
    'APPROVED_FOR_TEST_FIXTURE_USE',
    'OPEN_EXTERNAL',
    'P16 LEGAL GOVERNANCE READINESS PASS'
  ])assert.ok(runner.includes(token),token);
});


test('P16 promotion evidence is retained, registered and cannot claim legal/FTO closure',()=>{
  assert.equal(evidence.schema,'opencontainer.p16-legal-governance-evidence.v1.0');
  assert.equal(evidence.pullRequest,78);
  assert.equal(evidence.implementation.head,'aef779d7b3ba1cc1346bbdbb89dd5ec43c472720');
  assert.equal(evidence.implementation.pullRequestContextSha,'3fdd296ac0d735a65c14272410c7ca10d87389fe');
  assert.equal(evidence.implementation.ciRunNumber,1034);
  assert.equal(evidence.implementation.contractPassed,659);
  assert.equal(evidence.implementation.criticalTestFileExecutions,540);
  assert.equal(evidence.implementation.criticalUnexplainedFailures,0);
  assert.equal(evidence.executableCourt.artifactId,11145241386);
  assert.equal(evidence.executableCourt.artifactDigest,'sha256:a68bf140bf1ff56026312f4829f3520fa89e1817de09ca408eb4c1010e4617c5');
  assert.equal(evidence.closure.p16Closed,12);
  assert.equal(evidence.closure.wholeProductClosed,277);
  const entry=registry.entries.find(x=>x.key==='p16-legal-governance');
  assert.deepEqual({kind:entry.kind,level:entry.level,status:entry.status},{kind:'EXECUTABLE',level:'INTEGRATION',status:'PASS'});
  assert.ok(flake.contract.testFiles.includes('tests/p16-legal-governance.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=108,'later critical courts may extend the P16-era 108-file campaign');
  assert.equal(flake.contract.iterations,5);
  for(const value of Object.values(evidence.boundaries))assert.equal(value,false);
  assert.equal(evidence.productionClosed,false);
});
