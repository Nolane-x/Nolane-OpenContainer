import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDistribution } from './build-distribution.mjs';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const npmCommand=process.platform==='win32'?'npm.cmd':'npm';

function run(command,args,options={}){
  const result=spawnSync(command,args,{cwd:repoRoot,encoding:'utf8',...options});
  if(result.status!==0)throw new Error(command+' '+args.join(' ')+' failed\n'+(result.stdout??'')+'\n'+(result.stderr??''));
  return (result.stdout??'').trim();
}

function digestBytes(bytes,algorithm){
  return createHash(algorithm).update(bytes).digest('hex');
}

async function digestFile(path,algorithm='sha256'){
  return digestBytes(await readFile(path),algorithm);
}

function isoNow(){
  return new Date().toISOString();
}

function spdxIdForPath(path){
  return 'SPDXRef-Package-'+createHash('sha256').update(path).digest('hex').slice(0,20);
}

function packageNameFromLocation(location,meta){
  if(meta?.name)return meta.name;
  const marker='node_modules/';
  const index=location.lastIndexOf(marker);
  return index>=0?location.slice(index+marker.length):location;
}

function packagePurl(name,version){
  if(!name||!version)return null;
  return 'pkg:npm/'+encodeURIComponent(name)+'@'+encodeURIComponent(version);
}

function normalizedLicense(value){
  return typeof value==='string'&&value.trim()?value.trim():'NOASSERTION';
}

function buildSpdx({artifact,installLock,installedManifest,sourceCommit}){
  const created=isoNow();
  const packages=[{
    SPDXID:'SPDXRef-Package-OpenContainer',
    name:installedManifest.name,
    versionInfo:installedManifest.version,
    downloadLocation:'NOASSERTION',
    filesAnalyzed:false,
    licenseConcluded:normalizedLicense(installedManifest.license),
    licenseDeclared:normalizedLicense(installedManifest.license),
    copyrightText:'NOASSERTION',
    checksums:[
      {algorithm:'SHA256',checksumValue:artifact.sha256},
      {algorithm:'SHA512',checksumValue:artifact.sha512}
    ],
    externalRefs:[{
      referenceCategory:'PACKAGE-MANAGER',
      referenceType:'purl',
      referenceLocator:packagePurl(installedManifest.name,installedManifest.version)
    }]
  }];
  const locationToId=new Map();
  const componentRows=[];

  for(const [location,meta] of Object.entries(installLock.packages??{})){
    if(!location.startsWith('node_modules/')||!meta?.version)continue;
    const name=packageNameFromLocation(location,meta);
    const id=spdxIdForPath(location);
    locationToId.set(location,id);
    const purl=packagePurl(name,meta.version);
    const item={
      SPDXID:id,
      name,
      versionInfo:meta.version,
      downloadLocation:typeof meta.resolved==='string'?meta.resolved:'NOASSERTION',
      filesAnalyzed:false,
      licenseConcluded:normalizedLicense(meta.license),
      licenseDeclared:normalizedLicense(meta.license),
      copyrightText:'NOASSERTION'
    };
    if(typeof meta.integrity==='string'){
      item.externalRefs=[{
        referenceCategory:'PACKAGE-MANAGER',
        referenceType:'purl',
        referenceLocator:purl
      }];
    }else if(purl){
      item.externalRefs=[{
        referenceCategory:'PACKAGE-MANAGER',
        referenceType:'purl',
        referenceLocator:purl
      }];
    }
    packages.push(item);
    componentRows.push({location,name,version:meta.version,license:normalizedLicense(meta.license),resolved:meta.resolved??null,integrity:meta.integrity??null});
  }

  const relationships=[{
    spdxElementId:'SPDXRef-DOCUMENT',
    relationshipType:'DESCRIBES',
    relatedSpdxElement:'SPDXRef-Package-OpenContainer'
  }];
  for(const name of Object.keys(installedManifest.dependencies??{})){
    const location='node_modules/'+name;
    const id=locationToId.get(location);
    if(id)relationships.push({
      spdxElementId:'SPDXRef-Package-OpenContainer',
      relationshipType:'DEPENDS_ON',
      relatedSpdxElement:id
    });
  }

  return {
    document:{
      spdxVersion:'SPDX-2.3',
      dataLicense:'CC0-1.0',
      SPDXID:'SPDXRef-DOCUMENT',
      name:'OpenContainer '+installedManifest.version+' release artifact SBOM',
      documentNamespace:'https://github.com/Nolane-x/Nolane-OpenContainer/sbom/'+sourceCommit+'/'+artifact.sha256,
      creationInfo:{
        created,
        creators:['Tool: OpenContainer release-evidence v0.1']
      },
      packages,
      relationships
    },
    components:componentRows
  };
}

