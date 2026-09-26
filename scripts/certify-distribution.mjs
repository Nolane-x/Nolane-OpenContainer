import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDistribution } from './build-distribution.mjs';

const npmCommand=process.platform==='win32'?'npm.cmd':'npm';

function run(command,args,options={}){
  const result=spawnSync(command,args,{encoding:'utf8',...options});
  if(result.status!==0)throw new Error(command+' '+args.join(' ')+' failed\n'+(result.stdout??'')+'\n'+(result.stderr??''));
  return result;
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
  const exampleResult=run(process.execPath,[join(installedRoot,'examples','sdk-lifecycle.mjs')],{cwd:installedRoot});
  const exampleReceipt=JSON.parse(exampleResult.stdout.trim());
  if(exampleReceipt.exitCode!==0||exampleReceipt.stdout!=='hello opencontainer'||exampleReceipt.previewText!=='preview-ok'){
    throw new Error('installed distribution SDK example failed: '+JSON.stringify(exampleReceipt));
  }
  if(exampleReceipt.restoredSource!=='export const answer = 42;'||exampleReceipt.importedSource!=='export const answer = 42;'){
    throw new Error('installed distribution SDK example persistence drifted: '+JSON.stringify(exampleReceipt));
  }

  console.log(JSON.stringify({
    schema:'opencontainer.distribution-certification.v0.1',
    build,
    consumer:receipt,
    publishedExample:{
      source:'node_modules/@nolane/opencontainer/examples/sdk-lifecycle.mjs',
      receipt:exampleReceipt
    }
  },null,2));
}finally{
  await rm(consumer,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
