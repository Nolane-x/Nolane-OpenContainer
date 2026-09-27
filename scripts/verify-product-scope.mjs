import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const requiredCore=[
  ['S1','runtime'],['S2','runtime.fs'],['S3','runtime.process'],['S4','runtime.packages'],['S5','runtime.net'],
  ['S6','runtime.preview'],['S7','runtime.snapshots'],['S8','runtime.resources'],['S9','runtime.diagnostics']
];
const requiredUnsupported=['native-addons','raw-tcp-tls','full-linux','undeclared-browser-profiles'];
const requiredOutOfCore=['ai','git-hosting','cloud-sync','billing','accounts'];
const requiredBlockers=['DATA_LOSS','ISOLATION_BREAK','SECRET_EXPOSURE','SILENT_SEMANTIC_CORRUPTION'];

function clone(v){return JSON.parse(JSON.stringify(v));}

export function validateProductScope({policy,profile,rootPackage,releasePolicy,scopeDebt,claims,waivers,ledger}){
  const errors=[];
  if(policy?.schema!=='opencontainer.product-scope-policy.v1.0')errors.push('invalid product scope schema');
  if(policy?.targetRelease!=='1.0')errors.push('targetRelease must remain 1.0');
  if(policy?.profileId!==profile?.profileId)errors.push('scope profileId does not match production profile');
  if(policy?.coreSurfaceCount!==9||profile?.runtime?.coreSurfaces!==9)errors.push('Core must remain exactly nine surfaces');
  const actualCore=(policy?.coreSurfaces??[]).map(x=>[x.id,x.namespace]);
  if(JSON.stringify(actualCore)!==JSON.stringify(requiredCore))errors.push('Core surface constitution drifted');
  if(policy?.oracle?.node!=='24.21.0'||policy?.oracle?.npm!=='11.19.0')errors.push('scope oracle drifted');
  if(rootPackage?.engines?.node!==policy?.oracle?.node||rootPackage?.engines?.npm!==policy?.oracle?.npm)errors.push('package engine oracle does not match scope policy');
  if(profile?.oracle?.node!==policy?.oracle?.node||profile?.oracle?.npm!==policy?.oracle?.npm)errors.push('production profile oracle does not match scope policy');

  const evidenceProfile=policy?.declaredEvidenceProfile??{};
  if(evidenceProfile.productionProfileId!==policy?.profileId)errors.push('evidence profile does not bind production profile');
  if(evidenceProfile.browser?.product!=='Google Chrome'||evidenceProfile.browser?.major!==153)errors.push('P0 browser evidence profile must remain Chrome major 153 until explicitly revised');
  if(evidenceProfile.os?.platform!=='linux'||evidenceProfile.os?.distribution!=='ubuntu'||evidenceProfile.os?.version!=='24.04'||evidenceProfile.os?.arch!=='x64')errors.push('P0 OS/device evidence profile drifted');
  if(evidenceProfile.device?.resourceFloorClaimed!==false)errors.push('P0 must not infer a weak-device resource floor');

  const unsupported=new Set((policy?.unsupportedClasses??[]).map(x=>x.id));
  for(const id of requiredUnsupported)if(!unsupported.has(id))errors.push('missing unsupported class '+id);
  const outOfCore=new Set((policy?.outOfCore??[]).map(x=>x.id));
  for(const id of requiredOutOfCore)if(!outOfCore.has(id))errors.push('missing out-of-Core boundary '+id);

  if(JSON.stringify(policy?.decisionPolicy?.values)!==JSON.stringify(['GO','REDESIGN','KILL']))errors.push('scope decision values must be GO/REDESIGN/KILL');
  if(JSON.stringify(releasePolicy?.decisionValues)!==JSON.stringify(['GO','REDESIGN','KILL']))errors.push('release policy decision values drifted');
  const stable=(releasePolicy?.channels??[]).find(x=>x.id==='stable');
  if(stable?.requireProductionClosed!==true||stable?.requireReleaseVerified!==true||stable?.requireZeroUnexplainedCriticalFlakes!==true)errors.push('stable release thresholds are weaker than P0 policy');

  const blockers=new Set((policy?.severity?.releaseBlockers??[]).map(x=>x.id));
  for(const id of requiredBlockers)if(!blockers.has(id))errors.push('missing release-blocking severity '+id);
  if(!String(policy?.severity?.criticalRule??'').includes('KILL')||!String(policy?.severity?.criticalRule??'').includes('REDESIGN'))errors.push('critical severity must force REDESIGN or KILL');

  if(scopeDebt?.schema!=='opencontainer.scope-debt-registry.v1.0')errors.push('invalid scope-debt registry');
  const debtIds=new Set();
  for(const debt of scopeDebt?.entries??[]){
    if(!debt?.id||debtIds.has(debt.id))errors.push('duplicate/missing scope debt id');
    debtIds.add(debt?.id);
    if(!debt?.owner)errors.push((debt?.id??'scope debt')+' has no owner');
    if(!debt?.removalOrRehomePlan)errors.push((debt?.id??'scope debt')+' has no removal/rehome plan');
    if(!debt?.revisitTrigger)errors.push((debt?.id??'scope debt')+' has no revisit trigger');
  }

  if(claims?.schema!=='opencontainer.public-claims.v1.0')errors.push('invalid public claims registry');
  const claimIds=new Set();
  for(const claim of claims?.claims??[]){
    if(!claim?.id||claimIds.has(claim.id))errors.push('duplicate/missing public claim id');
    claimIds.add(claim?.id);
    if(claim?.profileId!==policy?.profileId)errors.push((claim?.id??'claim')+' has wrong/missing profileId');
    if(!Array.isArray(claim?.evidence)||claim.evidence.length===0)errors.push((claim?.id??'claim')+' has no retained evidence refs');
  }
  if(!(claims?.forbiddenGeneralizations??[]).some(x=>/Firefox/.test(x)&&/Safari/.test(x)))errors.push('claims registry must forbid cross-browser generalization');
  if(!(claims?.forbiddenGeneralizations??[]).some(x=>/full Node 24/i.test(x)))errors.push('claims registry must forbid full Node compatibility generalization');

  if(waivers?.schema!=='opencontainer.critical-gate-waivers.v1.0')errors.push('invalid critical-gate waiver registry');
  const requiredWaiverFields=policy?.criticalGateWaiverPolicy?.requiredFields??[];
  const waiverIds=new Set();
  for(const waiver of waivers?.waivers??[]){
    if(!waiver?.gate||waiverIds.has(waiver.gate))errors.push('duplicate/missing gate waiver');
    waiverIds.add(waiver?.gate);
    for(const key of requiredWaiverFields)if(!waiver?.[key])errors.push('waiver '+String(waiver?.gate)+' missing '+key);
  }
  for(const item of ledger?.overrides??[]){
    if(item?.waiver===true&&!waiverIds.has(item.id))errors.push('ledger contains undocumented critical waiver '+item.id);
  }

  const criteria=policy?.oneZeroCriteria??[];
  for(const token of ['production_closed','all critical','legal/FTO','operations','SaaS/Program B']){
    if(!criteria.some(x=>String(x).includes(token)))errors.push('1.0 criteria missing '+token);
  }
  if(ledger?.production_closed!==false)errors.push('current P0 verification expects production_closed=false until all remaining domains close');
  return errors;
}

