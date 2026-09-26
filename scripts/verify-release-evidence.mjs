import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root=resolve(process.argv[2]??'.artifacts/release');

function digest(bytes,algorithm){
  return createHash(algorithm).update(bytes).digest('hex');
}

const manifest=JSON.parse(await readFile(join(root,'release-manifest.json'),'utf8'));
const artifactBytes=await readFile(join(root,manifest.artifact.filename));
const spdx=JSON.parse(await readFile(join(root,'opencontainer.spdx.json'),'utf8'));
const provenance=JSON.parse(await readFile(join(root,'provenance.intoto.json'),'utf8'));
const inventory=JSON.parse(await readFile(join(root,'dependency-license-inventory.json'),'utf8'));
const reproducibility=JSON.parse(await readFile(join(root,'reproducibility.json'),'utf8'));
const checksums=await readFile(join(root,'checksums.txt'),'utf8');

const sha256=digest(artifactBytes,'sha256');
const sha512=digest(artifactBytes,'sha512');
if(sha256!==manifest.artifact.sha256||sha512!==manifest.artifact.sha512)throw new Error('artifact digest does not match release manifest');
if(!checksums.includes(sha256+'  '+manifest.artifact.filename)||!checksums.includes(sha512+'  '+manifest.artifact.filename))throw new Error('independent checksum file drifted');
if(spdx.spdxVersion!=='SPDX-2.3'||spdx.dataLicense!=='CC0-1.0')throw new Error('SBOM is not SPDX 2.3 JSON');
const rootPackage=spdx.packages?.find((item)=>item.SPDXID==='SPDXRef-Package-OpenContainer');
if(!rootPackage||!rootPackage.checksums?.some((item)=>item.algorithm==='SHA256'&&item.checksumValue===sha256))throw new Error('SBOM is not bound to distribution SHA-256');
if(provenance._type!=='https://in-toto.io/Statement/v1'||provenance.predicateType!=='https://slsa.dev/provenance/v1')throw new Error('provenance statement type drifted');
if(provenance.subject?.[0]?.digest?.sha256!==sha256)throw new Error('provenance subject is not bound to artifact');
if(reproducibility.reproducible!==true||reproducibility.first.sha256!==reproducibility.second.sha256||reproducibility.first.sha256!==sha256)throw new Error('reproducibility evidence failed');
if(manifest.artifact.contentPolicy?.violations!==0)throw new Error('distribution content policy has violations');
if(inventory.root?.license!=='UNLICENSED')throw new Error('license inventory must surface current root UNLICENSED status explicitly');
if((inventory.categories?.runtimeTransitive?.length??0)===0)throw new Error('runtime dependency inventory is empty');
if(manifest.productionClosed!==false)throw new Error('release evidence incorrectly claims production closure');

console.log(JSON.stringify({
  schema:'opencontainer.release-evidence-verification.v0.1',
  ok:true,
  artifact:manifest.artifact.filename,
  sha256,
  sbomPackages:spdx.packages.length,
  runtimeComponents:inventory.categories.runtimeTransitive.length,
  reproducible:true,
  contentPolicyViolations:0,
  productionClosed:false
},null,2));