function buildProvenance({artifact,sourceCommit,sourceLockSha256,nodeVersion,npmVersion,runId}){
  const now=isoNow();
  return {
    _type:'https://in-toto.io/Statement/v1',
    subject:[{
      name:artifact.filename,
      digest:{sha256:artifact.sha256,sha512:artifact.sha512}
    }],
    predicateType:'https://slsa.dev/provenance/v1',
    predicate:{
      buildDefinition:{
        buildType:'https://github.com/Nolane-x/Nolane-OpenContainer/.github/workflows/ci.yml#distribution-v1',
        externalParameters:{
          package:'@nolane/opencontainer',
          version:artifact.version,
          distributionProfile:'publish-equivalent-npm-tarball'
        },
        internalParameters:{
          node:nodeVersion,
          npm:npmVersion,
          platform:process.platform,
          arch:process.arch
        },
        resolvedDependencies:[
          {
            uri:'git+https://github.com/Nolane-x/Nolane-OpenContainer.git@'+sourceCommit,
            digest:{gitCommit:sourceCommit}
          },
          {
            uri:'file:package-lock.json',
            digest:{sha256:sourceLockSha256}
          }
        ]
      },
      runDetails:{
        builder:{
          id:process.env.GITHUB_ACTIONS==='true'
            ? 'https://github.com/Nolane-x/Nolane-OpenContainer/actions'
            : 'urn:opencontainer:local-release-evidence-builder'
        },
        metadata:{
          invocationId:runId,
          startedOn:now,
          finishedOn:now
        }
      }
    }
  };
}

