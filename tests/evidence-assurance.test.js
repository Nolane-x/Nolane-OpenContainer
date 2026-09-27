import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  evidenceLevelCounts,
  productionGateLedgerFailures,
  validateAssurancePolicy,
  validateEvidenceRegistry,
  validateNegativeResults
} from '../scripts/evidence-assurance-policy.mjs';

const policy=JSON.parse(readFileSync('release/EVIDENCE-ASSURANCE-POLICY.v1.0.json','utf8'));
const registry=JSON.parse(readFileSync('release/EVIDENCE-REGISTRY.v1.0.json','utf8'));
const negativeResults=JSON.parse(readFileSync('release/EVIDENCE-NEGATIVE-RESULTS.v1.0.json','utf8'));
const corpusLock=JSON.parse(readFileSync('release/EVIDENCE-CORPUS-LOCK.v1.0.json','utf8'));
const corpus=JSON.parse(readFileSync(corpusLock.corpusPath,'utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));

function clone(value){return JSON.parse(JSON.stringify(value));}

test('P18 assurance policy is fail-closed and complete',()=>{
  assert.deepEqual(validateAssurancePolicy(policy),[]);
  assert.equal(policy.criticalClaimPolicy.sourceOrDocumentationCannotCloseCriticalGate,true);
  assert.equal(policy.criticalClaimPolicy.blockedHarnessCannotPass,true);
  assert.equal(policy.finalReleaseDecision.aggregatePercentageCannotOverrideOpenGate,true);
});

test('every ledger evidence key is typed and every closed gate has executable integration-or-stronger evidence',()=>{
  assert.deepEqual(validateEvidenceRegistry({policy,registry,ledger}),[]);
  const counts=evidenceLevelCounts({registry,ledger});
  assert.ok(counts.BROWSER>0);
  assert.equal(counts['BLOCKED-HARNESS'],0);
});

test('source-only evidence cannot be used to close a critical gate',()=>{
  const broken=clone(ledger);
  const row=broken.overrides.find(item=>item.closure_met===true);
  row.evidence='oracle';
  assert.ok(validateEvidenceRegistry({policy,registry,ledger:broken}).some(item=>item.includes('non-executable evidence')));
});

test('BLOCKED-HARNESS cannot become passing evidence',()=>{
  const broken=clone(registry);
  broken.entries.push({key:'blocked-fixture',kind:'EXECUTABLE',level:'BLOCKED-HARNESS',status:'PASS',ref:'none',note:'invalid'});
  assert.ok(validateEvidenceRegistry({policy,registry:broken,ledger}).some(item=>item.includes('BLOCKED-HARNESS cannot be PASS')));
});

test('negative and falsified results remain append-only and harness exclusions are reason-coded',()=>{
  assert.deepEqual(validateNegativeResults({policy,negativeResults}),[]);
  assert.ok(negativeResults.results.some(item=>item.classification==='HYPOTHESIS_FALSIFIED'));
  assert.ok(negativeResults.results.some(item=>item.classification==='HARNESS_INVALID'));
});

test('non-harness failures cannot be disguised as exclusions',()=>{
  const broken=clone(negativeResults);
  broken.results[0].exclusionReasonCode='HARNESS_TOOLING_BUG';
  assert.ok(validateNegativeResults({policy,negativeResults:broken}).some(item=>item.includes('must remain outcome data')));
});

test('compatibility corpus is frozen by content-addressed git blob identity and counted programmatically',()=>{
  assert.equal(corpus.schema,corpusLock.corpusSchema);
  assert.equal(corpus.frozenAt,corpusLock.corpusFrozenAt);
  assert.equal(corpus.cases.length,corpusLock.caseCount);
  const actual=execFileSync('git',['hash-object',corpusLock.corpusPath],{encoding:'utf8'}).trim();
  assert.equal(actual,corpusLock.gitBlobSha);
});

test('final production decision cannot be inferred from aggregate percentage or production_closed boolean alone',()=>{
  const current=productionGateLedgerFailures(ledger);
  assert.ok(current.some(item=>item.includes('incomplete')));
  const forged=clone(ledger);
  forged.production_closed=true;
  const failures=productionGateLedgerFailures(forged);
  assert.ok(failures.some(item=>item.includes('incomplete')));
});
