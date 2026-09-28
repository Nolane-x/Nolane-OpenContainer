import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PackageGraphAuthority } from '../packages/package-env/src/index.js';
import { gitBlobSha } from '../scripts/compat-corpus.mjs';

const manifest=JSON.parse(readFileSync('compat/p4/ECOSYSTEM-LAYOUT-CORPUS.v1.0.json','utf8'));
const corpus=JSON.parse(readFileSync('compat/REAL-REPOSITORY-CORPUS.v0.1.json','utf8'));

test('P4 frozen real-repository package graphs remain byte-bound to pinned commits',()=>{
  assert.equal(manifest.schema,'opencontainer.p4-ecosystem-layout-corpus.v1.0');
  assert.equal(manifest.fixtures.length,2);

  for(const fixture of manifest.fixtures){
    const bytes=readFileSync(fixture.localPath);
    assert.equal(gitBlobSha(bytes),fixture.blobSha,fixture.id+' lockfile blob drifted');

    const source=corpus.cases.find(entry=>entry.id===fixture.id);
    assert.ok(source,fixture.id+' missing from frozen real-repository corpus');
    assert.equal(source.repository,fixture.repository);
    assert.equal(source.commit,fixture.commit);
    assert.equal(source.lockfile.path,fixture.path);
    assert.equal(source.lockfile.blobSha,fixture.blobSha);
    assert.equal(source.lockfile.runtimeParser,'supported');

    const graph=new PackageGraphAuthority().compile(JSON.parse(bytes.toString('utf8')));
    assert.equal(graph.nodes.length,fixture.expectedGraphNodes);
    assert.equal(graph.lockfileVersion,3);
    assert.equal(graph.layout.authority,'package-lock-physical-locations');
    assert.match(graph.layout.fingerprint,/^layout:[0-9a-f]{16}$/);
    assert.equal(graph.layout.topLevelCount+graph.layout.nestedCount,graph.nodes.length);
  }
});

test('P4 ecosystem tarball corpus retains source URL digest license and provenance bindings',()=>{
  assert.equal(corpus.cases.length,13);
  const published=corpus.cases.filter(entry=>entry.packageTarball?.status==='published');
  assert.equal(published.length,9);

  for(const entry of corpus.cases){
    assert.match(entry.commit,/^[0-9a-f]{40}$/);
    assert.ok(entry.license?.path);
    assert.match(entry.license?.blobSha??'',/^[0-9a-f]{40}$/);
    assert.ok(entry.license?.spdx);

    if(entry.packageTarball?.status!=='published')continue;
    assert.ok(entry.packageTarball.tarball.startsWith('https://registry.npmjs.org/'));
    assert.match(entry.packageTarball.integrity,/^sha512-[A-Za-z0-9+/]+={0,2}$/);
    assert.match(entry.packageTarball.shasum,/^[0-9a-f]{40}$/);
  }
});

test('P4 frozen package graphs retain different real-repository layout fingerprints',()=>{
  const graphs=manifest.fixtures.map(fixture=>{
    const lock=JSON.parse(readFileSync(fixture.localPath,'utf8'));
    return {
      id:fixture.id,
      graph:new PackageGraphAuthority().compile(lock)
    };
  });
  assert.notEqual(graphs[0].graph.layout.fingerprint,graphs[1].graph.layout.fingerprint);
  assert.notEqual(graphs[0].graph.nodes.length,graphs[1].graph.nodes.length);
});