export async function buildReleaseEvidence({outputDir=join(repoRoot,'.artifacts','release')}={}){
  const output=resolve(outputDir);
  const reproA=join(repoRoot,'.artifacts','repro-a');
  const reproB=join(repoRoot,'.artifacts','repro-b');
  await rm(output,{recursive:true,force:true});
  await rm(reproA,{recursive:true,force:true});
  await rm(reproB,{recursive:true,force:true});
  await mkdir(output,{recursive:true});

  const sourceCommit=run('git',['rev-parse','HEAD']);
  const trackedStatus=run('git',['status','--porcelain','--untracked-files=no']);
  if(trackedStatus)throw new Error('release evidence requires clean tracked source tree: '+trackedStatus);
  const nodeVersion=process.version;
  const npmVersion=run(npmCommand,['--version']);
  const sourceLockPath=join(repoRoot,'package-lock.json');
  const sourceLockSha256=await digestFile(sourceLockPath,'sha256');

  const first=await buildDistribution({outputDir:reproA});
  const second=await buildDistribution({outputDir:reproB});
  const reproducible=first.sha256===second.sha256&&first.sha512===second.sha512&&first.bytes===second.bytes;
  const reproducibility={
    schema:'opencontainer.reproducibility.v0.1',
    reproducible,
    first:{sha256:first.sha256,sha512:first.sha512,bytes:first.bytes},
    second:{sha256:second.sha256,sha512:second.sha512,bytes:second.bytes}
  };
  if(!reproducible)throw new Error('distribution artifact is not reproducible: '+JSON.stringify(reproducibility));

  const artifactPath=join(output,first.filename);
  await copyFile(first.tarballPath,artifactPath);
  const artifact={...first,tarballPath:artifactPath};

  const consumer=await mkdtemp(join(tmpdir(),'opencontainer-release-sbom-'));
  let installLock;
  let installedManifest;
  try{
    await writeFile(join(consumer,'package.json'),JSON.stringify({name:'opencontainer-release-sbom-consumer',private:true,version:'0.0.0'},null,2)+'\n');
    run(npmCommand,['install','--ignore-scripts','--no-audit','--no-fund',artifactPath],{cwd:consumer});
    installLock=JSON.parse(await readFile(join(consumer,'package-lock.json'),'utf8'));
    installedManifest=JSON.parse(await readFile(join(consumer,'node_modules','@nolane','opencontainer','package.json'),'utf8'));
  }finally{
    await rm(consumer,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }

  const {document:spdx,components}=buildSpdx({artifact,installLock,installedManifest,sourceCommit});
  const sourceManifest=JSON.parse(await readFile(join(repoRoot,'package.json'),'utf8'));
  const directRuntime=Object.entries(installedManifest.dependencies??{}).map(([name,version])=>({name,version})).sort((a,b)=>a.name.localeCompare(b.name));
  const sourceDevTestOnly=Object.entries(sourceManifest.devDependencies??{})
    .filter(([name])=>!(name in (installedManifest.dependencies??{})))
    .map(([name,version])=>({name,version}))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const inventory={
    schema:'opencontainer.dependency-license-inventory.v0.1',
    root:{name:installedManifest.name,version:installedManifest.version,license:normalizedLicense(installedManifest.license)},
    categories:{
      runtimeDirect:directRuntime,
      runtimeTransitive:components,
      optionalAdapters:[],
      sourceDevTestOnly
    },
    note:'UNLICENSED root status is intentional evidence that project-level license closure remains open.'
  };

  const provenance=buildProvenance({
    artifact,
    sourceCommit,
    sourceLockSha256,
    nodeVersion,
    npmVersion,
    runId:process.env.GITHUB_RUN_ID
      ? 'github-actions:'+process.env.GITHUB_RUN_ID+':'+(process.env.GITHUB_RUN_ATTEMPT??'1')
      : 'local:'+randomUUID()
  });

  const checksums=[
    artifact.sha256+'  '+artifact.filename,
    artifact.sha512+'  '+artifact.filename
  ].join('\n')+'\n';

  const releaseManifest={
    schema:'opencontainer.release-evidence.v0.1',
    artifact:{
      filename:artifact.filename,
      bytes:artifact.bytes,
      fileCount:artifact.fileCount,
      unpackedSize:artifact.unpackedSize,
      sha256:artifact.sha256,
      sha512:artifact.sha512,
      contentPolicy:artifact.contentPolicy
    },
    source:{
      repository:'https://github.com/Nolane-x/Nolane-OpenContainer',
      commit:sourceCommit,
      packageLockSha256:sourceLockSha256,
      cleanTrackedTree:true
    },
    environment:{
      node:nodeVersion,
      npm:npmVersion,
      platform:process.platform,
      arch:process.arch
    },
    reproducibility,
    evidenceFiles:[
      'checksums.txt',
      'opencontainer.spdx.json',
      'provenance.intoto.json',
      'dependency-license-inventory.json',
      'reproducibility.json'
    ],
    productionClosed:false
  };

  await Promise.all([
    writeFile(join(output,'checksums.txt'),checksums),
    writeFile(join(output,'opencontainer.spdx.json'),JSON.stringify(spdx,null,2)+'\n'),
    writeFile(join(output,'provenance.intoto.json'),JSON.stringify(provenance,null,2)+'\n'),
    writeFile(join(output,'dependency-license-inventory.json'),JSON.stringify(inventory,null,2)+'\n'),
    writeFile(join(output,'reproducibility.json'),JSON.stringify(reproducibility,null,2)+'\n'),
    writeFile(join(output,'release-manifest.json'),JSON.stringify(releaseManifest,null,2)+'\n')
  ]);

  return releaseManifest;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  console.log(JSON.stringify(await buildReleaseEvidence(),null,2));
}