export async function loadProductScopeInputs(){
  const paths={
    policy:'release/PRODUCT-SCOPE.v1.0.json',
    profile:'docs/production/PRODUCTION-PROFILE.json',
    rootPackage:'package.json',
    releasePolicy:'release/RELEASE-POLICY.v0.1.json',
    scopeDebt:'release/SCOPE-DEBT.v1.0.json',
    claims:'release/PUBLIC-CLAIMS.v1.0.json',
    waivers:'release/CRITICAL-GATE-WAIVERS.v1.0.json',
    ledger:'docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'
  };
  const out={};
  for(const [key,path] of Object.entries(paths))out[key]=JSON.parse(await readFile(resolve(repoRoot,path),'utf8'));
  return out;
}

export async function verifyEvidenceRefs(claims){
  const missing=[];
  for(const claim of claims?.claims??[]){
    for(const ref of claim.evidence??[]){
      if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.@+:-]+)+$/.test(ref))continue;
      try{await access(resolve(repoRoot,ref));}
      catch{missing.push(claim.id+': '+ref);}
    }
  }
  return missing;
}

async function main(){
  const inputs=await loadProductScopeInputs();
  const errors=validateProductScope(inputs);
  errors.push(...(await verifyEvidenceRefs(inputs.claims)).map(x=>'missing evidence ref '+x));
  const receipt={
    schema:'opencontainer.product-scope-verification.v1.0',
    ok:errors.length===0,
    profileId:inputs.policy.profileId,
    coreSurfaces:inputs.policy.coreSurfaceCount,
    oracle:inputs.policy.oracle,
    evidenceProfile:inputs.policy.declaredEvidenceProfile.id,
    supportedBrowserMajor:inputs.policy.declaredEvidenceProfile.browser.major,
    supportedOs:inputs.policy.declaredEvidenceProfile.os,
    scopeDebtEntries:inputs.scopeDebt.entries.length,
    publicClaims:inputs.claims.claims.length,
    criticalGateWaivers:inputs.waivers.waivers.length,
    productionClosed:inputs.ledger.production_closed,
    errors
  };
  await mkdir(resolve(repoRoot,'.artifacts/product-scope'),{recursive:true});
  await writeFile(resolve(repoRoot,'.artifacts/product-scope/contract-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
  if(errors.length)process.exitCode=1;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href)await main();
