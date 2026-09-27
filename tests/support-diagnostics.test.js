import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DiagnosticJournal, browserCapabilityProbe, buildSupportBundle, probeDeploymentHeaders, supportPreview } from '../packages/diagnostics/src/index.js';
import { OpenContainer } from '../packages/sdk/src/index.js';
import { OpenContainerProductionProfile } from '../packages/sdk/src/profile.js';

test('diagnostic journal redacts secrets private content and signed URL credentials',()=>{
  const journal=new DiagnosticJournal({limit:20,duplicateLimit:3});
  const secret='sentinel-secret-123456789012345678901234567890';
  journal.record('custom-'+secret,{
    authorization:'Bearer '+secret,
    body:'request '+secret,
    source:'export const secret="'+secret+'"',
    prompt:'tell me '+secret,
    nested:{
      signedUrl:'https://example.test/file?x-amz-signature='+secret+'&ok=1',
      safe:'visible'
    }
  });
  const text=JSON.stringify(journal.list());
  assert.equal(text.includes(secret),false);
  assert.equal(text.includes('request '),false);
  assert.equal(text.includes('export const'),false);
  assert.equal(text.includes('tell me'),false);
  assert.ok(text.includes('[REDACTED]'));
  assert.ok(text.includes('visible'));
});

test('diagnostic journal bounds raw retention and duplicate storms independently',()=>{
  const journal=new DiagnosticJournal({limit:5,duplicateLimit:2});
  for(let index=0;index<20;index++)journal.record('duplicate.event',{value:'same'});
  for(let index=0;index<8;index++)journal.record('unique.event',{value:index});
  const stats=journal.stats();
  assert.equal(stats.limit,5);
  assert.equal(stats.duplicateLimit,2);
  assert.equal(stats.retained,5);
  assert.equal(stats.suppressedDuplicates,18);
  assert.ok(stats.recorded<=10);
  assert.equal(journal.list().length,5);
});

test('support preview lists categories before bundle generation and AI is excluded by default',()=>{
  const preview=supportPreview({deploymentProbe:true});
  assert.equal(preview.schema,'opencontainer.support-bundle-preview.v0.1');
  assert.equal(preview.categories.find((item)=>item.id==='deployment-headers').included,true);
  assert.equal(preview.categories.find((item)=>item.id==='ai-prompt-transcript').included,false);
  assert.equal(preview.privacy.workspaceContentsIncluded,false);
  assert.equal(preview.privacy.httpBodiesIncluded,false);
});

test('support bundle fingerprint uses versions epochs generations and never private workspace bytes',async()=>{
  const runtime=await OpenContainer.boot();
  const secret='private-file-sentinel-12345678901234567890';
  runtime.mount({'private-source.js':'export default "'+secret+'"','safe.txt':'ok'});
  runtime.packages.compile({
    name:'private-app-name',
    version:'1.0.0',
    lockfileVersion:3,
    packages:{
      '':{name:'private-app-name',version:'1.0.0'},
      'node_modules/private-dependency-name':{
        name:'private-dependency-name',
        version:'1.2.3',
        integrity:'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
      }
    }
  });
  runtime.listen(3210,()=>new Response('ok'),{owner:'support-test'});
  runtime.diagnostics.record('release.migration',{status:'published',fromVersion:1,toVersion:2,generation:2,sequence:2,source:secret});
  runtime.diagnostics.record('service-worker.update',{status:'compatible',compatibilityId:OpenContainerProductionProfile.browser.serviceWorkerCompatibilityId,activation:'existing-compatible'});
  runtime.diagnostics.record('custom-'+secret,{token:secret,body:secret});

  const beforeGeneration=runtime.fs.generation;
  const bundle=runtime.supportBundle(Object.assign(new Error('secret '+secret),{code:'OC_INVALID_STATE',details:{secret}}),{
    aiContent:{prompt:'hidden '+secret}
  });
  const again=runtime.supportBundle(Object.assign(new Error('different human message'),{code:'OC_INVALID_STATE'}));
  const serialized=JSON.stringify(bundle);

  assert.equal(bundle.schema,'opencontainer.support-bundle.v0.2');
  assert.match(bundle.fingerprint.id,/^ocfp-v1-[0-9a-f]{16}$/);
  assert.equal(bundle.fingerprint.id,again.fingerprint.id);
  assert.equal(bundle.fingerprint.identity.runtimeVersion,OpenContainerProductionProfile.runtime.version);
  assert.equal(bundle.fingerprint.identity.previewEpoch,runtime.preview.epoch);
  assert.equal(bundle.fingerprint.identity.workspaceGeneration,runtime.fs.generation);
  assert.equal(bundle.fingerprint.identity.packageGeneration,runtime.packages.generation);
  assert.equal(bundle.packageIdentity.nodeCount,1);
  assert.equal(bundle.packageIdentity.content.length,1);
  assert.equal(bundle.outcomes.migration.status,'published');
  assert.equal(bundle.outcomes.update.status,'compatible');
  assert.equal(bundle.ai.included,false);
  assert.equal(bundle.telemetry.remoteAnalytics,false);
  assert.equal(bundle.telemetry.networkEmission,false);
  assert.equal(serialized.includes(secret),false);
  assert.equal(serialized.includes('private-source.js'),false);
  assert.equal(serialized.includes('private-dependency-name'),false);
  assert.equal(serialized.includes('private-app-name'),false);
  assert.equal(runtime.fs.generation,beforeGeneration);
  await runtime.teardown();
});

