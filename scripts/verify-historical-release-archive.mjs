import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot=dirname(fileURLToPath(import.meta.url));
const repositoryRoot=resolve(scriptRoot,'..');
const path=resolve(process.argv[2]??'');
const requireRepository=process.argv.includes('--require-repository');
if(!process.argv[2])throw new Error('historical archive record path is required');

function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function decode(entry,name){
  if(entry?.encoding!=='base64'||typeof entry.contentBase64!=='string')throw new Error(name+' archive encoding invalid');
  const bytes=Buffer.from(entry.contentBase64,'base64');
  if(bytes.byteLength!==entry.bytes||sha256(bytes)!==entry.sha256)throw new Error(name+' archive digest/size mismatch');
  return bytes;
}
function json(bytes,name){
  try{return JSON.parse(bytes.toString('utf8'));}catch{throw new Error(name+' archive JSON invalid');}
}

const record=JSON.parse(await readFile(path,'utf8'));
if(record.schema!=='opencontainer.historical-release-archive.v1.0')throw new Error('historical archive schema drifted');
if(!/^[0-9a-f]{40}$/i.test(record.sourceCommit??''))throw new Error('historical archive source commit missing');
if(record.productionClosed!==false||record.boundaries?.productionClosed!==false)throw new Error('historical archive cannot claim production closure');
if(record.archivePolicy?.medium!=='git-source-history'||record.archivePolicy?.automatedExpiry!==false)throw new Error('historical archive retention medium must be non-expiring Git history');
if(!(record.archivePolicy?.minimumYears>=10))throw new Error('historical archive minimum retention is below 10 years');
if(record.archivePolicy?.keepWhileAnyHistoricalVersionMayNeedVerification!==true)throw new Error('historical archive historical-verification retention is not mandatory');
if(record.archivePolicy?.deletionRequiresSupersedingArchive!==true)throw new Error('historical archive deletion is not supersession-gated');

const required=['release-manifest.json','checksums.txt','opencontainer.spdx.json','provenance.intoto.json','dependency-license-inventory.json','third-party-notices.json','reproducibility.json'];
for(const name of required)if(!record.embeddedFiles?.[name])throw new Error('historical archive missing '+name);

const manifest=json(decode(record.embeddedFiles['release-manifest.json'],'release-manifest.json'),'release-manifest.json');
const checksums=decode(record.embeddedFiles['checksums.txt'],'checksums.txt').toString('utf8');
const spdx=json(decode(record.embeddedFiles['opencontainer.spdx.json'],'opencontainer.spdx.json'),'opencontainer.spdx.json');
const provenance=json(decode(record.embeddedFiles['provenance.intoto.json'],'provenance.intoto.json'),'provenance.intoto.json');
const inventory=json(decode(record.embeddedFiles['dependency-license-inventory.json'],'dependency-license-inventory.json'),'dependency-license-inventory.json');
const notices=json(decode(record.embeddedFiles['third-party-notices.json'],'third-party-notices.json'),'third-party-notices.json');
const reproducibility=json(decode(record.embeddedFiles['reproducibility.json'],'reproducibility.json'),'reproducibility.json');

if(manifest.source?.commit!==record.sourceCommit)throw new Error('historical archive source commit drifted from release manifest');
if(manifest.artifact?.sha256!==record.artifact?.sha256||manifest.artifact?.sha512!==record.artifact?.sha512)throw new Error('historical archive artifact digest drifted');
if(!checksums.includes(record.artifact.sha256+'  '+record.artifact.filename)||!checksums.includes(record.artifact.sha512+'  '+record.artifact.filename))throw new Error('historical archive checksum file does not identify artifact');
if(spdx.spdxVersion!=='SPDX-2.3')throw new Error('historical archive SBOM is not SPDX 2.3');
const root=spdx.packages?.find(item=>item.SPDXID==='SPDXRef-Package-OpenContainer');
if(!root?.checksums?.some(item=>item.algorithm==='SHA256'&&item.checksumValue===record.artifact.sha256))throw new Error('historical archive SBOM is not bound to artifact');
if(provenance._type!=='https://in-toto.io/Statement/v1'||provenance.predicateType!=='https://slsa.dev/provenance/v1')throw new Error('historical archive provenance type drifted');
if(provenance.subject?.[0]?.digest?.sha256!==record.artifact.sha256)throw new Error('historical archive provenance is not bound to artifact');
if(reproducibility.reproducible!==true||reproducibility.first?.sha256!==record.artifact.sha256||reproducibility.second?.sha256!==record.artifact.sha256)throw new Error('historical archive reproducibility evidence drifted');
const inventoryRows=inventory.categories?.runtimeTransitive??[];
if(notices.schema!=='opencontainer.third-party-notices.v0.1'||notices.components?.length!==inventoryRows.length)throw new Error('historical archive notices/inventory count drifted');
for(const item of inventoryRows){
  const match=notices.components.find(row=>row.location===item.location&&row.name===item.name&&row.version===item.version&&row.license===item.license);
  if(!match)throw new Error('historical archive notices missing '+item.location);
}

if(requireRepository){
  const repoRoot=resolve(new URL('..',import.meta.url).pathname,'..');
  const rel=relative(repoRoot,path).replaceAll('\\','/');
  if(isAbsolute(rel)||rel.startsWith('..')||!rel.startsWith('release/history/'))throw new Error('historical archive is not stored under release/history');
  execFileSync('git',['ls-files','--error-unmatch',rel],{cwd:repositoryRoot,stdio:'ignore'});
}

console.log(JSON.stringify({
  schema:'opencontainer.historical-release-archive-verification.v1.0',
  ok:true,
  version:record.version,
  sourceCommit:record.sourceCommit,
  artifact:record.artifact.filename,
  archiveFiles:required.length,
  notices:notices.components.length,
  retentionYears:record.archivePolicy.minimumYears,
  repositoryTracked:requireRepository,
  productionClosed:false
},null,2));
