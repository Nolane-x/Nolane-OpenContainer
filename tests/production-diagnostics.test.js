import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import {
  DiagnosticJournal,
  DiagnosticsPolicy,
  SupportBundleAuthority,
  SupportBundleSchemas,
  browserCapabilityProbe,
  parseSupportBundle,
  diagnosticFingerprint,
  redact
} from '../packages/diagnostics/src/index.js';
import { OpenContainer } from '../packages/sdk/src/index.js';

const SECRET='sentinel-secret-value-abcdefghijklmnopqrstuvwxyz-0123456789';

test('published diagnostics policy cannot drift from implementation defaults',async()=>{
  const published=JSON.parse(await readFile('docs/production/DIAGNOSTICS-POLICY.v0.1.json','utf8'));
  assert.deepEqual(published,DiagnosticsPolicy);
  assert.equal(published.telemetry.remoteEnabledByDefault,false);
  assert.equal(published.telemetry.builtInRemoteTransport,false);
  assert.equal(published.supportBundle.aiContentIncludedByDefault,false);
});

test('diagnostic journal bounds raw bytes duplicates and terminal history independently',()=>{
  const journal=new DiagnosticJournal({
    limit:10,
    rawBytesLimit:1100,
    duplicateLimit:2,
    duplicateFingerprintLimit:8,
    terminalHistoryLimit:2,
    terminalBytesLimit:1024
  });

  const first=journal.record('runtime.test',{message:'same'});
  const second=journal.record('runtime.test',{message:'same'});
  const suppressed=journal.record('runtime.test',{message:'same'});
  assert.equal(first.suppressed,undefined);
  assert.equal(second.suppressed,undefined);
  assert.equal(suppressed.suppressed,true);

  for(let i=0;i<20;i++)journal.record('runtime.unique',{index:i,padding:'x'.repeat(140)});
  journal.recordTerminal({pid:1,stream:'stdout',byteLength:10});
  journal.recordTerminal({pid:1,stream:'stderr',byteLength:20});
  journal.recordTerminal({pid:2,stream:'stdout',byteLength:30});

  const summary=journal.summary();
  assert.ok(summary.usage.entries<=summary.limits.entries);
  assert.ok(summary.usage.rawBytes<=summary.limits.rawBytes);
  assert.equal(summary.usage.duplicateSuppressed,1);
  assert.ok(summary.usage.duplicateFingerprints<=summary.limits.duplicateFingerprints);
  assert.equal(summary.usage.terminalEntries,2);
  assert.ok(summary.usage.terminalBytes<=summary.limits.terminalBytes);
  assert.equal(summary.telemetry.remoteEnabled,false);
  assert.equal(summary.telemetry.sinkConfigured,false);
});

test('telemetry is opt-in and receives metadata without diagnostic detail',async()=>{
  const delivered=[];
  const journal=new DiagnosticJournal({
    telemetry:{enabled:true,sink:(event)=>delivered.push(event)}
  });
  journal.record('runtime.failure',{secret:SECRET,message:'private '+SECRET});
  assert.equal(delivered.length,1);
  assert.deepEqual(Object.keys(delivered[0]).sort(),['fingerprint','schema','seq','type']);
  assert.equal(JSON.stringify(delivered).includes(SECRET),false);
  assert.equal(journal.telemetry.remoteEnabled,true);
});

test('redaction removes secret fields signed URL values prompt transcript bodies and sentinel strings',()=>{
  const input={
    authorization:'Bearer '+SECRET,
    requestBody:'private-body',
    responseBody:'private-response',
    sourceCode:'const password = 1',
    prompt:'private-prompt',
    transcript:'private-transcript',
    url:'https://example.test/path?x=1&x-amz-signature='+SECRET+'&token='+SECRET,
    public:'visible '+SECRET
  };
  const safe=redact(input);
  const text=JSON.stringify(safe);
  assert.equal(text.includes(SECRET),false);
  assert.equal(safe.authorization,'[REDACTED]');
  assert.equal(safe.requestBody,'[REDACTED]');
  assert.equal(safe.responseBody,'[REDACTED]');
  assert.equal(safe.sourceCode,'[REDACTED]');
  assert.equal(safe.prompt,'[REDACTED]');
  assert.equal(safe.transcript,'[REDACTED]');
  assert.match(safe.url,/\[REDACTED\]/);
});

