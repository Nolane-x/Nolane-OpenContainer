import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256=/^[0-9a-f]{64}$/i;
const commit40=/^[0-9a-f]{40}$/i;
const nonEmpty=value=>typeof value==='string'&&value.trim().length>0;
const isoDate=value=>nonEmpty(value)&&Number.isFinite(Date.parse(value));
const hasAll=(actual,required)=>required.every(x=>actual.includes(x));

function baseErrors(receipt,policy){
  const errors=[];
  if(receipt?.schema!==policy.receiptSchema)errors.push('receipt schema drift');
  const gatePolicy=policy.gates?.[receipt?.gate];
  if(!gatePolicy)errors.push('unsupported external blocker gate');
  if(gatePolicy&&receipt?.kind!==gatePolicy.kind)errors.push('receipt kind does not match gate policy');
  if(!commit40.test(receipt?.sourceCommit??''))errors.push('sourceCommit must be full 40-hex commit');
  if(!isoDate(receipt?.recordedAt))errors.push('recordedAt must be an ISO date');
  if(!nonEmpty(receipt?.actor?.name)||!nonEmpty(receipt?.actor?.role)||!nonEmpty(receipt?.actor?.type))errors.push('named actor/role/type required');
  if(receipt?.actor?.type==='automation'||receipt?.actor?.type==='ai')errors.push('automation/AI cannot act as external authority');
  if(!sha256.test(receipt?.evidenceArtifactSha256??''))errors.push('evidence artifact SHA-256 required');
  if(receipt?.attestation?.confirmedByActor!==true||!nonEmpty(receipt?.attestation?.statement))errors.push('actor attestation required');
  return {errors,gatePolicy};
}
function validateP1_15(data,errors){
  const incidents=Array.isArray(data?.incidents)?data.incidents:[];
  if(incidents.length<1)errors.push('P1-15 requires at least one actual field browser-regression incident');
  for(const [i,row] of incidents.entries()){
    if(!isoDate(row?.observedAt))errors.push('P1-15 incident['+i+'] observedAt missing');
    if(!nonEmpty(row?.environment?.browser)||!nonEmpty(row?.environment?.os))errors.push('P1-15 incident['+i+'] browser/OS identity missing');
    if(!nonEmpty(row?.rootCause))errors.push('P1-15 incident['+i+'] root cause missing');
    if(!nonEmpty(row?.fixOrDisposition))errors.push('P1-15 incident['+i+'] fix/disposition missing');
    if(!nonEmpty(row?.regressionEvidence))errors.push('P1-15 incident['+i+'] retained regression evidence missing');
  }
}
function validateP9_05(data,errors){
  if(!nonEmpty(data?.screenReader?.name)||!nonEmpty(data?.screenReader?.version))errors.push('P9-05 screen reader name/version required');
  if(!nonEmpty(data?.environment?.os)||!nonEmpty(data?.environment?.browser))errors.push('P9-05 OS/browser identity required');
  const scenarios=Array.isArray(data?.scenarios)?data.scenarios:[];
  if(scenarios.length<2)errors.push('P9-05 must cover the two retained screen-reader acceptance scenarios');
  if(scenarios.some(x=>!nonEmpty(x?.id)||x?.result!=='PASS'))errors.push('P9-05 every scenario requires id + PASS');
  if(data?.blockingIssues!==0)errors.push('P9-05 blockingIssues must be zero');
}
function validateP9_11(data,errors){
  if(!Number.isInteger(data?.participantCount)||data.participantCount<1)errors.push('P9-11 participantCount must be >=1');
  const tasks=Array.isArray(data?.tasks)?data.tasks:[];
  if(tasks.length<1)errors.push('P9-11 human comprehension tasks required');
  if(tasks.some(x=>!nonEmpty(x?.id)||x?.passed!==true))errors.push('P9-11 every retained task must have id + passed=true');
  if(data?.blockingIssues!==0)errors.push('P9-11 blockingIssues must be zero');
}
function validateP12_17(data,errors){
  if(data?.channel?.private!==true||!nonEmpty(data?.channel?.provider))errors.push('P12-17 verified private channel required');
  if(data?.verification?.liveTest!==true||!nonEmpty(data?.verification?.method)||!nonEmpty(data?.verification?.performedBy)||!isoDate(data?.verification?.verifiedAt))errors.push('P12-17 independent live verification required');
}
function validateP12_18(data,errors){
  if(data?.reviewerIndependentOrSecondParty!==true)errors.push('P12-18 independent/second-party reviewer required');
  const scope=Array.isArray(data?.scope)?data.scope:[];
  if(!hasAll(scope,['isolation','storage','network']))errors.push('P12-18 scope must include isolation/storage/network');
  if(data?.releaseBlockingFindings!==0)errors.push('P12-18 releaseBlockingFindings must be zero');
}
function validateP12_20(data,errors){
  if(data?.humanReview!==true)errors.push('P12-20 human review flag required');
  if(!nonEmpty(data?.reviewScope))errors.push('P12-20 review scope required');
  if(data?.releaseBlockingFindings!==0)errors.push('P12-20 releaseBlockingFindings must be zero');
}
function validateP13_03(data,errors){
  if(data?.provider!=='npm'||data?.package!=='@nolane/opencontainer')errors.push('P13-03 npm package identity drift');
  if(data?.oidc!==true||data?.longLivedPublishToken!==false)errors.push('P13-03 trusted OIDC publishing without long-lived token required');
  if(data?.repository!=='Nolane-x/Nolane-OpenContainer')errors.push('P13-03 repository identity drift');
  if(!/^\.github\/workflows\/.+\.ya?ml$/.test(String(data?.workflowPath??'')))errors.push('P13-03 trusted publishing workflow path required');
}
function validateP13_17(data,errors){
  for(const key of ['branchProtectionReviewed','tagProtectionReviewed','releaseProtectionReviewed'])if(data?.[key]!==true)errors.push('P13-17 '+key+' required');
  if(!sha256.test(data?.settingsSnapshotSha256??''))errors.push('P13-17 settings snapshot digest required');
}
function validateP16_01(data,errors){
  if(data?.decisionRecorded!==true)errors.push('P16-01 final license decision must be recorded');
  if(!/^[A-Za-z0-9.+-]{2,64}$/.test(String(data?.spdxLicenseId??'')))errors.push('P16-01 SPDX license id required');
  if(!nonEmpty(data?.approvalRole))errors.push('P16-01 approval role required');
  if(data?.rootDistributionLicenseMatchesDecision!==true)errors.push('P16-01 root distribution license must match decision');
}
function validateP16_05(data,errors){
  if(!nonEmpty(data?.counsel?.name)||!nonEmpty(data?.counsel?.organization))errors.push('P16-05 named counsel required');
  const jurisdictions=Array.isArray(data?.jurisdictions)?data.jurisdictions:[];
  if(jurisdictions.length<1||jurisdictions.some(x=>!nonEmpty(x)))errors.push('P16-05 jurisdiction list required');
  const areas=Array.isArray(data?.areas)?data.areas:[];
  if(!hasAll(areas,['preview','network','storage','runtime topology']))errors.push('P16-05 review areas incomplete');
  if(!['CLEARED','CLEARED_WITH_CONDITIONS','BLOCKED'].includes(data?.outcome))errors.push('P16-05 counsel outcome invalid');
}
const validators={
  'P1-15':validateP1_15,
  'P9-05':validateP9_05,
  'P9-11':validateP9_11,
  'P12-17':validateP12_17,
  'P12-18':validateP12_18,
  'P12-20':validateP12_20,
  'P13-03':validateP13_03,
  'P13-17':validateP13_17,
  'P16-01':validateP16_01,
  'P16-05':validateP16_05
};

