import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadP9FailureMatrix, parseP9FailureMatrix, validateP9FailureMatrix, P9_FAILURE_MATRIX_SHA256 } from '../scripts/p9-failure-matrix.mjs';
import { projectFailureScenario, assertFailureProjection } from '../packages/ui-contract/src/index.js';

const source=JSON.parse(readFileSync('release/P9-FAILURE-SCENARIO-SOURCE.v1.0.json','utf8'));
const map=JSON.parse(readFileSync('release/P9-FAILURE-COURT-MAP.v1.0.json','utf8'));
const matrix=readFileSync(source.source.matrixRepositoryPath,'utf8');

test('P9-03 SHA-locked source parses to exactly 280 provenance-qualified scenarios',()=>{
  const result=validateP9FailureMatrix({text:matrix});
  assert.equal(result.ok,true,result.errors.join('; '));
  assert.equal(result.digest,P9_FAILURE_MATRIX_SHA256);
  assert.equal(result.counts.total,280);
  assert.equal(result.counts.uniqueQualifiedKeys,280);
  assert.equal(result.counts.rawIdUnique,234);
  assert.equal(result.counts.duplicatedRawIds,46);
  assert.equal(result.counts.courtClasses,55);
  assert.deepEqual(result.counts.rounds,{base:100,round23:40,round24State:50,round24Completeness:40,round25:50});
  assert.equal(new Set(result.scenarios.map(row=>row.key)).size,280);
  assert.ok(result.duplicatedRawIds.length>0);
});

test('P9-03 does not trust stale intermediate narrative counts over actual table rows',()=>{
  assert.match(matrix,/Round-24 matrix count: 190 scenarios/);
  assert.match(matrix,/Verified row target after Round-24 additions: 190 executable failure scenarios/);
  const rows=parseP9FailureMatrix(matrix);
  assert.equal(rows.filter(row=>row.round!=='round25').length,230);
  assert.equal(rows.filter(row=>row.round==='round25').length,50);
  assert.match(matrix,/Verified row target after Round 25: 280 executable failure scenarios/);
  assert.equal(source.sourceWarnings[0].code,'STALE_INTERMEDIATE_NARRATIVE_COUNT');
});

test('P9-03 executes every row through the failure-state component and retained court map',()=>{
  const result=validateP9FailureMatrix({text:matrix});
  const seen=new Set();
  for(const scenario of result.scenarios){
    const binding=map.courts[scenario.evidenceCourt];
    assert.ok(binding,scenario.key+' missing court map '+scenario.evidenceCourt);
    for(const ref of binding.refs){
      assert.ok(existsSync(ref),scenario.key+' missing retained evidence ref '+ref);
    }
    const projection=projectFailureScenario(scenario,{courtBinding:binding});
    assert.equal(assertFailureProjection(projection),true);
    assert.equal(projection.key,scenario.key);
    assert.equal(projection.state.visible,scenario.userVisibleState);
    assert.equal(projection.state.canonicalGuarantee,scenario.canonicalGuarantee);
    assert.equal(projection.recovery.primaryAction,scenario.primaryRecoveryAction);
    seen.add(projection.key);
  }
  assert.equal(seen.size,280);
  assert.deepEqual(new Set(result.courtClasses),new Set(Object.keys(map.courts)));
});

test('P9-03 component court cannot erase independent manual human or weak-device gates',()=>{
  assert.equal(map.boundaries.p9_05ManualScreenReaderClaimed,false);
  assert.equal(map.boundaries.p9_11HumanComprehensionClaimed,false);
  assert.equal(map.boundaries.p9_12WeakDeviceLongSessionClaimed,false);
  assert.deepEqual(map.courts['screen-reader'].externalAcceptance,['P9-05']);
  assert.deepEqual(map.courts.manual.externalAcceptance,['P9-05']);
  assert.deepEqual(map.courts['weak-device'].externalAcceptance,['P9-12']);
  assert.deepEqual(map.courts['leak-soak'].externalAcceptance,['P9-12']);
  assert.equal(map.boundaries.productionClosed,false);
});

test('P9 failure matrix source remains byte-identical to retained provenance metadata',async()=>{
  const loaded=await loadP9FailureMatrix();
  assert.equal(loaded.ok,true);
  assert.equal(loaded.digest,source.source.matrixSha256);
  assert.equal(source.source.bundleSha256,'9a13d917111372ca538c30d5f565fda6901581a500e2a244812416fd88a009f1');
  assert.equal(source.source.matrixBytes,41083);
});
