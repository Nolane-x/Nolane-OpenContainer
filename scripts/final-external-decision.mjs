import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDistribution } from './build-distribution.mjs';

const sha256Pattern=/^[0-9a-f]{64}$/i;
const commitPattern=/^[0-9a-f]{40}$/i;
const nonEmpty=value=>typeof value==='string'&&value.trim().length>0;
const isoDate=value=>nonEmpty(value)&&Number.isFinite(Date.parse(value));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hasAll=(actual,required)=>required.every(x=>actual.includes(x));

export function validateDecisionReceiptPath(path){
  const value=String(path??'').replaceAll('\\','/');
  return /^release\/external-evidence\/[A-Za-z0-9._-]+\.json$/.test(value)&&!value.includes('..');
}

function baseErrors(receipt,policy){
  const errors=[];
  if(receipt?.schema!==policy.receiptSchema)errors.push('receipt schema drift');
  const gatePolicy=policy.gates?.[receipt?.gate];
  if(!gatePolicy)errors.push('unsupported final external-decision gate');
  if(gatePolicy&&receipt?.kind!==gatePolicy.kind)errors.push('receipt kind does not match gate policy');
  if(!commitPattern.test(receipt?.sourceCommit??''))errors.push('sourceCommit must be full 40-hex commit');
  if(!isoDate(receipt?.recordedAt))errors.push('recordedAt must be ISO date');
  if(!nonEmpty(receipt?.actor?.id)||!nonEmpty(receipt?.actor?.role)||!nonEmpty(receipt?.actor?.type))errors.push('actor id/role/type required');
  if((policy.forbiddenActorTypes??[]).includes(receipt?.actor?.type))errors.push('automation/AI cannot act as final external authority');
  if(!sha256Pattern.test(receipt?.evidenceArtifactSha256??''))errors.push('external evidence artifact SHA-256 required');
  if(receipt?.attestation?.confirmedByActor!==true||!nonEmpty(receipt?.attestation?.statement))errors.push('actor attestation required');
  return {errors,gatePolicy};
}

function validateP1_15(data,errors){
  const incidents=Array.isArray(data?.incidents)?data.incidents:[];
  if(incidents.length<1)errors.push('P1-15 requires at least one real field browser-regression incident');
  for(const [i,row] of incidents.entries()){
    if(!isoDate(row?.observedAt))errors.push('P1-15 incident['+i+'] observedAt missing');
    if(!nonEmpty(row?.affectedVersion))errors.push('P1-15 incident['+i+'] affectedVersion missing');
    if(!nonEmpty(row?.environment?.browser)||!nonEmpty(row?.environment?.os))errors.push('P1-15 incident['+i+'] browser/OS identity missing');
    if(!nonEmpty(row?.rootCause))errors.push('P1-15 incident['+i+'] rootCause missing');
    if(!nonEmpty(row?.fixOrDisposition))errors.push('P1-15 incident['+i+'] fix/disposition missing');
    if(!/^tests\/[A-Za-z0-9._/-]+\.test\.js$/.test(String(row?.regressionPath??'')))errors.push('P1-15 incident['+i+'] regressionPath must be retained tests/*.test.js');
    if(!sha256Pattern.test(row?.regressionSha256??''))errors.push('P1-15 incident['+i+'] regression SHA-256 missing');
  }
}
function validateP13_03(data,errors){
  if(data?.provider!=='npm'||data?.package!=='@nolane/opencontainer')errors.push('P13-03 npm package identity drift');
  if(data?.repository!=='Nolane-x/Nolane-OpenContainer')errors.push('P13-03 repository identity drift');
  if(data?.trustedPublisher!==true||data?.oidc!==true||data?.longLivedPublishToken!==false)errors.push('P13-03 requires trusted OIDC publisher with no long-lived token');
  if(!/^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/.test(String(data?.workflowPath??'')))errors.push('P13-03 publishing workflow path invalid');
  if(!sha256Pattern.test(data?.workflowSha256??''))errors.push('P13-03 publishing workflow SHA-256 required');
  if(!sha256Pattern.test(data?.configurationSnapshotSha256??''))errors.push('P13-03 admin configuration snapshot SHA-256 required');
  if(!isoDate(data?.configuredAt))errors.push('P13-03 configuredAt missing');
}
function validateP16_01(data,errors){
  if(data?.decisionRecorded!==true)errors.push('P16-01 final license decision must be recorded');
  if(!/^[A-Za-z0-9.+-]{2,64}$/.test(String(data?.spdxLicenseId??'')))errors.push('P16-01 SPDX license id required');
  if(!/^LICENSE(?:\.[A-Za-z0-9._-]+)?$/.test(String(data?.rootLicensePath??'')))errors.push('P16-01 root license path must be repository-root LICENSE*');
  if(!sha256Pattern.test(data?.rootLicenseSha256??''))errors.push('P16-01 root LICENSE SHA-256 required');
  if(!sha256Pattern.test(data?.decisionArtifactSha256??''))errors.push('P16-01 decision artifact SHA-256 required');
  if(!isoDate(data?.approvedAt))errors.push('P16-01 approvedAt missing');
}
function validateP16_05(data,errors){
  if(!nonEmpty(data?.counsel?.organization)||!nonEmpty(data?.counsel?.role))errors.push('P16-05 counsel organization/role required');
  const jurisdictions=Array.isArray(data?.jurisdictions)?data.jurisdictions:[];
  if(jurisdictions.length<1||jurisdictions.some(x=>!nonEmpty(x)))errors.push('P16-05 jurisdiction list required');
  const areas=Array.isArray(data?.areas)?data.areas:[];
  if(!hasAll(areas,['preview','network','storage','runtime topology']))errors.push('P16-05 review areas incomplete');
  if(!['CLEARED','CLEARED_WITH_CONDITIONS','BLOCKED'].includes(data?.outcome))errors.push('P16-05 counsel outcome invalid');
  if(!sha256Pattern.test(data?.reviewArtifactSha256??''))errors.push('P16-05 retained review artifact SHA-256 required');
  if(!isoDate(data?.reviewedAt))errors.push('P16-05 reviewedAt missing');
}

