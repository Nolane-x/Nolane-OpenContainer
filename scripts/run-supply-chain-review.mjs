import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const readJson=async path=>JSON.parse(await readFile(resolve(repoRoot,path),'utf8'));
const hex40=/^[0-9a-f]{40}$/i;
const asText=value=>String(value??'');

export function reviewWorkflowSecurity({policy,workflows}){
  const errors=[];
  for(const [path,text] of Object.entries(workflows)){
    const source=asText(text);
    const uses=[...source.matchAll(/\buses:\s*([^\s#]+)/g)].map(m=>m[1]);
    if(!uses.length)errors.push(path+': no action references found');
    for(const use of uses){
      if(use.startsWith('./'))continue;
      const at=use.lastIndexOf('@');
      if(at<1||!hex40.test(use.slice(at+1)))errors.push(path+': action is not pinned to full commit: '+use);
    }
    if(!/(^|\n)permissions:\s*\n\s+contents:\s*read\b/m.test(source))errors.push(path+': top-level contents: read permission missing');
    for(const signal of policy.workflowRules.forbiddenUntrustedReleaseSignals){
      if(source.toLowerCase().includes(signal.toLowerCase()))errors.push(path+': forbidden untrusted release signal '+signal);
    }
    const writes=[...source.matchAll(/^\s+([a-z-]+):\s*write\s*$/gmi)].map(m=>m[1]+': write');
    for(const permission of writes){
      if(!policy.workflowRules.allowedWritePermissions.includes(permission))errors.push(path+': unexpected write permission '+permission);
    }
  }
  const ci=workflows['.github/workflows/ci.yml']??'';
  if(!/(^|\n)\s*pull_request:\s*$/m.test(ci))errors.push('CI pull_request trigger missing');
  if(!/security-events:\s*write/.test(ci))errors.push('CodeQL security-events write permission missing');
  return errors;
}

export function reviewReleaseEvidence({policy,manifest,spdx,provenance,inventory,reproducibility,checksums,certification}){
  const errors=[];
  const artifact=manifest?.artifact??{};
  if(manifest?.schema!=='opencontainer.release-evidence.v0.1')errors.push('release manifest schema drift');
  if(manifest?.source?.cleanTrackedTree!==true)errors.push('release source tree was not clean');
  if(!hex40.test(manifest?.source?.commit??''))errors.push('release source commit missing');
  if(!/^[0-9a-f]{64}$/i.test(manifest?.source?.packageLockSha256??''))errors.push('package-lock SHA-256 missing');
  for(const key of ['node','npm','platform','arch'])if(!manifest?.environment?.[key])errors.push('release environment missing '+key);
  for(const key of ['vite','rolldown','rolldownBinding','lightningCss'])if(!manifest?.toolchain?.[key])errors.push('exact toolchain missing '+key);
  if(!/^[0-9a-f]{64}$/i.test(artifact.sha256??'')||!/^[0-9a-f]{128}$/i.test(artifact.sha512??''))errors.push('artifact digests missing');
  if(artifact.contentPolicy?.violations!==0)errors.push('distribution content-policy violation');

  if(spdx?.spdxVersion!==policy.releaseEvidence.sbomSchema)errors.push('SPDX schema drift');
  const root=spdx?.packages?.find(x=>x.SPDXID==='SPDXRef-Package-OpenContainer');
  if(!root?.checksums?.some(x=>x.algorithm==='SHA256'&&x.checksumValue===artifact.sha256))errors.push('SBOM is not bound to artifact SHA-256');

  if(provenance?._type!=='https://in-toto.io/Statement/v1')errors.push('in-toto statement type drift');
  if(provenance?.predicateType!==policy.releaseEvidence.provenancePredicate)errors.push('SLSA predicate drift');
  if(provenance?.subject?.[0]?.digest?.sha256!==artifact.sha256)errors.push('provenance subject SHA-256 drift');
  const deps=provenance?.predicate?.buildDefinition?.resolvedDependencies??[];
  if(!deps.some(x=>x.digest?.gitCommit===manifest.source.commit))errors.push('provenance source commit drift');
  if(!deps.some(x=>x.digest?.sha256===manifest.source.packageLockSha256))errors.push('provenance package-lock digest drift');

  const categoryKeys=Object.keys(inventory?.categories??{});
  for(const category of policy.dependencyInventory.requiredCategories){
    if(!categoryKeys.includes(category))errors.push('dependency category missing '+category);
    if(!Array.isArray(inventory?.categories?.[category]))errors.push('dependency category is not an array '+category);
  }
  if(inventory?.optionalAdapterPolicy?.shipped!==policy.dependencyInventory.optionalAdaptersShipped)errors.push('optional adapter shipped policy drift');
  if(inventory?.optionalAdapterPolicy?.bundleCount!==policy.dependencyInventory.optionalAdapterBundleCount)errors.push('optional adapter bundle count drift');
  if((inventory?.categories?.runtimeTransitive?.length??0)===0)errors.push('runtime inventory is empty');

  if(reproducibility?.reproducible!==true)errors.push('release is not reproducible');
  if(reproducibility?.first?.sha256!==artifact.sha256||reproducibility?.second?.sha256!==artifact.sha256)errors.push('reproducibility SHA-256 drift');
  if(reproducibility?.first?.sha512!==artifact.sha512||reproducibility?.second?.sha512!==artifact.sha512)errors.push('reproducibility SHA-512 drift');

  const checksumText=asText(checksums);
  if(!checksumText.includes(artifact.sha256+'  '+artifact.filename))errors.push('independent SHA-256 checksum missing');
  if(!checksumText.includes(artifact.sha512+'  '+artifact.filename))errors.push('independent SHA-512 checksum missing');

  if(certification?.schema!=='opencontainer.distribution-certification.v0.1')errors.push('distribution certification receipt missing');
  if(certification?.build?.sha256!==artifact.sha256||certification?.build?.sha512!==artifact.sha512)errors.push('release artifact digest does not equal tested distribution certification artifact');
  if(certification?.consumer?.installedArtifact!==true)errors.push('distribution consumer did not resolve installed artifact');
  if(certification?.consumer?.productionClosed!==false)errors.push('distribution certification claims production closure');
  return errors;
}

export function reviewRevocation({policy,operations,scenarios}){
  const errors=[];
  const actions=new Set(operations?.revocation?.actions??[]);
  for(const action of policy.revocation.requiredActions)if(!actions.has(action))errors.push('revocation action missing '+action);
  const scenario=(scenarios?.scenarios??[]).find(x=>x.id==='compromised-publishing-credential');
  if(!scenario)errors.push('compromised publishing credential drill missing');
  const required=new Set(scenario?.required??[]);
  for(const action of policy.revocation.compromisedCredentialActions)if(!required.has(action))errors.push('compromised credential action missing '+action);
  return errors;
}

export async function buildSupplyChainReview(){
  const policy=await readJson('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json');
  const [workflowEntries,manifest,spdx,provenance,inventory,reproducibility,checksums,certification,operations,scenarios]=await Promise.all([
    Promise.all(policy.workflowFiles.map(async path=>[path,await readFile(resolve(repoRoot,path),'utf8')])),
    readJson('.artifacts/release/release-manifest.json'),
    readJson('.artifacts/release/opencontainer.spdx.json'),
    readJson('.artifacts/release/provenance.intoto.json'),
    readJson('.artifacts/release/dependency-license-inventory.json'),
    readJson('.artifacts/release/reproducibility.json'),
    readFile(resolve(repoRoot,'.artifacts/release/checksums.txt'),'utf8'),
    readJson('.artifacts/distribution/certification.json'),
    readJson('release/OPERATIONS-POLICY.v1.0.json'),
    readJson('release/OPERATIONS-DISASTER-SCENARIOS.v1.0.json')
  ]);
  const workflows=Object.fromEntries(workflowEntries);
  const workflowErrors=reviewWorkflowSecurity({policy,workflows});
  const releaseErrors=reviewReleaseEvidence({policy,manifest,spdx,provenance,inventory,reproducibility,checksums,certification});
  const revocationErrors=reviewRevocation({policy,operations,scenarios});
  const errors=[...workflowErrors,...releaseErrors,...revocationErrors];
  const closedCandidates=Object.entries(policy.gateAuthority).filter(([,v])=>v.machineClosable===true).map(([k])=>k);
  const externalOpen=Object.entries(policy.gateAuthority).filter(([,v])=>v.machineClosable===false).map(([k,v])=>({id:k,state:v.state,reason:v.reason}));
  const receipt={
    schema:'opencontainer.supply-chain-security-review.v1.0',
    sourceCommit:manifest.source.commit,
    status:errors.length?'FAIL':'PASS',
    maturity:errors.length?'FAILED':'SECURITY-REVIEWED',
    workflow:{files:policy.workflowFiles,immutableActionRefs:workflowErrors.filter(x=>x.includes('action is not pinned')).length===0,leastPrivilege:workflowErrors.length===0},
    releaseArtifact:{
      filename:manifest.artifact.filename,sha256:manifest.artifact.sha256,sha512:manifest.artifact.sha512,
      sameAsTestedDistribution:certification?.build?.sha256===manifest.artifact.sha256,
      sbom:spdx.spdxVersion,provenance:provenance.predicateType,reproducible:reproducibility.reproducible,
      contentPolicyViolations:manifest.artifact.contentPolicy?.violations??null
    },
    inventory:{
      runtimeDirect:inventory.categories?.runtimeDirect?.length??0,
      runtimeTransitive:inventory.categories?.runtimeTransitive?.length??0,
      optionalAdapters:inventory.categories?.optionalAdapters?.length??0,
      sourceDevTestOnly:inventory.categories?.sourceDevTestOnly?.length??0,
      optionalAdapterPolicy:inventory.optionalAdapterPolicy
    },
    revocation:{exercisedScenario:'compromised-publishing-credential',publicationConditional:operations.revocation?.publicationConditional===true},
    closedCandidates,externalOpen,errors,productionClosed:false
  };
  const out=resolve(repoRoot,'.artifacts','supply-chain-review');
  await mkdir(out,{recursive:true});
  await writeFile(join(out,'review.json'),JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const receipt=await buildSupplyChainReview();
  console.log(JSON.stringify(receipt,null,2));
  if(receipt.status!=='PASS')process.exitCode=1;
}
