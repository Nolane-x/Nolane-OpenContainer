import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PackageGraphAuthority } from '../packages/package-env/src/index.js';

const here=fileURLToPath(new URL('.',import.meta.url));
const root=resolve(here,'..');
const corpusPath=resolve(root,'compat/REAL-REPOSITORY-CORPUS.v0.1.json');
const adaptersPath=resolve(root,'compat/ADAPTER-SUBSTITUTIONS.v0.1.json');
const baselinePath=resolve(root,'docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json');

export async function loadCompatibilitySources(){
  const [corpusText,adaptersText]=await Promise.all([
    readFile(corpusPath,'utf8'),
    readFile(adaptersPath,'utf8')
  ]);
  return {corpus:JSON.parse(corpusText),adapters:JSON.parse(adaptersText)};
}

export function gitBlobSha(bytes){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const header=Buffer.from('blob '+data.byteLength+'\0');
  return createHash('sha1').update(header).update(data).digest('hex');
}

export function validateCompatibilitySources(corpus,adapters){
  const errors=[];
  const ids=new Set();
  const repos=new Set();
  const caseClasses=new Set();
  const strata=new Set();
  const allowedSemantics=new Set(adapters?.semantics??[]);

  if(corpus?.schema!=='opencontainer.compatibility-corpus.v0.1')errors.push('invalid corpus schema');
  if(adapters?.schema!=='opencontainer.compatibility-adapters.v0.1')errors.push('invalid adapter schema');
  if(!Array.isArray(corpus?.cases)||corpus.cases.length<8)errors.push('corpus must retain at least 8 real repository cases');
  if(JSON.stringify(corpus?.axes)!==JSON.stringify(['fs','module','process','http','package','watch']))errors.push('compatibility axes drifted');

  for(const entry of corpus?.cases??[]){
    if(!entry.id||ids.has(entry.id))errors.push('duplicate/missing case id '+entry.id);
    ids.add(entry.id);
    if(!entry.repository||repos.has(entry.repository))errors.push('duplicate/missing repository '+entry.repository);
    repos.add(entry.repository);
    if(!/^[0-9a-f]{40}$/.test(entry.commit??''))errors.push(entry.id+': commit must be a 40-hex SHA');
    if(!entry.license?.path||!/^[0-9a-f]{40}$/.test(entry.license?.blobSha??''))errors.push(entry.id+': license must be pinned by Git blob SHA');
    for(const value of entry.classes??[])caseClasses.add(value);
    for(const value of entry.strata??[])strata.add(value);
    if(entry.lockfile){
      if(!entry.lockfile.path||!/^[0-9a-f]{40}$/.test(entry.lockfile.blobSha??''))errors.push(entry.id+': lockfile must be pinned by Git blob SHA');
      if(!['supported','unsupported','not-root-authority'].includes(entry.lockfile.runtimeParser))errors.push(entry.id+': invalid runtimeParser');
    }
    for(const source of entry.pinnedSources??[]){
      if(!source.path||!/^[0-9a-f]{40}$/.test(source.blobSha??''))errors.push(entry.id+': pinned source must include Git blob SHA');
    }
    if(!Array.isArray(entry.expectedBoundaries)||entry.expectedBoundaries.length===0)errors.push(entry.id+': expected boundaries must remain explicit');
  }

  for(const required of corpus?.requiredCaseClasses??[]){
    if(!caseClasses.has(required))errors.push('missing required case class '+required);
  }
  for(const required of corpus?.requiredPackageStrata??[]){
    if(!strata.has(required))errors.push('missing required package stratum '+required);
  }

  if(!(corpus?.cases??[]).some(entry=>(entry.expectedBoundaries??[]).some(value=>/UNSUPPORTED/.test(value))))errors.push('unsupported classes must remain measurable in corpus');

  const adapterNames=new Set();
  for(const adapter of adapters?.adapters??[]){
    if(!adapter.surface||adapterNames.has(adapter.surface))errors.push('duplicate/missing adapter surface '+adapter.surface);
    adapterNames.add(adapter.surface);
    if(!allowedSemantics.has(adapter.semantics))errors.push(adapter.surface+': invalid adapter semantics '+adapter.semantics);
    if(!adapter.note)errors.push(adapter.surface+': adapter semantics must be documented');
  }
  for(const axis of corpus?.axes??[]){
    if(!adapterNames.has(axis))errors.push('missing adapter declaration for core axis '+axis);
  }
  return errors;
}