const validators={'P1-15':validateP1_15,'P13-03':validateP13_03,'P16-01':validateP16_01,'P16-05':validateP16_05};

export function validateFinalExternalDecisionReceipt(receipt,{policy,repoState}){
  const {errors,gatePolicy}=baseErrors(receipt,policy);
  if(gatePolicy)validators[receipt.gate]?.(receipt.data,errors);
  const alignmentErrors=[];
  if(receipt?.sourceCommit!==repoState.headCommit)alignmentErrors.push('receipt sourceCommit does not match checked-out HEAD');

  if(receipt?.gate==='P1-15'&&errors.length===0){
    for(const [i,row] of receipt.data.incidents.entries()){
      const actual=repoState.files?.[row.regressionPath]?.sha256;
      if(!actual)alignmentErrors.push('P1-15 incident['+i+'] retained regression file missing');
      else if(actual!==row.regressionSha256)alignmentErrors.push('P1-15 incident['+i+'] regression SHA-256 drift');
    }
  }

  if(receipt?.gate==='P13-03'&&errors.length===0){
    const authority=repoState.supply?.gateAuthority?.['P13-03'];
    if(!authority||authority.state==='OPEN_EXTERNAL')alignmentErrors.push('P13-03 supply-chain policy still records OPEN_EXTERNAL');
    const actual=repoState.files?.[receipt.data.workflowPath]?.sha256;
    if(!actual)alignmentErrors.push('P13-03 publishing workflow missing from checked-out source');
    else if(actual!==receipt.data.workflowSha256)alignmentErrors.push('P13-03 publishing workflow SHA-256 drift');
  }

  if(receipt?.gate==='P16-01'&&errors.length===0){
    const legal=repoState.legal;
    const spdx=receipt.data.spdxLicenseId;
    if(legal?.projectLicense?.finalLicenseFrozen!==true)alignmentErrors.push('P16-01 finalLicenseFrozen is not true');
    if(legal?.projectLicense?.state==='OPEN_EXTERNAL')alignmentErrors.push('P16-01 legal policy remains OPEN_EXTERNAL');
    if(legal?.projectLicense?.rootDistributionLicense!==spdx)alignmentErrors.push('P16-01 legal policy distribution license does not match decision');
    const actualLicense=repoState.files?.[receipt.data.rootLicensePath]?.sha256;
    if(!actualLicense)alignmentErrors.push('P16-01 root LICENSE file missing');
    else if(actualLicense!==receipt.data.rootLicenseSha256)alignmentErrors.push('P16-01 root LICENSE SHA-256 drift');
    if(repoState.distributionLicense!==spdx)alignmentErrors.push('P16-01 actual built distribution license does not match decision');
  }

  if(receipt?.gate==='P16-05'&&errors.length===0){
    const fto=repoState.legal?.fto;
    if(fto?.decisionRecorded!==true)alignmentErrors.push('P16-05 legal policy has no recorded counsel decision');
    if(fto?.state==='OPEN_EXTERNAL')alignmentErrors.push('P16-05 legal policy remains OPEN_EXTERNAL');
    if(Array.isArray(fto?.areas)&&!hasAll(receipt.data.areas,fto.areas))alignmentErrors.push('P16-05 receipt does not cover all legal-policy FTO areas');
  }

  const structuralValid=errors.length===0;
  const repositoryStateAligned=structuralValid&&alignmentErrors.length===0;
  let candidateGateState=repositoryStateAligned?'READY_FOR_REVIEW':'BLOCKED';
  if(receipt?.gate==='P16-05'&&receipt?.data?.outcome==='BLOCKED')candidateGateState='BLOCKED_BY_COUNSEL';
  return {
    schema:'opencontainer.final-external-decision-verification.v1.0',
    gate:receipt?.gate??null,
    kind:receipt?.kind??null,
    structuralValid,
    repositoryStateAligned,
    candidateGateState,
    closureEligible:false,
    autoPromotionAllowed:false,
    errors,
    repositoryAlignmentErrors:alignmentErrors,
    productionClosed:false
  };
}