test('generated secret sentinels do not survive diagnostic logging or support export paths',async()=>{
  const runtime=await OpenContainer.boot({
    diagnostics:{limit:200,rawBytesLimit:64*1024,duplicateLimit:4,duplicateFingerprintLimit:64}
  });
  const sentinels=Array.from({length:32},(_,index)=>
    'generated-secret-'+String(index).padStart(2,'0')+'-'+('z'.repeat(28))
  );
  for(const sentinel of sentinels){
    runtime.diagnostics.record('custom-'+sentinel,{
      authorization:'Bearer '+sentinel,
      body:'http-body-'+sentinel,
      source:'private-source-'+sentinel,
      prompt:'prompt-'+sentinel,
      transcript:'transcript-'+sentinel,
      url:'https://example.test/?signature='+sentinel
    });
  }
  const journalText=JSON.stringify(runtime.diagnostics.list());
  const bundleText=JSON.stringify(runtime.supportBundle(null,{
    ai:{prompt:sentinels[0],transcript:sentinels[1]}
  }));
  for(const sentinel of sentinels){
    assert.equal(journalText.includes(sentinel),false,'journal leaked '+sentinel);
    assert.equal(bundleText.includes(sentinel),false,'bundle leaked '+sentinel);
  }
  await runtime.teardown();
});

test('failure fingerprint is stable and does not contain source content',()=>{
  const value={
    code:'OC_INVALID_STATE',
    versions:{runtime:'0.1.0-alpha.1',rpc:1},
    epoch:7,
    generation:9,
    sourceCode:'export const '+SECRET+' = true'
  };
  const first=diagnosticFingerprint(value);
  const second=diagnosticFingerprint(structuredClone(value));
  assert.equal(first,second);
  assert.match(first,/^ocfp:[0-9a-f]{16}$/);
  assert.equal(first.includes(SECRET),false);
});

test('browser capability probe is structured and deterministic for an injected scope',()=>{
  const fake={
    document:{},
    crossOriginIsolated:true,
    SharedArrayBuffer:class {},
    WebAssembly:{},
    Worker:class {},
    MessageChannel:class {},
    navigator:{
      serviceWorker:{},
      storage:{getDirectory(){},estimate(){}},
      locks:{request(){}}
    }
  };
  const receipt=browserCapabilityProbe(fake);
  assert.equal(receipt.browser,true);
  assert.equal(receipt.crossOriginIsolated,true);
  assert.equal(receipt.sharedArrayBuffer,true);
  assert.equal(receipt.serviceWorker,true);
  assert.equal(receipt.opfs,true);
  assert.equal(receipt.webLocks,true);
});