export function buildCompatibilityBaseline(corpus,adapters){
  const classes=[...new Set(corpus.cases.flatMap(entry=>entry.classes??[]))].sort();
  const strata=[...new Set(corpus.cases.flatMap(entry=>entry.strata??[]))].sort();
  const lockfileSupport={
    supported:corpus.cases.filter(entry=>entry.lockfile?.runtimeParser==='supported').map(entry=>entry.id).sort(),
    unsupported:corpus.cases.filter(entry=>entry.lockfile?.runtimeParser==='unsupported').map(entry=>entry.id).sort(),
    notRootAuthority:corpus.cases.filter(entry=>entry.lockfile?.runtimeParser==='not-root-authority').map(entry=>entry.id).sort(),
    absent:corpus.cases.filter(entry=>!entry.lockfile).map(entry=>entry.id).sort()
  };
  const unsupportedRetained=corpus.cases
    .filter(entry=>(entry.expectedBoundaries??[]).some(value=>/UNSUPPORTED/.test(value)))
    .map(entry=>({id:entry.id,boundaries:entry.expectedBoundaries.filter(value=>/UNSUPPORTED/.test(value))}));

  return {
    schema:'opencontainer.compatibility-baseline.v0.1',
    corpus:'compat/REAL-REPOSITORY-CORPUS.v0.1.json',
    generatedFromCorpusSchema:corpus.schema,
    productionClosed:false,
    axes:[...corpus.axes],
    reportingRule:'No synthetic Node compatibility percentage. Each surface is reported independently.',
    corpusSummary:{
      caseCount:corpus.cases.length,
      repositories:corpus.cases.map(entry=>entry.repository),
      caseClasses:classes,
      packageStrata:strata,
      lockfileSupport,
      unsupportedRetained
    },
    progression:{
      primitive:'promoted-selected',
      package:'promoted-selected',
      framework:'vite-8.3.0-c1-c2-promoted',
      realRepository:'yoctocolors-pass-ci-286',
      repeatedBrowser:'not-closed'
    },
    surfaceEvidence:{
      fs:{state:'PASS-BROWSER-BOUNDED',evidence:'Workspace VFS + OPFS courts; real repo source mounted in CI #286'},
      module:{state:'PASS-BROWSER-BOUNDED',evidence:'native ESM/CJS courts + pinned yoctocolors Native ESM execution in CI #286'},
      process:{state:'PASS-BROWSER-BOUNDED',evidence:'virtual process/Worker authority; arbitrary host child process remains denied'},
      http:{state:'PASS-BROWSER-BOUNDED',evidence:'PreviewAuthority virtual HTTP + Vite C2 virtual HTTP; raw host TCP listen is not claimed'},
      package:{state:'PASS-BROWSER-SELECTED',evidence:'npm package-lock v2/v3 frozen installer + package corpus; pnpm/yarn remain unsupported'},
      watch:{state:'PARTIAL',evidence:'Vite HMR is promoted; generic fs.watch/chokidar parity remains open'}
    },
    adapters:adapters.adapters.map(({surface,semantics,nodeSurface})=>({surface,semantics,nodeSurface})),
    limitations:[
      'pnpm and yarn lockfiles are not accepted by the promoted frozen package graph parser',
      'native .node addons and arbitrary node-gyp/native binary execution are unsupported',
      'generic fs.watch/chokidar parity is not promoted',
      'raw guest TCP/UDP and arbitrary host process creation are unsupported',
      'minimum cross-browser versions are intentionally not frozen before browser matrix evidence'
    ]
  };
}

async function fetchPinned(repository,commit,path){
  const url='https://raw.githubusercontent.com/'+repository+'/'+commit+'/'+path.split('/').map(encodeURIComponent).join('/');
  const response=await fetch(url,{headers:{'user-agent':'opencontainer-compat-corpus-v0.1'}});
  if(!response.ok)throw new Error(repository+'@'+commit+': '+path+' returned HTTP '+response.status);
  return new Uint8Array(await response.arrayBuffer());
}

async function inspectRegistryPackage(name,version){
  if(typeof name!=='string'||!name||typeof version!=='string'||!version)return {published:false,reason:'missing-name-or-version'};
  const encodedName=name.startsWith('@')?'@'+name.slice(1).split('/').map(encodeURIComponent).join('%2F'):encodeURIComponent(name);
  const response=await fetch('https://registry.npmjs.org/'+encodedName+'/'+encodeURIComponent(version),{
    headers:{'user-agent':'opencontainer-compat-corpus-v0.1'}
  });
  if(response.status===404)return {published:false,reason:'registry-404'};
  if(!response.ok)throw new Error('npm registry '+name+'@'+version+' returned HTTP '+response.status);
  const metadata=await response.json();
  const dist=metadata?.dist??{};
  return {
    published:true,
    name:metadata?.name??name,
    version:metadata?.version??version,
    integrity:dist.integrity??null,
    shasum:dist.shasum??null,
    tarball:dist.tarball??null
  };
}

