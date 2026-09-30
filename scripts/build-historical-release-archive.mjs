import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const releaseRoot=resolve(repoRoot,process.argv[2]??'.artifacts/release');
const emitBase64=process.argv.includes('--emit-base64');

function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function base64(bytes){return Buffer.from(bytes).toString('base64');}

const manifest=JSON.parse(await readFile(join(releaseRoot,'release-manifest.json'),'utf8'));
const packageJson=JSON.parse(await readFile(join(repoRoot,'package.json'),'utf8'));
const version=packageJson.version;
const sourceCommit=manifest?.source?.commit;
if(typeof sourceCommit!=='string'||!/^[0-9a-f]{40}$/i.test(sourceCommit))throw new Error('historical archive requires exact source commit');

const required=[
  'release-manifest.json',
  'checksums.txt',
  'opencontainer.spdx.json',
  'provenance.intoto.json',
  'dependency-license-inventory.json',
  'third-party-notices.json',
  'reproducibility.json'
];
for(const name of required.slice(1)){
  if(name!=='release-manifest.json'&&!manifest.evidenceFiles?.includes(name)){
    throw new Error('release manifest does not retain historical file '+name);
  }
}

const embeddedFiles={};
for(const name of required){
  const bytes=await readFile(join(releaseRoot,name));
  embeddedFiles[name]=Object.freeze({
    encoding:'base64',
    bytes:bytes.byteLength,
    sha256:sha256(bytes),
    contentBase64:base64(bytes)
  });
}

const record={
  schema:'opencontainer.historical-release-archive.v1.0',
  sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P13-20',
  version,
  sourceCommit,
  artifact:{
    filename:manifest.artifact.filename,
    sha256:manifest.artifact.sha256,
    sha512:manifest.artifact.sha512,
    bytes:manifest.artifact.bytes
  },
  archivePolicy:{
    medium:'git-source-history',
    automatedExpiry:false,
    minimumYears:10,
    keepWhileAnyHistoricalVersionMayNeedVerification:true,
    deletionRequiresSupersedingArchive:true,
    appendOnlyPath:'release/history/<version>/<sourceCommit>/record.json'
  },
  embeddedFiles,
  boundaries:{
    artifactBytesArchived:false,
    externallyPublishedArtifactClaimed:false,
    signingClaimed:false,
    legalClosureClaimed:false,
    productionClosed:false
  },
  productionClosed:false
};

const output=resolve(repoRoot,'.artifacts','p13-history',version,sourceCommit,'record.json');
await mkdir(dirname(output),{recursive:true});
const text=JSON.stringify(record,null,2)+'\n';
await writeFile(output,text);
const digest=sha256(Buffer.from(text));
console.log('P13 HISTORICAL ARCHIVE CANDIDATE '+JSON.stringify({
  version,sourceCommit,recordSha256:digest,embeddedFiles:Object.keys(embeddedFiles).length,output
}));
if(emitBase64)console.log('P13 HISTORICAL ARCHIVE BASE64 '+Buffer.from(text).toString('base64'));
