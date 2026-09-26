import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const npmCommand=process.platform==='win32'?'npm.cmd':'npm';

async function copyInto(stage,source,destination=source){
  const from=join(repoRoot,source);
  const to=join(stage,destination);
  await mkdir(dirname(to),{recursive:true});
  await cp(from,to,{recursive:true});
}

function hash(bytes,algorithm){
  return createHash(algorithm).update(bytes).digest('hex');
}

export async function buildDistribution({outputDir=join(repoRoot,'.artifacts','distribution')}={}){
  const stageParent=await mkdtemp(join(tmpdir(),'opencontainer-distribution-stage-'));
  const stage=join(stageParent,'package');
  const output=resolve(outputDir);
  await mkdir(stage,{recursive:true});
  await mkdir(output,{recursive:true});

  const sourceManifest=JSON.parse(await readFile(join(repoRoot,'package.json'),'utf8'));
  const packageManifest={
    name:'@nolane/opencontainer',
    version:sourceManifest.version,
    description:sourceManifest.description,
    type:'module',
    license:'UNLICENSED',
    engines:{...sourceManifest.engines},
    exports:{
      '.':'./packages/sdk/src/index.js',
      './profile':'./packages/sdk/src/profile.js',
      './package.json':'./package.json'
    },
    bin:{
      'opencontainer-hosting-self-check':'./scripts/hosting-self-check.mjs'
    },
    scripts:{
      'browser:acceptance':'node scripts/browser-acceptance.mjs',
      'hosting:self-check':'node scripts/hosting-self-check.mjs'
    },
    dependencies:{
      '@emnapi/core':'2.0.0-alpha.5',
      '@emnapi/runtime':'2.0.0-alpha.5',
      '@napi-rs/wasm-runtime':'1.2.4',
      'es-module-lexer':'3.0.2',
      'lightningcss':'npm:lightningcss-wasm@1.33.0',
      'rolldown':'1.2.9',
      'vite':'8.3.0'
    },
    files:[
      'packages',
      'apps/playground',
      'toolchain',
      'compat',
      'docs/production',
      'docs/compatibility',
      'docs/guides',
      'examples',
      'scripts/browser-acceptance.mjs',
      'scripts/hosting-self-check.mjs',
      'scripts/hosting-self-check-lib.mjs',
      'fixtures/source-package-lock.json',
      'README.md'
    ],
    repository:{
      type:'git',
      url:'https://github.com/Nolane-x/Nolane-OpenContainer.git'
    }
  };

  const copies=[
    'packages',
    'apps/playground',
    'toolchain',
    'compat',
    'docs/production',
    'docs/compatibility',
    'docs/guides',
    'examples',
    'README.md',
    'scripts/browser-acceptance.mjs',
    'scripts/hosting-self-check.mjs',
    'scripts/hosting-self-check-lib.mjs'
  ];
  for(const path of copies)await copyInto(stage,path);
  await copyInto(stage,'package-lock.json','fixtures/source-package-lock.json');
  await writeFile(join(stage,'package.json'),JSON.stringify(packageManifest,null,2)+'\n');

  const result=spawnSync(npmCommand,['pack','--json','--pack-destination',output],{
    cwd:stage,
    encoding:'utf8',
    env:{...process.env,npm_config_audit:'false',npm_config_fund:'false'}
  });
  if(result.status!==0)throw new Error('npm pack failed\n'+(result.stdout??'')+'\n'+(result.stderr??''));

  let packed;
  try{packed=JSON.parse(result.stdout);}
  catch(error){throw new Error('npm pack did not return JSON: '+error.message+'\n'+result.stdout);}
  const receipt=packed?.[0];
  if(!receipt?.filename)throw new Error('npm pack returned no filename: '+result.stdout);
  const tarballPath=join(output,receipt.filename);
  const bytes=await readFile(tarballPath);
  const required=[
    'package/packages/sdk/src/index.js',
    'package/packages/sdk/src/profile.js',
    'package/apps/playground/server.mjs',
    'package/apps/playground/public/browser-acceptance.js',
    'package/scripts/browser-acceptance.mjs',
    'package/toolchain/vendor/lightningcss-wasm-1.33.0.tgz',
    'package/toolchain/vendor/rolldown-browser-1.2.9.tgz',
    'package/fixtures/source-package-lock.json',
    'package/docs/production/PRODUCTION-PROFILE.json'
  ];
  const packedFiles=new Set((receipt.files??[]).map((item)=>'package/'+item.path.replace(/^package\//,'')));
  const missing=required.filter((path)=>!packedFiles.has(path));
  if(missing.length)throw new Error('distribution tarball missing required files: '+missing.join(', '));

  const outputReceipt=Object.freeze({
    schema:'opencontainer.distribution-build.v0.1',
    package:packageManifest.name,
    version:packageManifest.version,
    tarballPath,
    filename:receipt.filename,
    bytes:bytes.byteLength,
    sha256:hash(bytes,'sha256'),
    sha512:hash(bytes,'sha512'),
    fileCount:receipt.entryCount??receipt.files?.length??null,
    unpackedSize:receipt.unpackedSize??null
  });

  await rm(stageParent,{recursive:true,force:true});
  return outputReceipt;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const receipt=await buildDistribution();
  console.log(JSON.stringify(receipt,null,2));
}