export async function verifyCorpusOnline(corpus){
  const results=[];
  for(const entry of corpus.cases){
    const result={id:entry.id,repository:entry.repository,commit:entry.commit,ok:true,checks:[]};
    try{
      const packageJsonPath=entry.packageJsonPath??'package.json';
      const packageBytes=await fetchPinned(entry.repository,entry.commit,packageJsonPath);
      let packageJson=null;
      try{packageJson=JSON.parse(Buffer.from(packageBytes).toString('utf8'));}
      catch(error){throw new Error('package.json is invalid JSON: '+error.message);}
      result.checks.push({kind:'package-json',path:packageJsonPath,bytes:packageBytes.byteLength,name:packageJson.name??null,version:packageJson.version??null});

      const registry=await inspectRegistryPackage(packageJson.name,packageJson.version);
      result.checks.push({kind:'registry-package',...registry});

      const licenseBytes=await fetchPinned(entry.repository,entry.commit,entry.license.path);
      const licenseSha=gitBlobSha(licenseBytes);
      if(licenseSha!==entry.license.blobSha)throw new Error('license blob SHA drift: expected '+entry.license.blobSha+' got '+licenseSha);
      result.checks.push({kind:'license',path:entry.license.path,blobSha:licenseSha,spdx:entry.license.spdx});

      if(entry.lockfile){
        const lockBytes=await fetchPinned(entry.repository,entry.commit,entry.lockfile.path);
        const lockSha=gitBlobSha(lockBytes);
        if(lockSha!==entry.lockfile.blobSha)throw new Error('lockfile blob SHA drift: expected '+entry.lockfile.blobSha+' got '+lockSha);
        const lockCheck={kind:'lockfile',path:entry.lockfile.path,blobSha:lockSha,runtimeParser:entry.lockfile.runtimeParser,bytes:lockBytes.byteLength};
        if(entry.lockfile.runtimeParser==='supported'){
          const lock=JSON.parse(Buffer.from(lockBytes).toString('utf8'));
          const graph=new PackageGraphAuthority().compile(lock);
          const packageRows=Object.entries(lock.packages??{}).filter(([location,meta])=>location&&location.includes('node_modules/')&&!meta?.link&&!meta?.inBundle);
          lockCheck.lockfileVersion=lock.lockfileVersion;
          lockCheck.graphNodes=graph.nodes.length;
          lockCheck.integrityEntries=packageRows.filter(([,meta])=>typeof meta?.integrity==='string'&&meta.integrity.length>0).length;
          lockCheck.missingIntegrity=packageRows.length-lockCheck.integrityEntries;
        }
        result.checks.push(lockCheck);
      }else{
        result.checks.push({kind:'lockfile',runtimeParser:'absent',note:'dependency graph is intentionally retained as unpinned/unsupported boundary'});
      }

      for(const source of entry.pinnedSources??[]){
        const bytes=await fetchPinned(entry.repository,entry.commit,source.path);
        const sha=gitBlobSha(bytes);
        if(sha!==source.blobSha)throw new Error(source.path+' blob SHA drift: expected '+source.blobSha+' got '+sha);
        result.checks.push({kind:'source',path:source.path,blobSha:sha,bytes:bytes.byteLength});
      }
    }catch(error){
      result.ok=false;
      result.error=error?.message??String(error);
    }
    results.push(result);
  }
  return {
    schema:'opencontainer.compatibility-corpus-verification.v0.1',
    verifiedAt:new Date().toISOString(),
    ok:results.every(item=>item.ok),
    cases:results
  };
}

async function main(){
  const {corpus,adapters}=await loadCompatibilitySources();
  const errors=validateCompatibilitySources(corpus,adapters);
  if(errors.length){
    console.error(JSON.stringify({ok:false,errors},null,2));
    process.exitCode=1;
    return;
  }

  if(process.argv.includes('--write-baseline')){
    const baseline=buildCompatibilityBaseline(corpus,adapters);
    await writeFile(baselinePath,JSON.stringify(baseline,null,2)+'\\n');
    console.log(baselinePath);
    return;
  }

  if(process.argv.includes('--verify-online')){
    const receipt=await verifyCorpusOnline(corpus);
    console.log(JSON.stringify(receipt,null,2));
    if(!receipt.ok)process.exitCode=1;
    return;
  }

  console.log(JSON.stringify(buildCompatibilityBaseline(corpus,adapters),null,2));
}

if(import.meta.url===new URL('file://'+process.argv[1]).href)await main();
