import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDistribution } from './build-distribution.mjs';

const PACKAGE='@nolane/opencontainer';
const REPO='Nolane-x/Nolane-OpenContainer';

function run(command,args,options={}){
  const result=spawnSync(command,args,{encoding:'utf8',...options});
  if(result.status!==0){
    const error=new Error(command+' '+args.join(' ')+' failed\n'+String(result.stdout??'')+'\n'+String(result.stderr??''));
    error.status=result.status;
    throw error;
  }
  return String(result.stdout??'').trim();
}
function hash(bytes,algorithm){return createHash(algorithm).update(bytes).digest('hex');}
function sriSha512(bytes){return 'sha512-'+createHash('sha512').update(bytes).digest('base64');}
function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
function prereleaseLabel(version){const m=String(version).match(/^[0-9]+\.[0-9]+\.[0-9]+-([0-9A-Za-z-]+)(?:\.|$)/);return m?.[1]??null;}
export function validateExternalReleaseRequest({version,tag,channel,assetName,signerWorkflow}){
  const errors=[];
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version??'')))errors.push('version must be semver-like');
  if(!/^v[^\s]+$/.test(String(tag??'')))errors.push('tag must start with v');
  if(!['canary','beta','rc'].includes(channel))errors.push('channel must be canary, beta or rc');
  if(tag&&version&&tag!=='v'+version)errors.push('tag must equal v'+version);
  const label=prereleaseLabel(version);
  if(channel==='beta'&&label!=='beta')errors.push('beta channel requires beta prerelease label');
  if(channel==='rc'&&label!=='rc')errors.push('rc channel requires rc prerelease label');
  if(!String(assetName??'').endsWith('.tgz'))errors.push('release asset must be .tgz');
  if(!/^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/.test(String(signerWorkflow??'')))errors.push('signer workflow path invalid');
  return errors;
}
async function githubJson(path,token){
  const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetch('https://api.github.com/repos/'+REPO+path,{headers});
  if(!response.ok)throw new Error('GitHub API '+path+' failed '+response.status+' '+await response.text());
  return response.json();
}
async function resolveTagCommit(tag,token){
  let ref=await githubJson('/git/ref/tags/'+encodeURIComponent(tag),token);
  let object=ref.object;
  for(let depth=0;depth<4&&object?.type==='tag';depth++){
    const tagObject=await githubJson('/git/tags/'+object.sha,token);
    object=tagObject.object;
  }
  if(object?.type!=='commit'||!/^[0-9a-f]{40}$/i.test(object?.sha??''))throw new Error('tag does not resolve to a commit');
  return object.sha;
}
async function download(url,token){
  const headers={};
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetch(url,{headers,redirect:'follow'});
  if(!response.ok)throw new Error('download failed '+response.status+' '+url);
  return Buffer.from(await response.arrayBuffer());
}
async function installAndExercise(tarballPath){
  const consumer=await mkdtemp(join(tmpdir(),'opencontainer-external-release-'));
  try{
    await writeFile(join(consumer,'package.json'),JSON.stringify({name:'opencontainer-external-release-consumer',private:true,type:'module'},null,2)+'\n');
    run(process.platform==='win32'?'npm.cmd':'npm',[
      'install','--ignore-scripts','--package-lock=true','--no-audit','--no-fund',tarballPath
    ],{cwd:consumer});
    const root=join(consumer,'node_modules','@nolane','opencontainer');
    const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
    const lifecycle=JSON.parse(run(process.execPath,[join(root,'examples','sdk-lifecycle.mjs')],{cwd:root}));
    const failures=JSON.parse(run(process.execPath,[join(root,'examples','sdk-failure-paths.mjs')],{cwd:root}));
    const browser=run(process.execPath,['scripts/browser-acceptance.mjs'],{
      cwd:root,
      env:{...process.env,OPENCONTAINER_DISTRIBUTION_CERTIFIED:'1'}
    });
    if(!browser.includes('browser acceptance PASS'))throw new Error('external registry artifact browser product path did not PASS');
    if(lifecycle.exitCode!==0||lifecycle.stdout!=='hello opencontainer'||lifecycle.previewText!=='preview-ok')throw new Error('published lifecycle example failed');
    const expected={mount:'OC_PATH_ESCAPE',spawn:'OC_COMMAND_NOT_FOUND',preview:'OC_INVALID_ARGUMENT',snapshot:'OC_NOT_FOUND',export:'OC_NOT_FOUND',teardown:'OC_INVALID_STATE'};
    if(JSON.stringify(failures.codes)!==JSON.stringify(expected))throw new Error('published failure-path example drifted');
    run(process.platform==='win32'?'npm.cmd':'npm',['audit','signatures'],{cwd:consumer});
    return {
      package:manifest.name,
      version:manifest.version,
      license:manifest.license??null,
      lifecycleExample:true,
      failureExample:true,
      browserProductPath:true,
      npmAuditSignatures:true
    };
  }finally{
    await rm(consumer,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
}
export function candidateGateState({channel,allPublicationChecksPass}){
  const ready=allPublicationChecksPass?'READY_FOR_REVIEW':'BLOCKED_EXTERNAL_RELEASE_VERIFICATION';
  return {
    'P11-12':ready,
    'P13-03':'BLOCKED_TRUSTED_PUBLISHER_CONFIGURATION_CERTIFICATION',
    'P13-04':ready,
    'P13-07':ready,
    'P13-09':ready,
    'P13-10':ready,
    'P13-16':channel==='canary'?ready:'BLOCKED_REQUIRES_CANARY_REGISTRY_PUBLICATION',
    'P15-12':ready,
    'P1-14':channel==='rc'?ready:'BLOCKED_REQUIRES_RC_MATRIX',
    'P13-17':'BLOCKED_REPOSITORY_PROTECTION_CERTIFICATION',
    'P14-04':'BLOCKED_ADJACENT_REAL_RELEASE_COURT',
    'P14-12':'BLOCKED_PUBLIC_CDN_TOPOLOGY'
  };
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const version=args.version;
  const tag=args.tag;
  const channel=args.channel;
  const assetName=args.asset??('nolane-opencontainer-'+version+'.tgz');
  const signerWorkflow=args['signer-workflow']??'.github/workflows/publish.yml';
  const output=resolve(args.output??'.artifacts/external-release/receipt.json');
  const requestErrors=validateExternalReleaseRequest({version,tag,channel,assetName,signerWorkflow});
  if(requestErrors.length)throw new Error('invalid external-release request: '+requestErrors.join('; '));

  const localCommit=run('git',['rev-parse','HEAD']);
  const sourceManifest=JSON.parse(await readFile(resolve('package.json'),'utf8'));
  if(sourceManifest.version!==version)throw new Error('checked-out source version '+sourceManifest.version+' != requested '+version);

  const token=process.env.GITHUB_TOKEN??null;
  const tagCommit=await resolveTagCommit(tag,token);
  if(tagCommit!==localCommit)throw new Error('immutable tag target '+tagCommit+' != checked-out commit '+localCommit);

  const release=await githubJson('/releases/tags/'+encodeURIComponent(tag),token);
  if(release.draft===true)throw new Error('GitHub release is still draft');
  if(release.tag_name!==tag)throw new Error('GitHub release tag drift');
  if(channel!=='canary'&&release.prerelease!==true)throw new Error('beta/rc release must be marked prerelease');
  const asset=release.assets?.find(x=>x.name===assetName);
  if(!asset)throw new Error('GitHub release missing expected asset '+assetName);

  const externalDir=resolve('.artifacts/external-release/npm');
  await mkdir(externalDir,{recursive:true});
  const packJson=JSON.parse(run(process.platform==='win32'?'npm.cmd':'npm',[
    'pack',PACKAGE+'@'+version,'--json','--pack-destination',externalDir
  ]));
  const packed=packJson?.[0];
  if(!packed?.filename)throw new Error('npm pack did not return registry artifact filename');
  const npmTarballPath=join(externalDir,packed.filename);
  const npmBytes=await readFile(npmTarballPath);
  const npmSha256=hash(npmBytes,'sha256');
  const npmSha512=hash(npmBytes,'sha512');

  const registryMeta=JSON.parse(run(process.platform==='win32'?'npm.cmd':'npm',['view',PACKAGE+'@'+version,'--json']));
  const distTags=JSON.parse(run(process.platform==='win32'?'npm.cmd':'npm',['view',PACKAGE,'dist-tags','--json']));
  if(registryMeta.name!==PACKAGE||registryMeta.version!==version)throw new Error('npm registry identity drift');
  if(distTags[channel]!==version)throw new Error('npm dist-tag '+channel+' does not point to '+version);
  if(registryMeta.dist?.integrity&&registryMeta.dist.integrity!==sriSha512(npmBytes))throw new Error('npm registry integrity does not match downloaded tarball');
  if(registryMeta.dist?.shasum&&registryMeta.dist.shasum!==hash(npmBytes,'sha1'))throw new Error('npm registry shasum does not match downloaded tarball');

  const localDir=resolve('.artifacts/external-release/local');
  const localBuild=await buildDistribution({outputDir:localDir});
  if(localBuild.version!==version)throw new Error('local deterministic build version drift');
  if(localBuild.sha256!==npmSha256||localBuild.sha512!==npmSha512)throw new Error('published npm artifact is not byte-identical to deterministic tagged build');

  const ghBytes=await download(asset.browser_download_url,token);
  const ghSha256=hash(ghBytes,'sha256');
  if(ghSha256!==npmSha256)throw new Error('GitHub Release asset is not byte-identical to npm artifact');
  const ghAssetPath=resolve('.artifacts/external-release',assetName);
  await mkdir(dirname(ghAssetPath),{recursive:true});
  await writeFile(ghAssetPath,ghBytes);

  const releaseVerify=JSON.parse(run('gh',['release','verify-asset',tag,ghAssetPath,'-R',REPO,'--format','json'],{env:{...process.env,GH_TOKEN:token??process.env.GH_TOKEN}}));
  const attestationVerify=JSON.parse(run('gh',[
    'attestation','verify',ghAssetPath,'-R',REPO,'--source-ref','refs/tags/'+tag,
    '--source-digest',localCommit,'--signer-workflow',REPO+'/'+signerWorkflow,'--format','json'
  ],{env:{...process.env,GH_TOKEN:token??process.env.GH_TOKEN}}));
  if(!Array.isArray(attestationVerify)||attestationVerify.length<1)throw new Error('no verified GitHub artifact attestation found');

  const exercise=await installAndExercise(npmTarballPath);
  if(exercise.package!==PACKAGE||exercise.version!==version)throw new Error('clean-installed registry package identity drift');

  const allPublicationChecksPass=true;
  const receipt={
    schema:'opencontainer.external-release-verification.v1.0',
    status:'PASS',
    repository:REPO,
    package:PACKAGE,
    version,tag,channel,
    source:{commit:localCommit,tagCommit},
    registry:{
      distTag:channel,
      distTagVersion:distTags[channel],
      tarball:registryMeta.dist?.tarball??null,
      integrity:registryMeta.dist?.integrity??null,
      shasum:registryMeta.dist?.shasum??null,
      sha256:npmSha256,
      sha512:npmSha512,
      signatureAudit:true
    },
    githubRelease:{
      id:release.id,
      tag:release.tag_name,
      prerelease:release.prerelease,
      draft:release.draft,
      assetId:asset.id,
      assetName:asset.name,
      assetSha256:ghSha256,
      releaseAttestationVerified:Boolean(releaseVerify),
      artifactAttestationsVerified:attestationVerify.length,
      signerWorkflow
    },
    deterministicBuild:{
      localSha256:localBuild.sha256,
      localSha512:localBuild.sha512,
      byteIdenticalToRegistry:true,
      byteIdenticalToGitHubRelease:true
    },
    cleanInstall:exercise,
    candidateGateState:candidateGateState({channel,allPublicationChecksPass}),
    closureEligible:false,
    closureReason:'External publication verification produces reviewable evidence only. Ledger promotion remains a separate reviewed reconciliation; P13-03, P13-17, P14-04 and P14-12 require independent external state/courts.',
    productionClosed:false
  };
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
  console.log('EXTERNAL RELEASE VERIFICATION PASS '+JSON.stringify({
    version,tag,channel,sha256:npmSha256,
    verifiedGitHubAttestations:attestationVerify.length,
    closureEligible:false
  }));
}

const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
