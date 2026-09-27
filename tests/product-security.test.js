import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadSecurityReviewInputs, validateSecurityEvidencePaths, validateSecurityReview } from '../scripts/security-review-policy.mjs';

test('P12 security policy freezes ASVS CodeQL severity and manual review boundaries',async()=>{
  const inputs=await loadSecurityReviewInputs();
  assert.deepEqual(validateSecurityReview(inputs),[]);
  assert.deepEqual(await validateSecurityEvidencePaths(inputs),[]);
  assert.equal(inputs.policy.asvs.version,'5.0.0');
  assert.equal(inputs.policy.asvs.sha256,'bcdbec214d70abcfad9284a31d4f9e5134305831d628aad3aa85d7e26626cb35');
  assert.equal(inputs.policy.staticAnalysis.actionCommit,'2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2');
  assert.equal(inputs.policy.staticAnalysis.waiverRegistry,'release/SECURITY-STATIC-ANALYSIS-WAIVERS.v1.0.json');
  const waivers=JSON.parse(await readFile(inputs.policy.staticAnalysis.waiverRegistry,'utf8'));
  assert.equal(waivers.schema,'opencontainer.security-static-analysis-waivers.v1.0');
  assert.deepEqual(waivers.waivers,[]);
  assert.equal(inputs.policy.severitySla.CRITICAL.releaseBlocking,true);
  assert.equal(inputs.policy.severitySla.HIGH.releaseBlocking,true);
});

test('threat model covers exact P12 trust zones and future AI credentials remain outside inherited trust',async()=>{
  const {threatModel}=await loadSecurityReviewInputs();
  assert.deepEqual(threatModel.trustZones.map(x=>x.id),[
    'trusted-host','guest-js','package-bytes','preview','storage','future-ai-credentials'
  ]);
  assert.ok(threatModel.threats.some(x=>x.zones.includes('future-ai-credentials')));
  assert.ok(threatModel.assumptions.some(x=>x.includes('outside Core')));
});

test('ASVS mapping is scoped and never silently marks unrelated server controls as PASS',async()=>{
  const {asvs}=await loadSecurityReviewInputs();
  const ids=new Set(asvs.requirements.map(x=>x.id));
  for(const id of ['v5.0.0-1.3.6','v5.0.0-3.4.3','v5.0.0-3.4.8','v5.0.0-5.2.5','v5.0.0-5.3.3'])assert.equal(ids.has(id),true,id);
  assert.equal(asvs.humanReviewRequired,true);
  assert.ok(asvs.exclusions.some(x=>x.area.includes('authentication')));
  assert.ok(asvs.exclusions.some(x=>x.area.includes('TLS/HSTS')));
});

test('machine evidence cannot close disclosure second-party or human-review gates',async()=>{
  const {policy}=await loadSecurityReviewInputs();
  assert.equal(policy.gateAuthority['P12-17'].machineClosable,false);
  assert.equal(policy.gateAuthority['P12-18'].machineClosable,false);
  assert.equal(policy.gateAuthority['P12-20'].machineClosable,false);
  assert.equal(policy.reviewStatus.verifiedPrivateDisclosureChannel,false);
  assert.equal(policy.reviewStatus.independentSecondPartyReviewCompleted,false);
  assert.equal(policy.reviewStatus.humanSecurityReviewCompleted,false);
  assert.equal(policy.reviewStatus.machineSecurityCourtMayClaimProductSecure,false);
  assert.equal(policy.releasePolicy.scannerScoreIsSecurityClaim,false);
});

test('malicious package corpus regression registry and residual risks are retained',async()=>{
  const {maliciousCorpus,regressions,residualRisks}=await loadSecurityReviewInputs();
  assert.equal(maliciousCorpus.cases.length,11);
  assert.equal(new Set(maliciousCorpus.cases.map(x=>x.id)).size,11);
  assert.ok(regressions.entries.length>=12);
  assert.ok(regressions.entries.every(x=>['CRITICAL','HIGH'].includes(x.severity)));
  assert.ok(residualRisks.risks.some(x=>x.id==='RISK-02'&&x.risk.includes('unsafe-eval')));
  assert.ok(residualRisks.risks.some(x=>x.id==='RISK-03'&&x.risk.includes('Chrome 153')));
  assert.ok(residualRisks.risks.some(x=>x.id==='RISK-09'&&x.status==='MANUAL_REVIEW_OPEN'));
});

test('SECURITY.md is honest about supported versions and missing verified private channel',async()=>{
  const security=await readFile('SECURITY.md','utf8');
  assert.match(security,/Supported versions/i);
  assert.match(security,/not production-closed/i);
  assert.match(security,/verified private vulnerability-reporting channel is not yet recorded/i);
  assert.match(security,/Do \*\*not\*\* publish exploit details/i);
  assert.match(security,/P12-17 remains open/i);
  assert.match(security,/not.*substitute.*human product-security review/is);
});


test('P12 resource DoS review covers worker output decompression source-map and WASM growth without claiming a device floor',async()=>{
  const {resourceDos}=await loadSecurityReviewInputs();
  assert.equal(resourceDos.schema,'opencontainer.security-resource-dos-review.v1.0');
  assert.equal(resourceDos.conclusion,'REVIEWED_WITH_RESIDUAL_RISK');
  assert.deepEqual(resourceDos.surfaces.map(x=>x.id),[
    'worker-explosion','output-floods','decompression','source-maps','wasm-memory-growth'
  ]);
  assert.ok(resourceDos.surfaces.filter(x=>x.status==='REVIEWED_RESIDUAL').every(x=>x.residualRisk.length>20));
  assert.ok(resourceDos.boundaries.some(x=>x.includes('P7')));
});
