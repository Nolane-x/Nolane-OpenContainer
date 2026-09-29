import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser=JSON.parse(await readFile(resolve('.artifacts/critical-flake/browser-receipt.json'),'utf8'));
const errors=[];
const expectedGates=['P4-05','P4-08','P4-09','P4-10','P4-12'];
const expectedHostile={
  truncatedHeader:'OC_ARCHIVE_UNSAFE',
  truncatedPayload:'OC_ARCHIVE_UNSAFE',
  truncatedTrailer:'OC_ARCHIVE_UNSAFE',
  truncatedGzip:'OC_ARCHIVE_UNSAFE',
  decompressionBudget:'OC_ARTIFACT_TOO_LARGE',
  pathTraversal:'OC_ARCHIVE_UNSAFE',
  absolutePath:'OC_ARCHIVE_UNSAFE',
  dotSegment:'OC_ARCHIVE_UNSAFE',
  symlink:'OC_ARCHIVE_UNSAFE',
  hardlink:'OC_ARCHIVE_UNSAFE',
  paxExtension:'OC_ARCHIVE_UNSAFE',
  gnuLongNameExtension:'OC_ARCHIVE_UNSAFE'
};

function parseAcceptance(log){
  const prefix='browser acceptance PASS ';
  const index=log.indexOf(prefix);
  if(index<0)return null;
  const start=index+prefix.length;
  const end=log.indexOf('\ndistribution browser PASS',start);
  const raw=(end>=0?log.slice(start,end):log.slice(start)).trim();
  try{return JSON.parse(raw);}catch{return null;}
}

if(browser.status!=='PASS')errors.push('critical browser receipt is not PASS');
if(browser.unexplainedFailures!==0)errors.push('critical browser receipt has unexplained failures');
if(browser.fullProductPathPasses!==browser.iterations)errors.push('not every browser iteration passed full product path');

const runs=[];
for(const run of browser.runs??[]){
  const log=await readFile(resolve('.artifacts/critical-flake',run.logFile),'utf8');
  const acceptance=parseAcceptance(log);
  if(!acceptance||!Array.isArray(acceptance.stages)){
    errors.push('browser acceptance receipt missing for iteration '+run.iteration);
    continue;
  }
  const stage=acceptance.stages.find(item=>item.name==='p4-artifact-boundary-pass')??null;
  if(!stage){
    errors.push('P4 artifact boundary stage missing for iteration '+run.iteration);
    continue;
  }

  if(stage.streamingDecompression!==true)errors.push('P4 streaming DecompressionStream was not exercised');
  if(JSON.stringify(stage.gates)!==JSON.stringify(expectedGates))errors.push('P4 source-gate set drifted');

  const corpus=stage.corpus??[];
  if(corpus.length!==2)errors.push('P4 frozen npm tarball corpus did not contain exactly two retained fixtures');
  const byName=new Map(corpus.map(item=>[item.name,item]));
  for(const [name,version] of [['lightningcss-wasm','1.33.0'],['@rolldown/browser','1.2.9']]){
    const item=byName.get(name);
    if(!item)errors.push('P4 corpus missing '+name);
    else{
      if(item.version!==version)errors.push('P4 corpus version drifted for '+name);
      if(!(Number(item.compressedBytes)>0))errors.push('P4 compressed byte count missing for '+name);
      if(!(Number(item.unpackedBytes)>0))errors.push('P4 unpacked byte count missing for '+name);
      if(!(Number(item.entries)>0))errors.push('P4 entry count missing for '+name);
      if(typeof item.integrity!=='string'||!/^sha(?:256|512)-/.test(item.integrity)){
        errors.push('P4 verified integrity receipt missing for '+name);
      }
    }
  }

  for(const [key,code] of Object.entries(expectedHostile)){
    if(stage.hostileCases?.[key]!==code)errors.push('P4 hostile case '+key+' expected '+code+' but observed '+stage.hostileCases?.[key]);
  }

  const integrity=stage.integrityMismatch??{};
  if(integrity.code!=='OC_ARTIFACT_INTEGRITY')errors.push('P4 integrity mismatch code drifted');
  if(integrity.graphGenerationPreserved!==true)errors.push('P4 integrity mismatch changed graph generation');
  if(integrity.contentPublished!==false)errors.push('P4 integrity mismatch published content');
  if(integrity.installAnywayPath!==false)errors.push('P4 install-anyway path appeared');
  if(stage.specialTarFeaturesDefault!=='deny')errors.push('P4 special TAR default is not deny');

  runs.push(Object.freeze({
    iteration:run.iteration,
    outputSha256:run.outputSha256,
    corpus:Object.freeze(corpus.map(item=>Object.freeze({...item}))),
    hostileCases:Object.freeze({...stage.hostileCases}),
    integrityMismatch:Object.freeze({...integrity}),
    specialTarFeaturesDefault:stage.specialTarFeaturesDefault,
    gates:Object.freeze([...stage.gates])
  }));
}

const receipt=Object.freeze({
  schema:'opencontainer.p4-artifact-boundary-browser.v1.0',
  status:errors.length?'FAIL':'PASS',
  testedCheckoutCommit:browser.sourceCommit,
  profile:browser.profile,
  iterations:browser.iterations,
  fullProductPathPasses:browser.fullProductPathPasses,
  unexplainedFailures:browser.unexplainedFailures,
  frozenNpmCorpus:Object.freeze([
    Object.freeze({name:'lightningcss-wasm',version:'1.33.0'}),
    Object.freeze({name:'@rolldown/browser',version:'1.2.9'})
  ]),
  sourceGates:Object.freeze(expectedGates),
  guarantees:Object.freeze([
    'browser streaming gzip/TAR parser executes retained npm tarball bytes',
    'truncated header/payload/trailer/gzip and decompression budget faults fail closed',
    'path traversal absolute dot-segment symlink hardlink and extension records fail closed',
    'special TAR/link features remain denied by default',
    'integrity mismatch cannot publish package content or change package graph generation'
  ]),
  runs:Object.freeze(runs),
  errors:Object.freeze(errors),
  productionClosed:false
});

await mkdir(resolve('.artifacts/p4-artifact-boundary'),{recursive:true});
await writeFile(resolve('.artifacts/p4-artifact-boundary/browser-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(errors.length)process.exitCode=1;