test('support bundle preview lists categories and generation is read-only',async()=>{
  const runtime=await OpenContainer.boot({
    diagnostics:{
      limit:50,
      rawBytesLimit:4096,
      duplicateLimit:3,
      terminalHistoryLimit:8,
      terminalBytesLimit:2048
    }
  });
  runtime.mount({'private.txt':SECRET});
  runtime.packages.compile({
    name:'support-fixture',
    version:'1.0.0',
    lockfileVersion:3,
    packages:{
      '':{name:'support-fixture',version:'1.0.0',dependencies:{dep:'1.2.3'}},
      'node_modules/dep':{
        name:'dep',
        version:'1.2.3',
        integrity:'sha512-'+SECRET,
        resolved:'https://user:'+SECRET+'@registry.example.test/dep.tgz?token='+SECRET+'#private',
        hasInstallScript:true
      }
    }
  });
  runtime.listen(4123,()=>new Response('ok'),{owner:'support-fixture'});
  runtime.registerCommand('support-echo',({stdout,stderr})=>{
    stdout('public-output');
    stderr('public-error');
    return 0;
  });
  const supportProcess=runtime.spawn('support-echo');
  assert.equal(await supportProcess.exit,0);
  runtime.diagnostics.record('custom-'+SECRET,{
    token:SECRET,
    requestBody:'body '+SECRET,
    url:'https://example.test/?signature='+SECRET,
    public:'visible '+SECRET
  });
  runtime.recordSupportOutcome('migration',{schema:'migration.v1',status:'PASS',fromVersion:1,toVersion:2,secret:SECRET});
  runtime.recordSupportOutcome('update',{schema:'update.v1',status:'PASS',compatibilityId:'sw-v1',secret:SECRET});

  const before={
    fs:runtime.fs.generation,
    packages:runtime.packages.generation,
    preview:runtime.preview.epoch,
    diagnostics:runtime.diagnostics.summary().latestSequence
  };
  const preview=runtime.supportBundlePreview({
    hostingDiagnostics:{
      schema:'opencontainer.hosting-self-check.v0.1',
      ok:true,
      failures:[],
      receipts:[{path:'/',status:200}],
      profileId:runtime.productionProfile.profileId
    },
    ai:{prompt:SECRET,transcript:SECRET}
  });
  assert.equal(preview.privacy.aiContentIncluded,false);
  assert.equal(preview.categories.includes('ai-content-redacted'),false);
  assert.equal(preview.categories.includes('deployment-headers'),true);

  const error=Object.assign(new Error('do not leak '+SECRET),{code:'OC_INVALID_STATE',details:{secret:SECRET}});
  const bundle=runtime.supportBundle(error,{
    hostingDiagnostics:{
      schema:'opencontainer.hosting-self-check.v0.1',
      ok:true,
      failures:[],
      receipts:[{path:'/',status:200}],
      profileId:runtime.productionProfile.profileId
    },
    ai:{prompt:SECRET,transcript:SECRET}
  });
  const serialized=JSON.stringify(bundle);
  assert.equal(bundle.schema,'opencontainer.support-bundle.v0.2');
  assert.match(bundle.fingerprint,/^ocfp:[0-9a-f]{16}$/);
  assert.equal(bundle.profile.runtimeVersion,'0.1.0-alpha.1');
  assert.equal(bundle.packages.compiled,true);
  assert.equal(bundle.packages.nodeCount,1);
  assert.match(bundle.packages.graphFingerprint,/^ocfp:/);
  assert.equal(bundle.packages.components.length,1);
  assert.equal(bundle.packages.components[0].name,'dep');
  assert.match(bundle.packages.components[0].integrity,/^ocfp:|^sha(?:256|384|512)-/);
  assert.equal(bundle.packages.components[0].hasInstallScript,true);
  assert.equal(bundle.packages.components[0].source.kind,'https');
  assert.equal(bundle.packages.components[0].source.url,'https://registry.example.test/dep.tgz');
  assert.match(bundle.packages.components[0].source.fingerprint,/^ocfp:[0-9a-f]{16}$/);
  assert.equal(bundle.packages.components[0].source.sensitiveComponentsRemoved,true);
  assert.equal(
    bundle.packages.components[0].source.fingerprint,
    diagnosticFingerprint('https://registry.example.test/dep.tgz')
  );
  assert.equal(bundle.packages.installScripts.policy,'deny-by-default');
  assert.equal(bundle.packages.installScripts.packageCount,1);
  assert.deepEqual(bundle.packages.installScripts.locations,['node_modules/dep']);
  assert.equal(bundle.packages.analysisScope,'package-provenance-metadata-only');
  assert.equal(bundle.packages.scaAssessmentPerformed,false);
  assert.equal(bundle.packages.nativeAddonBoundary.policy,'deny-unless-exact-adapter');
  assert.equal(bundle.packages.nativeAddonBoundary.detection,'resolver-exact-.node-target-only');
  assert.equal(bundle.packages.nativeAddonBoundary.candidatesEnumerated,false);
  assert.match(bundle.packages.layout.fingerprint,/^layout:[0-9a-f]{16}$/);
  assert.equal(bundle.fingerprintBasis.runtimeVersion,'0.1.0-alpha.1');
  assert.equal(bundle.fingerprintBasis.previewEpoch,before.preview);
  assert.equal(bundle.fingerprintBasis.workspaceGeneration,before.fs);
  assert.equal(bundle.fingerprintBasis.packageGeneration,before.packages);
  assert.equal(bundle.storage.workspaceGeneration,before.fs);
  assert.equal(bundle.outcomes.migration.toVersion,2);
  assert.equal(bundle.outcomes.update.compatibilityId,'sw-v1');
  assert.equal(bundle.ai,null);
  assert.equal(bundle.telemetry.remoteEnabled,false);
  assert.ok(bundle.diagnostics.summary.usage.terminalEntries>=2);
  assert.ok(bundle.diagnostics.terminalMetadata.length>=2);
  assert.equal(serialized.includes('public-output'),false);
  assert.equal(serialized.includes('public-error'),false);
  assert.equal(bundle.diagnostics.events.some((event)=>event.type==='[custom]'),true);
  assert.equal(bundle.preview.privacy.workspaceContentsIncluded,false);
  assert.equal(bundle.preview.privacy.privateSourceIncluded,false);
  assert.equal(bundle.preview.privacy.httpBodiesIncluded,false);
  assert.equal(bundle.preview.privacy.rawTerminalContentIncluded,false);
  assert.equal(serialized.includes(SECRET),false);
  assert.equal(serialized.includes('private.txt'),false);
  assert.equal(serialized.includes('requestBody'),false);

  const after={
    fs:runtime.fs.generation,
    packages:runtime.packages.generation,
    preview:runtime.preview.epoch,
    diagnostics:runtime.diagnostics.summary().latestSequence
  };
  assert.deepEqual(after,before);
  await runtime.teardown();
});