test('AI prompt and transcript require explicit opt-in and still pass secret redaction',async()=>{
  const runtime=await OpenContainer.boot();
  const secret='ai-secret-123456789012345678901234567890';
  const defaultBundle=runtime.supportBundle(null,{aiContent:{prompt:'hello '+secret,transcript:'world '+secret}});
  assert.equal(defaultBundle.ai.included,false);
  assert.equal(JSON.stringify(defaultBundle).includes('hello'),false);

  const opted=runtime.supportBundle(null,{
    includeAiContent:true,
    aiContent:{prompt:'hello '+secret,transcript:'world '+secret}
  });
  assert.equal(opted.ai.included,true);
  assert.ok(opted.ai.content.prompt.includes('hello'));
  assert.ok(opted.ai.content.transcript.includes('world'));
  assert.equal(JSON.stringify(opted).includes(secret),false);
  await runtime.teardown();
});

test('deployment probe captures only selected headers and no response bodies',async()=>{
  const bodies=[];
  const fetchImpl=async(url)=>{
    const path=new URL(url).pathname;
    bodies.push(path);
    const headers=new Headers();
    if(path==='/'){
      headers.set('cross-origin-opener-policy','same-origin');
      headers.set('cross-origin-embedder-policy','require-corp');
      headers.set('cross-origin-resource-policy','same-origin');
    }else if(path==='/opencontainer-guest-worker.mjs'){
      headers.set('x-opencontainer-worker-profile','strict');
      headers.set('content-security-policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'");
    }else if(path==='/opencontainer-toolchain-worker.mjs'){
      headers.set('x-opencontainer-worker-profile','toolchain');
      headers.set('content-security-policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src 'self'");
    }else if(path==='/opencontainer-sw.js'){
      headers.set('service-worker-allowed','/');
    }
    return new Response('private response body should never be read',{status:200,headers});
  };
  const receipt=await probeDeploymentHeaders('https://user:pass@example.test/app?token=secret#hash',{fetchImpl});
  assert.equal(receipt.ok,true);
  assert.equal(receipt.baseOrigin,'https://example.test');
  assert.equal(receipt.basePath,'/app/');
  assert.equal(JSON.stringify(receipt).includes('user'),false);
  assert.equal(JSON.stringify(receipt).includes('pass'),false);
  assert.equal(JSON.stringify(receipt).includes('private response body'),false);
  assert.deepEqual(bodies,['/','/opencontainer-guest-worker.mjs','/opencontainer-toolchain-worker.mjs','/opencontainer-sw.js']);
});

test('browser capability probe is deterministic about non-browser feature absence',()=>{
  const probe=browserCapabilityProbe({});
  assert.equal(probe.environment,'non-browser');
  assert.equal(probe.crossOriginIsolated,false);
  assert.equal(probe.serviceWorker,false);
  assert.equal(probe.opfs,false);
});


test('diagnostic self-check is deterministic and safe for headless CI reproduction',()=>{
  const run=()=>spawnSync(process.execPath,['scripts/diagnostic-self-check.mjs'],{encoding:'utf8'});
  const first=run();
  const second=run();
  assert.equal(first.status,0,first.stderr||first.stdout);
  assert.equal(second.status,0,second.stderr||second.stdout);
  const a=JSON.parse(first.stdout);
  const b=JSON.parse(second.stdout);
  assert.equal(a.schema,'opencontainer.diagnostic-self-check.v0.1');
  assert.equal(a.ok,true);
  assert.equal(a.fingerprint,b.fingerprint);
  assert.equal(a.errorCode,'OC_COMMAND_NOT_FOUND');
  assert.equal(a.checks.noSecretLeak,true);
  assert.equal(a.checks.readOnlyGeneration,true);
  assert.equal(a.telemetry.remoteAnalytics,false);
  assert.equal(a.telemetry.networkEmission,false);
});
