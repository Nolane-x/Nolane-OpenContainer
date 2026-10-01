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

test('P16 machine-auditable governance gates are implemented but not self-promoted',()=>{
  const target=['P16-02','P16-03','P16-04','P16-06','P16-07','P16-08','P16-09','P16-10','P16-11','P16-12','P16-13','P16-14'];
  for(const id of target){
    assert.equal(policy.gateAuthority[id].machineClosable,true,id);
    assert.equal(policy.gateAuthority[id].state,'IMPLEMENTED_AWAITING_CI',id);
    assert.equal(policy.gateAuthority[id].evidenceTarget,'p16-legal-governance',id);
  }
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
    const files=new Set(archive.entries.filter(x=>x.type==='file').map(x=>x.path));
    for(const required of item.requiredArchiveNotices)assert.ok(files.has(required),item.packageName+' missing '+required);
  }
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
