import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDistribution } from './build-distribution.mjs';

const npmCommand=process.platform==='win32'?'npm.cmd':'npm';

function run(command,args,options={}){
  const result=spawnSync(command,args,{encoding:'utf8',...options});
  if(result.status!==0)throw new Error(command+' '+args.join(' ')+' failed\n'+(result.stdout??'')+'\n'+(result.stderr??''));
  return result;
}

async function freePort(){
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}

async function waitForPlayground(child){
  let output='';
  const ready=new Promise((resolve,reject)=>{
    child.stdout.on('data',(chunk)=>{
      output+=chunk;
      if(output.includes('OpenContainer playground:'))resolve();
    });
    child.stderr.on('data',(chunk)=>{output+=chunk;});
    child.once('error',reject);
    child.once('exit',(code)=>{
      if(!output.includes('OpenContainer playground:'))reject(new Error('installed playground exited before ready: '+code+' '+output));
    });
  });
  await Promise.race([
    ready,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('installed playground startup timeout: '+output)),5000))
  ]);
}

const build=await buildDistribution();
const consumer=await mkdtemp(join(tmpdir(),'opencontainer-distribution-consumer-'));

try{
  await writeFile(join(consumer,'package.json'),JSON.stringify({name:'opencontainer-distribution-consumer',private:true,type:'module'},null,2)+'\n');
  run(npmCommand,[
    'install',
    '--ignore-scripts',
    '--package-lock=false',
    '--no-audit',
    '--no-fund',
    build.tarballPath
  ],{cwd:consumer});

  const probe=`import { OpenContainer, OpenContainerProductionProfile } from '@nolane/opencontainer';

const runtime=await OpenContainer.boot();
runtime.mount({
  'package.json':'{"name":"distribution-consumer"}',
  'state.txt':'one'
});
runtime.registerCommand('echo',({args,stdout})=>{stdout(args.join(' '));return 0;});
const processHandle=runtime.spawn('echo',['distribution','ok']);
const exitCode=await processHandle.exit;
const route=runtime.listen(3100,()=>new Response('distribution-preview'),{owner:'distribution-cert'});
const previewText=await (await runtime.preview.dispatch(3100,{},route)).text();
const snapshot=runtime.snapshot('distribution-snapshot');
runtime.fs.beginTransaction().writeFile('state.txt','two').commit();
runtime.restore(snapshot);
const exported=runtime.export(snapshot);
const imported=await OpenContainer.boot();
await imported.import(exported);
const resolved=import.meta.resolve('@nolane/opencontainer');
const receipt={
  schema:'opencontainer.distribution-node-certification.v0.1',
  resolved,
  installedArtifact:resolved.includes('/node_modules/@nolane/opencontainer/'),
  runtimeVersion:OpenContainerProductionProfile.runtime.version,
  productionClosed:OpenContainerProductionProfile.productionClosed,
  state:runtime.status().state,
  exitCode,
  stdout:processHandle.stdout.toString(),
  previewText,
  restored:runtime.fs.readFile('state.txt'),
  imported:imported.fs.readFile('state.txt'),
  importedGeneration:imported.fs.generation
};
await imported.teardown();
await runtime.teardown();
console.log(JSON.stringify(receipt));
`;
  const probePath=join(consumer,'probe.mjs');
  await writeFile(probePath,probe);
  const result=run(process.execPath,[probePath],{cwd:consumer});
  const receipt=JSON.parse(result.stdout.trim());
  if(!receipt.installedArtifact)throw new Error('consumer resolved OpenContainer outside installed node_modules artifact');
  if(receipt.runtimeVersion!==build.version)throw new Error('distribution runtime version drifted');
  if(receipt.productionClosed!==false)throw new Error('distribution incorrectly claims production closure');
  if(receipt.state!=='READY'||receipt.exitCode!==0||receipt.stdout!=='distribution ok')throw new Error('distribution SDK/process court failed: '+JSON.stringify(receipt));
  if(receipt.previewText!=='distribution-preview'||receipt.restored!=='one'||receipt.imported!=='one')throw new Error('distribution preview/persistence court failed: '+JSON.stringify(receipt));

  const installedRoot=join(consumer,'node_modules','@nolane','opencontainer');
  const installedManifest=JSON.parse(await readFile(join(installedRoot,'package.json'),'utf8'));
  const installedSdkContract=JSON.parse(await readFile(join(installedRoot,'docs','api','PUBLIC-SDK.v0.1.json'),'utf8'));
  if(JSON.stringify(installedManifest.exports)!==JSON.stringify(installedSdkContract.exportMap)){
    throw new Error('installed package export map drifted from public SDK contract');
  }
  for(const subpath of installedSdkContract.privacyBoundary.noPublicPackageSubpaths){
    if(Object.hasOwn(installedManifest.exports,subpath))throw new Error('installed package exposed forbidden internal subpath '+subpath);
  }

  const exampleResult=run(process.execPath,[join(installedRoot,'examples','sdk-lifecycle.mjs')],{cwd:installedRoot});
  const exampleReceipt=JSON.parse(exampleResult.stdout.trim());
  if(exampleReceipt.exitCode!==0||exampleReceipt.stdout!=='hello opencontainer'||exampleReceipt.previewText!=='preview-ok'){
    throw new Error('installed distribution SDK example failed: '+JSON.stringify(exampleReceipt));
  }
  if(exampleReceipt.restoredSource!=='export const answer = 42;'||exampleReceipt.importedSource!=='export const answer = 42;'){
    throw new Error('installed distribution SDK example persistence drifted: '+JSON.stringify(exampleReceipt));
  }

  const failureExampleResult=run(process.execPath,[join(installedRoot,'examples','sdk-failure-paths.mjs')],{cwd:installedRoot});
  const failureExampleReceipt=JSON.parse(failureExampleResult.stdout.trim());
  const expectedFailureCodes={
    mount:'OC_PATH_ESCAPE',
    spawn:'OC_COMMAND_NOT_FOUND',
    preview:'OC_INVALID_ARGUMENT',
    snapshot:'OC_NOT_FOUND',
    export:'OC_NOT_FOUND',
    teardown:'OC_INVALID_STATE'
  };
  if(JSON.stringify(failureExampleReceipt.codes)!==JSON.stringify(expectedFailureCodes)){
    throw new Error('installed distribution SDK failure example drifted: '+JSON.stringify(failureExampleReceipt));
  }

  const hostingPort=await freePort();
  const hostingChild=spawn(process.execPath,['apps/playground/server.mjs'],{
    cwd:installedRoot,
    env:{...process.env,PORT:String(hostingPort)},
    stdio:['ignore','pipe','pipe']
  });
  let hostingReceipt;
  try{
    await waitForPlayground(hostingChild);
    const hostingResult=run(process.execPath,[
      join(installedRoot,'scripts','hosting-self-check.mjs'),
      'http://127.0.0.1:'+hostingPort+'/'
    ],{cwd:installedRoot});
    hostingReceipt=JSON.parse(hostingResult.stdout.trim());
    if(hostingReceipt.ok!==true||hostingReceipt.failures?.length!==0){
      throw new Error('installed hosting self-check failed: '+JSON.stringify(hostingReceipt));
    }
  }finally{
    hostingChild.kill('SIGTERM');
    await Promise.race([
      once(hostingChild,'exit'),
      new Promise(resolve=>setTimeout(resolve,1000))
    ]);
  }

  console.log(JSON.stringify({
    schema:'opencontainer.distribution-certification.v0.1',
    build,
    consumer:receipt,
    publishedExample:{
      source:'node_modules/@nolane/opencontainer/examples/sdk-lifecycle.mjs',
      receipt:exampleReceipt
    },
    publishedFailureExample:{
      source:'node_modules/@nolane/opencontainer/examples/sdk-failure-paths.mjs',
      receipt:failureExampleReceipt
    },
    installedHostingSelfCheck:{
      source:'node_modules/@nolane/opencontainer/scripts/hosting-self-check.mjs',
      receipt:hostingReceipt
    },
    publicSdkContract:{
      source:'node_modules/@nolane/opencontainer/docs/api/PUBLIC-SDK.v0.1.json',
      exportMap:installedManifest.exports,
      forbiddenInternalSubpaths:installedSdkContract.privacyBoundary.noPublicPackageSubpaths.length
    }
  },null,2));
}finally{
  await rm(consumer,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