export function repositoryAlignment(gate,receipt,repoState){
  const reasons=[];
  if(gate==='P12-17'&&repoState.security?.reviewStatus?.verifiedPrivateDisclosureChannel!==true)reasons.push('security policy has not recorded verified private disclosure channel');
  if(gate==='P12-18'&&repoState.security?.reviewStatus?.independentSecondPartyReviewCompleted!==true)reasons.push('security policy has not recorded second-party review completion');
  if(gate==='P12-20'&&repoState.security?.reviewStatus?.humanSecurityReviewCompleted!==true)reasons.push('security policy has not recorded human security review completion');
  if(gate==='P13-03'&&repoState.supply?.gateAuthority?.['P13-03']?.state==='OPEN_EXTERNAL')reasons.push('supply-chain policy still marks trusted publisher OPEN_EXTERNAL');
  if(gate==='P13-17'&&repoState.supply?.gateAuthority?.['P13-17']?.state==='OPEN_EXTERNAL')reasons.push('supply-chain policy still marks repository protection OPEN_EXTERNAL');
  if(gate==='P16-01'){
    if(repoState.legal?.projectLicense?.finalLicenseFrozen!==true)reasons.push('P16 policy finalLicenseFrozen is not true');
    if(repoState.legal?.projectLicense?.state==='OPEN_EXTERNAL')reasons.push('P16 license state remains OPEN_EXTERNAL');
    if(repoState.distributionSource?.includes("license:'UNLICENSED'"))reasons.push('distribution builder still emits UNLICENSED');
    const decided=receipt?.data?.spdxLicenseId;
    if(decided&&repoState.legal?.projectLicense?.rootDistributionLicense!==decided)reasons.push('P16 policy rootDistributionLicense does not match receipt decision');
  }
  if(gate==='P16-05'){
    if(repoState.legal?.fto?.decisionRecorded!==true)reasons.push('P16 policy FTO decisionRecorded is not true');
    if(repoState.legal?.fto?.state==='OPEN_EXTERNAL')reasons.push('P16 FTO state remains OPEN_EXTERNAL');
  }
  return {ok:reasons.length===0,reasons};
}