async function fileEntry(path){
  try{const bytes=await readFile(resolve(path));return {sha256:hash(bytes)};}catch{return null;}
}
function headCommit(){
  const r=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
  if(r.status!==0)throw new Error('cannot resolve git HEAD');
  return String(r.stdout).trim();
}
async function inspectDistributionLicense(){
  const temp=resolve('.artifacts/final-external-decision/distribution');
  await rm(temp,{recursive:true,force:true});
  const built=await buildDistribution({outputDir:temp});
  const tar=spawnSync('tar',['-xOf',built.tarballPath,'package/package.json'],{encoding:'utf8'});
  if(tar.status!==0)throw new Error('cannot inspect built distribution package.json: '+String(tar.stderr??''));
  const manifest=JSON.parse(tar.stdout);
  return {license:manifest.license??null,build:built};
}
async function readJson(path){return JSON.parse(await readFile(resolve(path),'utf8'));}

async function main(){
  const receiptArg=process.argv.find(x=>x.startsWith('--receipt='));
  if(!receiptArg)throw new Error('--receipt=<release/external-evidence/*.json> required');
  const receiptPath=receiptArg.slice('--receipt='.length);
  if(!validateDecisionReceiptPath(receiptPath))throw new Error('receipt path must stay under release/external-evidence/*.json');
  const receipt=await readJson(receiptPath);
  const [policy,supply,legal]=await Promise.all([
    readJson('release/FINAL-EXTERNAL-DECISION-POLICY.v1.0.json'),
    readJson('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json'),
    readJson('release/P16-LEGAL-GOVERNANCE-POLICY.v1.0.json')
  ]);
  const files={};
  if(receipt.gate==='P1-15')for(const row of receipt.data?.incidents??[])files[row.regressionPath]=await fileEntry(row.regressionPath);
  if(receipt.gate==='P13-03')files[receipt.data?.workflowPath]=await fileEntry(receipt.data?.workflowPath);
  if(receipt.gate==='P16-01')files[receipt.data?.rootLicensePath]=await fileEntry(receipt.data?.rootLicensePath);
  let distributionLicense=null;
  let distributionBuild=null;
  if(receipt.gate==='P16-01'){
    const inspected=await inspectDistributionLicense();
    distributionLicense=inspected.license;
    distributionBuild=inspected.build;
  }
  const result=validateFinalExternalDecisionReceipt(receipt,{policy,repoState:{
    headCommit:headCommit(),supply,legal,files,distributionLicense
  }});
  result.distributionBuild=distributionBuild?{
    version:distributionBuild.version,sha256:distributionBuild.sha256,sha512:distributionBuild.sha512,license:distributionLicense
  }:null;
  const output=resolve(process.argv.find(x=>x.startsWith('--output='))?.slice('--output='.length)??'.artifacts/final-external-decision/verification.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log('FINAL EXTERNAL DECISION '+(result.structuralValid?'STRUCTURAL-PASS':'FAIL')+' '+JSON.stringify({
    gate:result.gate,candidateGateState:result.candidateGateState,closureEligible:false
  }));
  if(!result.structuralValid||!result.repositoryStateAligned||result.candidateGateState!=='READY_FOR_REVIEW')process.exitCode=1;
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
