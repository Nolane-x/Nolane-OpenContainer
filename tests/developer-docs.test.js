import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as sdkModule from '../packages/sdk/src/index.js';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';
import { generateDeveloperDocs } from '../scripts/generate-developer-docs.mjs';

async function json(path){
  return JSON.parse(await readFile(path,'utf8'));
}

test('public SDK contract exactly matches exported module and class surface',async()=>{
  const contract=await json('docs/api/PUBLIC-SDK.v0.1.json');
  const root=await json('package.json');
  assert.equal(contract.schema,'opencontainer.public-sdk.v0.1');
  assert.equal(contract.version,root.version);
  assert.deepEqual(Object.keys(sdkModule).sort(),[...contract.rootExports].sort());

  const staticActual=Object.getOwnPropertyNames(OpenContainer)
    .filter((name)=>!['length','name','prototype'].includes(name))
    .sort();
  assert.deepEqual(staticActual,contract.staticMembers.map((item)=>item.name).sort());

  const instanceActual=Object.getOwnPropertyNames(OpenContainer.prototype)
    .filter((name)=>name!=='constructor')
    .sort();
  assert.deepEqual(instanceActual,contract.instanceMembers.map((item)=>item.name).sort());

  const runtime=await OpenContainer.boot();
  assert.deepEqual(Object.keys(runtime).sort(),[...contract.advancedRuntimeFacets].sort());
  await runtime.teardown();

  for(const subpath of contract.privacyBoundary.noPublicPackageSubpaths){
    assert.equal(Object.hasOwn(contract.exportMap,subpath),false,subpath+' unexpectedly became public');
  }
});

test('stable error catalog exactly covers protocol ErrorCodes with actionable metadata',async()=>{
  const catalog=await json('docs/api/ERROR-CATALOG.v0.1.json');
  const codes=Object.values(ErrorCodes).sort();
  const catalogCodes=catalog.errors.map((item)=>item.code).sort();
  assert.deepEqual(catalogCodes,codes);
  const classes=new Set(catalog.compatibilityClasses);
  for(const item of catalog.errors){
    assert.ok(item.code.startsWith('OC_'));
    assert.ok(classes.has(item.compatibilityClass),item.code+' compatibility class missing');
    assert.ok(item.cause.length>=20,item.code+' cause too weak');
    assert.ok(item.consequence.length>=20,item.code+' consequence too weak');
    assert.ok(item.recovery.length>=20,item.code+' recovery too weak');
  }
});

test('generated API and error references cannot drift from machine contracts',async()=>{
  const receipt=await generateDeveloperDocs();
  assert.equal(receipt.ok,true,JSON.stringify(receipt.drift));
  assert.deepEqual(receipt.drift,[]);
});

test('developer guides preserve required compatibility and safety boundaries',async()=>{
  const [limitations,storage,security,ai,migration,troubleshooting,hosting]=await Promise.all([
    readFile('docs/guides/LIMITATIONS.md','utf8'),
    readFile('docs/guides/STORAGE-AND-EXPORT.md','utf8'),
    readFile('docs/guides/SECURITY-MODEL.md','utf8'),
    readFile('docs/guides/AI-CONSUMERS.md','utf8'),
    readFile('docs/guides/MIGRATION.md','utf8'),
    readFile('docs/guides/TROUBLESHOOTING.md','utf8'),
    readFile('docs/guides/HOSTING-HEADERS.md','utf8')
  ]);

  for(const term of ['.node','Raw TCP/UDP','package-lock','fs.watch','runtime.registerCommand'])assert.ok(limitations.includes(term),term);
  for(const term of ['quota','evicted','portable escape hatch','not a browser-durable backup'])assert.ok(storage.includes(term),term);
  for(const term of ['Do not place long-lived secrets','trusted server','denied','Service Worker'])assert.ok(security.includes(term),term);
  assert.ok(ai.includes('AI is an optional consumer'));
  assert.ok(ai.includes('must not redefine Core guarantees'));
  for(const term of ['DEPRECATIONS.v0.1.json','adjacent-version','read-only','Service Worker'])assert.ok(migration.includes(term),term);
  for(const term of ['error.code','ERROR-REFERENCE.md','support bundle','Do not "fix"'])assert.ok(troubleshooting.includes(term),term);
  assert.ok(hosting.includes('hosting:self-check'));
  assert.ok(hosting.includes('final public origin/CDN URL'));
});

test('security-critical non-obvious choices have accepted ADRs',async()=>{
  const paths=[
    'docs/decisions/ADR-004-guest-capability-membrane.md',
    'docs/decisions/ADR-005-service-worker-compatible-promotion.md',
    'docs/decisions/ADR-006-release-storage-publication.md',
    'docs/decisions/ADR-007-release-evidence-and-promotion.md'
  ];
  for(const path of paths){
    const text=await readFile(path,'utf8');
    assert.ok(text.includes('**Status:** Accepted.'),path);
    assert.ok(text.includes('**Reason:**'),path);
    assert.ok(text.includes('**Consequence:**'),path);
  }
});
