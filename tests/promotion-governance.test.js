import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPromotionInputs, validateThresholds, evaluatePromotion } from '../scripts/evaluate-promotion.mjs';

test('promotion thresholds are frozen, monotonic and baseline-bound',async()=>{
  const {thresholds}=await loadPromotionInputs();
  assert.deepEqual(validateThresholds(thresholds),[]);
  assert.equal(thresholds.frozenAgainst.compatibilityBaselineGitBlob,'59e43edd0c4c17c04c89f268b03e8b205b52b2f9');
  assert.equal(thresholds.frozenAgainst.gateSourceSha256,'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146');
  assert.deepEqual(thresholds.levels.map((level)=>level.id),['alpha','beta','rc','1.0']);
});

test('current compatibility evidence qualifies only the highest actually satisfied frozen level',async()=>{
  const inputs=await loadPromotionInputs();
  const receipt=evaluatePromotion(inputs);
  assert.equal(receipt.qualifiedLevel,'alpha');
  assert.equal(receipt.productionClosed,false);
  assert.equal(receipt.levels.find((level)=>level.id==='alpha').qualified,true);
  assert.equal(receipt.levels.find((level)=>level.id==='beta').qualified,false);
  assert.ok(receipt.levels.find((level)=>level.id==='beta').gateFailures.includes('P11-12'));
  assert.equal(receipt.levels.find((level)=>level.id==='1.0').qualified,false);
});

test('oracle exception policy is exact-version, fail-closed and currently has no hidden mismatch',()=>{
  const policy=JSON.parse(readFileSync('compat/NODE24-ORACLE-EXCEPTIONS.v0.1.json','utf8'));
  assert.equal(policy.oracle.version,'24.21.0');
  assert.equal(policy.policy.unlistedMismatch,'FAIL');
  assert.equal(policy.policy.staleException,'FAIL');
  assert.equal(policy.selectedDifferentialCases.length,10);
  assert.deepEqual(policy.exceptions,[]);
});

test('promotion evaluator refuses to skip a lower level',async()=>{
  const inputs=await loadPromotionInputs();
  const beta=inputs.thresholds.levels.find((level)=>level.id==='beta');
  beta.requiredClosedGates=[];
  beta.requirements={};
  const alpha=inputs.thresholds.levels.find((level)=>level.id==='alpha');
  alpha.requiredClosedGates=['P11-NOT-CLOSED'];
  const receipt=evaluatePromotion(inputs);
  assert.equal(receipt.qualifiedLevel,null);
  assert.equal(receipt.levels.find((level)=>level.id==='beta').qualified,false);
});
