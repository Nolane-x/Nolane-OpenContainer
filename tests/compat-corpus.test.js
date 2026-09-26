import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loadCompatibilitySources,
  validateCompatibilitySources,
  buildCompatibilityBaseline,
  gitBlobSha
} from '../scripts/compat-corpus.mjs';

test('P11 compatibility corpus is frozen, representative and keeps unsupported classes',async()=>{
  const {corpus,adapters}=await loadCompatibilitySources();
  assert.deepEqual(validateCompatibilitySources(corpus,adapters),[]);
  assert.equal(corpus.cases.length,13);
  assert.deepEqual(corpus.axes,['fs','module','process','http','package','watch']);
  assert.ok(corpus.cases.some(entry=>entry.id==='vite-react-tiny'&&entry.lockfile?.runtimeParser==='supported'));
  assert.ok(corpus.cases.some(entry=>entry.id==='vite-react-medium'&&entry.lockfile?.runtimeParser==='unsupported'));
  assert.ok(corpus.cases.some(entry=>entry.strata?.includes('native-addon')));
  assert.ok(corpus.cases.some(entry=>entry.strata?.includes('optional-native')));
  assert.ok(corpus.cases.some(entry=>entry.strata?.includes('streams')));
  assert.ok(corpus.cases.some(entry=>entry.strata?.includes('crypto')));
  assert.ok(corpus.cases.some(entry=>entry.strata?.includes('zlib')));
});

test('machine-readable compatibility baseline is generated from the same corpus used by tests',async()=>{
  const {corpus,adapters}=await loadCompatibilitySources();
  const generated=buildCompatibilityBaseline(corpus,adapters);
  const published=JSON.parse(readFileSync('docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json','utf8'));
  assert.deepEqual(published,generated);
  assert.equal(generated.productionClosed,false);
  assert.equal('percentage' in generated,false);
  assert.equal(generated.corpusSummary.caseCount,13);
  assert.ok(generated.corpusSummary.unsupportedRetained.length>=3);
});

test('adapter substitutions name semantic strength per surface',async()=>{
  const {corpus,adapters}=await loadCompatibilitySources();
  const bySurface=new Map(adapters.adapters.map(item=>[item.surface,item]));
  for(const axis of corpus.axes)assert.ok(bySurface.has(axis),axis+' adapter missing');
  assert.equal(bySurface.get('process').semantics,'intentionally-different');
  assert.equal(bySurface.get('tty').semantics,'bounded');
  assert.equal(bySurface.get('native-addon').semantics,'unsupported');
});

test('Git blob SHA helper matches canonical git object hashing',()=>{
  const bytes=new TextEncoder().encode('hello\n');
  assert.equal(gitBlobSha(bytes),'ce013625030ba8dba906f756967f9e9ca394464a');
});
