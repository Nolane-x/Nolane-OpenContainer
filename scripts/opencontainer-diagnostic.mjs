import { OpenContainer } from '../packages/sdk/src/index.js';
import { checkHostingHeaders } from './hosting-self-check-lib.mjs';

function parseArgs(argv){
  const out={url:null,simulateError:null};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--url'){out.url=argv[++i]??null;continue;}
    if(arg==='--simulate-error'){out.simulateError=argv[++i]??'OC_INTERNAL';continue;}
    if(arg==='--help'){
      process.stdout.write('Usage: opencontainer-diagnostic [--url https://origin/] [--simulate-error OC_CODE]\n');
      process.exit(0);
    }
    throw new Error('Unknown argument: '+arg);
  }
  return out;
}

const args=parseArgs(process.argv.slice(2));
const runtime=await OpenContainer.boot({
  diagnostics:{
    limit:128,
    rawBytesLimit:64*1024,
    duplicateLimit:8,
    terminalHistoryLimit:32,
    terminalBytesLimit:16*1024
  }
});

runtime.mount({
  'diagnostic.txt':'deterministic'
});
runtime.registerCommand('diagnostic-echo',({stdout})=>{
  stdout('diagnostic-ok\n');
  return 0;
});
const proc=runtime.spawn('diagnostic-echo');
const exitCode=await proc.exit;

let hostingDiagnostics=null;
if(args.url){
  hostingDiagnostics=await checkHostingHeaders(args.url);
}

const simulated=args.simulateError?Object.assign(
  new Error('simulated diagnostic failure'),
  {code:args.simulateError}
):null;

const preview=runtime.supportBundlePreview({
  error:simulated,
  hostingDiagnostics
});
const bundle=runtime.supportBundle(simulated,{hostingDiagnostics});

const receipt=Object.freeze({
  schema:'opencontainer.local-diagnostic.v0.1',
  exitCode,
  fingerprint:bundle.fingerprint,
  profileId:bundle.profile.profileId,
  runtimeVersion:bundle.profile.runtimeVersion,
  categories:preview.categories,
  browser:bundle.browser,
  hosting:bundle.hosting?Object.freeze({
    ok:bundle.hosting.ok,
    profileId:bundle.hosting.profileId,
    failureCount:bundle.hosting.failures.length
  }):null,
  diagnostics:Object.freeze({
    usage:bundle.diagnostics.summary.usage,
    limits:bundle.diagnostics.summary.limits,
    telemetry:bundle.telemetry
  }),
  privacy:bundle.privacy
});

process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
await runtime.teardown();

if(exitCode!==0||receipt.hosting?.ok===false)process.exitCode=1;
