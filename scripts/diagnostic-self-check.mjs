import { OpenContainer } from '../packages/sdk/src/index.js';

const secret='diagnostic-self-check-secret-123456789012345678901234567890';
const runtime=await OpenContainer.boot({
  diagnostics:{limit:32,duplicateLimit:2},
  processOutputLimitBytes:4096
});

runtime.mount({
  'private.txt':secret,
  'package.json':'{"name":"diagnostic-self-check"}'
});
runtime.packages.compile({
  name:'diagnostic-self-check',
  version:'1.0.0',
  lockfileVersion:3,
  packages:{
    '':{name:'diagnostic-self-check',version:'1.0.0'},
    'node_modules/probe-package':{
      name:'probe-package',
      version:'1.0.0',
      integrity:'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
    }
  }
});
runtime.listen(3199,()=>new Response('diagnostic-self-check'),{owner:'diagnostic-self-check'});

for(let index=0;index<8;index++){
  runtime.diagnostics.record('self-check.duplicate',{token:secret,body:secret});
}
runtime.diagnostics.record('self-check.secret-'+secret,{
  authorization:'Bearer '+secret,
  signedUrl:'https://example.invalid/file?signature='+secret,
  source:'export const privateValue="'+secret+'"'
});

let stableError=null;
try{
  runtime.spawn('missing-diagnostic-command');
}catch(error){
  stableError=error;
}

const generationBefore=runtime.fs.generation;
const preview=runtime.supportBundlePreview();
const bundle=runtime.supportBundle(stableError,{
  aiContent:{prompt:'hidden '+secret,transcript:secret}
});
const serialized=JSON.stringify(bundle);

const checks={
  errorCode:bundle.error?.code==='OC_COMMAND_NOT_FOUND',
  fingerprint:/^ocfp-v1-[0-9a-f]{16}$/.test(bundle.fingerprint?.id??''),
  previewListsCategories:preview.categories.length>=8,
  aiExcluded:bundle.ai?.included===false,
  noSecretLeak:!serialized.includes(secret),
  noWorkspaceLeak:!serialized.includes('private.txt'),
  noSourceLeak:bundle.privacy?.privateSourceIncluded===false,
  noDiagnosticDetails:bundle.privacy?.diagnosticDetailsIncluded===false,
  zeroRemoteAnalytics:bundle.telemetry?.remoteAnalytics===false&&bundle.telemetry?.networkEmission===false,
  duplicateBounded:(bundle.diagnosticBounds?.suppressedDuplicates??0)>=6,
  terminalBounded:bundle.terminalBounds?.stdoutHistoryBytes===4096&&bundle.terminalBounds?.stderrHistoryBytes===4096,
  readOnlyGeneration:runtime.fs.generation===generationBefore
};

const receipt={
  schema:'opencontainer.diagnostic-self-check.v0.1',
  ok:Object.values(checks).every(Boolean),
  fingerprint:bundle.fingerprint?.id??null,
  profileId:bundle.profile?.profileId??null,
  runtimeVersion:bundle.profile?.runtimeVersion??null,
  errorCode:bundle.error?.code??null,
  diagnosticBounds:bundle.diagnosticBounds,
  terminalBounds:bundle.terminalBounds,
  privacy:bundle.privacy,
  telemetry:bundle.telemetry,
  checks
};

await runtime.teardown();
console.log(JSON.stringify(receipt,null,2));
if(!receipt.ok)process.exitCode=1;