test('AI content is absent by default and redacted only on explicit opt-in',async()=>{
  const runtime=await OpenContainer.boot();
  const off=runtime.supportBundle(null,{ai:{prompt:SECRET,transcript:SECRET}});
  assert.equal(off.ai,null);
  assert.equal(off.preview.privacy.aiContentIncluded,false);

  const on=runtime.supportBundle(null,{
    includeAi:true,
    ai:{prompt:SECRET,transcript:SECRET,metadata:'visible'}
  });
  const serialized=JSON.stringify(on);
  assert.equal(on.preview.privacy.aiContentIncluded,true);
  assert.equal(on.ai.prompt,'[REDACTED]');
  assert.equal(on.ai.transcript,'[REDACTED]');
  assert.equal(serialized.includes(SECRET),false);
  await runtime.teardown();
});

test('local diagnostic command is deterministic for the same headless reproduction',()=>{
  const run=()=>spawnSync(process.execPath,[
    'scripts/opencontainer-diagnostic.mjs',
    '--simulate-error','OC_INVALID_STATE'
  ],{encoding:'utf8'});
  const first=run();
  const second=run();
  assert.equal(first.status,0,first.stderr);
  assert.equal(second.status,0,second.stderr);
  const a=JSON.parse(first.stdout);
  const b=JSON.parse(second.stdout);
  assert.equal(a.schema,'opencontainer.local-diagnostic.v0.1');
  assert.equal(a.fingerprint,b.fingerprint);
  assert.match(a.fingerprint,/^ocfp:[0-9a-f]{16}$/);
  assert.equal(a.diagnostics.telemetry.remoteEnabled,false);
  assert.equal(a.privacy.workspaceContentsIncluded,false);
  assert.equal(a.browser.browser,false);
});

test('support outcomes preserve schema-approved compatibility identifiers without weakening secret redaction',async()=>{
  const runtime=await OpenContainer.boot();
  const compatibilityId=runtime.productionProfile.browser.serviceWorkerCompatibilityId;
  const secret='this-is-a-long-secret-token-value-abcdefghijklmnopqrstuvwxyz';
  runtime.recordSupportOutcome('update',{
    schema:'opencontainer.service-worker-update.v0.1',
    status:'compatible',
    compatibilityId,
    result:secret,
    privateToken:secret
  });
  const bundle=runtime.supportBundle();
  assert.equal(bundle.outcomes.update.schema,'opencontainer.service-worker-update.v0.1');
  assert.equal(bundle.outcomes.update.compatibilityId,compatibilityId);
  assert.equal(bundle.outcomes.update.result,'[REDACTED]');
  assert.equal(Object.hasOwn(bundle.outcomes.update,'privateToken'),false);
  assert.equal(JSON.stringify(bundle).includes(secret),false);
  await runtime.teardown();
});

test('support outcome surface accepts only recovery migration and update categories',async()=>{
  const runtime=await OpenContainer.boot();
  assert.throws(()=>runtime.recordSupportOutcome('arbitrary',{status:'PASS'}),TypeError);
  runtime.recordSupportOutcome('recovery',{status:'restored',sequence:3,generation:4,private:'ignored'});
  const bundle=runtime.supportBundle();
  assert.equal(bundle.outcomes.recovery.status,'restored');
  assert.equal(bundle.outcomes.recovery.sequence,3);
  assert.equal(bundle.outcomes.recovery.generation,4);
  assert.equal(Object.hasOwn(bundle.outcomes.recovery,'private'),false);
  await runtime.teardown();
});


test('support bundle backward parser normalizes v0.1/v0.2 and rejects unsafe or unknown schemas',()=>{
  assert.deepEqual(SupportBundleSchemas,['opencontainer.support-bundle.v0.1','opencontainer.support-bundle.v0.2']);
  const legacy=parseSupportBundle({
    schema:'opencontainer.support-bundle.v0.1',
    fingerprint:'ocfp:0123456789abcdef',
    profile:{runtimeVersion:'0.0.9-alpha.1'},
    browser:{browser:true},
    privacy:{workspaceContentsIncluded:false,secretsIncluded:false}
  });
  assert.equal(legacy.sourceSchema,'opencontainer.support-bundle.v0.1');
  assert.equal(legacy.runtimeVersion,'0.0.9-alpha.1');
  const current=parseSupportBundle({
    schema:'opencontainer.support-bundle.v0.2',
    fingerprint:'ocfp:fedcba9876543210',
    profile:{runtimeVersion:'0.1.0-alpha.1',profileId:'opencontainer-alpha-chromium-node24-v1'},
    browser:{browser:true,opfs:true},
    privacy:{workspaceContentsIncluded:false,secretsIncluded:false}
  });
  assert.equal(current.profileId,'opencontainer-alpha-chromium-node24-v1');
  assert.throws(()=>parseSupportBundle({schema:'opencontainer.support-bundle.v9.0'}),/Unsupported support bundle schema/);
  assert.throws(()=>parseSupportBundle({
    schema:'opencontainer.support-bundle.v0.2',
    privacy:{workspaceContentsIncluded:true,secretsIncluded:false}
  }),/Unsafe support bundle privacy flags/);
});