export function validateExternalBlockerReceipt(receipt,{policy,repoState}){
  const {errors,gatePolicy}=baseErrors(receipt,policy);
  if(gatePolicy)validators[receipt.gate]?.(receipt.data,errors);
  const structural=errors.length===0;
  const alignment=structural?repositoryAlignment(receipt.gate,receipt,repoState):{ok:false,reasons:['structural receipt validation failed']};
  let candidateGateState=structural&&alignment.ok?'READY_FOR_REVIEW':'BLOCKED';
  if(receipt?.gate==='P16-05'&&receipt?.data?.outcome==='BLOCKED')candidateGateState='BLOCKED_BY_COUNSEL';
  return {
    schema:'opencontainer.external-blocker-verification.v1.0',
    gate:receipt?.gate??null,
    kind:receipt?.kind??null,
    structuralValid:structural,
    repositoryStateAligned:alignment.ok,
    candidateGateState,
    closureEligible:false,
    autoPromotionAllowed:false,
    errors,
    repositoryAlignmentErrors:alignment.reasons,
    productionClosed:false
  };
}
export function validateReceiptPath(path){
  const value=String(path??'').replaceAll('\\','/');
  if(!/^release\/external-evidence\/[A-Za-z0-9._-]+\.json$/.test(value))return false;
  return !value.includes('..');
}
async function readJson(path){return JSON.parse(await readFile(resolve(path),'utf8'));}
async function main(){
  const arg=process.argv.find(x=>x.startsWith('--receipt='));
  if(!arg)throw new Error('--receipt=<path> required');
  const receiptPath=arg.slice('--receipt='.length);
  if(!validateReceiptPath(receiptPath))throw new Error('receipt path must be release/external-evidence/<name>.json');
  const receipt=await readJson(receiptPath);
  const [policy,security,supply,legal,distributionSource]=await Promise.all([
    readJson('release/FINAL-EXTERNAL-BLOCKER-POLICY.v1.0.json'),
    readJson('release/SECURITY-REVIEW-POLICY.v1.0.json'),
    readJson('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json'),
    readJson('release/P16-LEGAL-GOVERNANCE-POLICY.v1.0.json'),
    readFile(resolve('scripts/build-distribution.mjs'),'utf8')
  ]);
  const result=validateExternalBlockerReceipt(receipt,{policy,repoState:{security,supply,legal,distributionSource}});
  const output=resolve(process.argv.find(x=>x.startsWith('--output='))?.slice('--output='.length)??'.artifacts/external-blocker/verification.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log('EXTERNAL BLOCKER RECEIPT '+(result.structuralValid?'STRUCTURAL-PASS':'FAIL')+' '+JSON.stringify({gate:result.gate,candidateGateState:result.candidateGateState,closureEligible:false}));
  if(!result.structuralValid||!result.repositoryStateAligned||result.candidateGateState!=='READY_FOR_REVIEW')process.exitCode=1;
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
