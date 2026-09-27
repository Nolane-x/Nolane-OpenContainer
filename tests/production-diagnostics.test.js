import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DiagnosticJournal,
  SupportBundleAuthority,
  browserCapabilityProbe,
  diagnosticFingerprint,
  redact
} from '../packages/diagnostics/src/index.js';
import { OpenContainer } from '../packages/sdk/src/index.js';

const SECRET='sentinel-secret-value-abcdefghijklmnopqrstuvwxyz-0123456789';

test('diagnostic journal bounds raw bytes duplicates and terminal history independently',()=>{
  const journal=new DiagnosticJournal({
    limit:10,
    rawBytesLimit:1100,
    duplicateLimit:2,
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
        resolved:'https://registry.example.test/dep.tgz?token='+SECRET
      }
    }
  });
  runtime.listen(4123,()=>new Response('ok'),{owner:'support-fixture'});
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
  assert.equal(bundle.storage.workspaceGeneration,before.fs);
  assert.equal(bundle.outcomes.migration.toVersion,2);
  assert.equal(bundle.outcomes.update.compatibilityId,'sw-v1');
  assert.equal(bundle.ai,null);
  assert.equal(bundle.telemetry.remoteEnabled,false);
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
