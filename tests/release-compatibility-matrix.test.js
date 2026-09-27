import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateReleaseCompatibilityMatrix } from '../scripts/release-compatibility-matrix.mjs';

const matrix=JSON.parse(readFileSync('release/RELEASE-COMPATIBILITY-MATRIX.v1.0.json','utf8'));
const candidate=JSON.parse(readFileSync('release/RELEASE-CANDIDATE.v0.1.json','utf8'));
const scope=JSON.parse(readFileSync('release/PRODUCT-SCOPE.v1.0.json','utf8'));
const profile=JSON.parse(readFileSync('docs/production/PRODUCTION-PROFILE.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const humanDoc=readFileSync('docs/compatibility/RELEASE-COMPATIBILITY-MATRIX.md','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));

test('P15 per-release browser OS profile matrix has one evidence-backed row and explicit unverified rows',()=>{
  assert.deepEqual(validateReleaseCompatibilityMatrix({matrix,candidate,scope,profile,ledger,humanDoc}),[]);
  assert.equal(matrix.rows.length,7);
  assert.equal(matrix.rows.filter(x=>x.status==='SUPPORTED-EVIDENCE-BACKED').length,1);
  assert.equal(matrix.rows.filter(x=>x.status!=='SUPPORTED-EVIDENCE-BACKED').length,6);
  assert.equal(matrix.browserMinimumsFrozen,false);
  assert.equal(matrix.crossBrowserReleaseMatrixClosed,false);
  assert.equal(matrix.resourceFloorClaimed,false);
});

test('P15 matrix fails closed if an unverified profile is promoted without retained evidence',()=>{
  const broken=clone(matrix);
  broken.rows.find(x=>x.id==='firefox-linux').status='SUPPORTED-EVIDENCE-BACKED';
  assert.ok(validateReleaseCompatibilityMatrix({matrix:broken,candidate,scope,profile,ledger,humanDoc}).some(x=>/exactly one|unsupported evidence promotion/.test(x)));
});

test('P15 matrix fails closed if the declared Chrome evidence profile drifts',()=>{
  const broken=clone(matrix);
  broken.rows[0].browser.version='154.0.0.0';
  assert.ok(validateReleaseCompatibilityMatrix({matrix:broken,candidate,scope,profile,ledger,humanDoc}).some(x=>x.includes('browser version drift')));
});

test('P15 matrix publication does not freeze P11-13 browser minimums or weak-device floors',()=>{
  assert.equal(ledger.overrides.some(x=>x.id==='P11-13'&&x.closure_met===true),false);
  assert.ok(matrix.openBoundaries.some(x=>x.startsWith('P11-13')));
  assert.ok(matrix.openBoundaries.some(x=>x.includes('weak-device')));
  assert.equal(matrix.rows.find(x=>x.id==='chrome-linux-weak-device').status,'UNVERIFIED-RESOURCE-FLOOR');
});
