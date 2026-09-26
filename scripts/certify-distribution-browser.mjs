import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const consumer=await mkdtemp(join(tmpdir(),'opencontainer-distribution-browser-'));

try{
  await writeFile(join(consumer,'package.json'),JSON.stringify({name:'opencontainer-distribution-browser-consumer',private:true,type:'module'},null,2)+'\n');
  run(npmCommand,[
    'install',
    '--ignore-scripts',
    '--package-lock=false',
    '--no-audit',
    '--no-fund',
    build.tarballPath
  ],{cwd:consumer});

  const packageRoot=join(consumer,'node_modules','@nolane','opencontainer');
  const result=run(process.execPath,['scripts/browser-acceptance.mjs'],{
    cwd:packageRoot,
    env:{...process.env,OPENCONTAINER_DISTRIBUTION_CERTIFIED:'1'}
  });
  process.stdout.write(result.stdout??'');
  process.stderr.write(result.stderr??'');
  if(!(result.stdout??'').includes('browser acceptance PASS'))throw new Error('packed distribution did not report browser acceptance PASS');

  console.log('distribution browser PASS '+JSON.stringify({
    package:build.package,
    version:build.version,
    bytes:build.bytes,
    sha256:build.sha256,
    sha512:build.sha512,
    source:'installed-tarball'
  }));
}finally{
  await rm(consumer,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
