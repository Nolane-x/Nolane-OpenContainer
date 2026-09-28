import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const graph=readFileSync('packages/package-env/src/index.js','utf8');
const server=readFileSync('apps/playground/server.mjs','utf8');
const browserCourt=readFileSync('apps/playground/public/p4-ecosystem-layout.js','utf8');
const runner=readFileSync('scripts/p4-ecosystem-layout.mjs','utf8');
const workflow=readFileSync('.github/workflows/ci.yml','utf8');
const manifest=JSON.parse(readFileSync('compat/p4/ECOSYSTEM-LAYOUT-CORPUS.v1.0.json','utf8'));

test('P4 physical package layout identity is part of production graph authority',()=>{
  assert.match(graph,/deriveLayoutIdentity\(nodes,root\)/);
  assert.match(graph,/authority:'package-lock-physical-locations'/);
  assert.match(graph,/hoistedTransitiveCount/);
  assert.match(graph,/nestedCount/);
  assert.match(graph,/linkedCount/);
  assert.match(graph,/maxNodeModulesDepth/);
  assert.match(graph,/fingerprint:stableId\('layout'/);
  assert.match(graph,/const layout=deriveLayoutIdentity\(nodes,root\)/);
  assert.match(graph,/\n\s*layout,/);
});

test('P4 browser court executes exact frozen real-repository package graphs',()=>{
  assert.equal(manifest.fixtures.length,2);
  assert.deepEqual(manifest.fixtures.map(item=>item.id),['vite-react-tiny','chokidar-watch']);
  assert.deepEqual(manifest.fixtures.map(item=>item.expectedGraphNodes),[219,8]);
  for(const fixture of manifest.fixtures){
    assert.match(fixture.commit,/^[0-9a-f]{40}$/);
    assert.match(fixture.blobSha,/^[0-9a-f]{40}$/);
    assert.ok(fixture.localPath.startsWith('compat/p4/'));
  }
  assert.match(server,/p4-ecosystem-layout\.html/);
  assert.match(server,/vite-react-tiny\.package-lock\.json/);
  assert.match(server,/chokidar\.package-lock\.json/);
  assert.match(browserCourt,/vite\.nodes\.length===219/);
  assert.match(browserCourt,/chokidar\.nodes\.length===8/);
  assert.match(browserCourt,/hoisted\.layout\.hoistedTransitiveCount===1/);
  assert.match(browserCourt,/nested\.layout\.nestedCount===1/);
});

test('P4 release court binds exact Node oracle and ecosystem provenance verification',()=>{
  assert.match(runner,/process\.version==='v24\.21\.0'/);
  assert.match(runner,/node24-resolver-differential\.test\.js/);
  assert.match(runner,/verifyCorpusOnline\(corpus\)/);
  assert.match(runner,/online\.cases\.length===13/);
  assert.match(runner,/publishedTarballs\.length===9/);
  assert.match(runner,/license\?\.blobSha|license\.blobSha/);
  assert.match(runner,/npmSha512Pins:true/);
  assert.match(runner,/npmSha1Pins:true/);
  assert.match(runner,/sourceCommitPins:true/);
  assert.match(runner,/packageLayoutIdentityObservable:true/);
});

test('P4 ecosystem court is a retained CI job',()=>{
  assert.match(workflow,/p4-ecosystem-layout:/);
  assert.match(workflow,/node-version: 24\.21\.0/);
  assert.match(workflow,/npm run p4:ecosystem-layout:evidence/);
  assert.match(workflow,/opencontainer-p4-ecosystem-layout-/);
});
