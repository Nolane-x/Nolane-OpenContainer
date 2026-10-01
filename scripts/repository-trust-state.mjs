import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO='Nolane-x/Nolane-OpenContainer';

function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
async function github(path,token){
  const response=await fetch('https://api.github.com/repos/'+REPO+path,{
    headers:{
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      Authorization:'Bearer '+token
    }
  });
  const text=await response.text();
  let body=null;
  try{body=text?JSON.parse(text):null;}catch{body={raw:text};}
  return {status:response.status,ok:response.ok,body};
}
export function assessRepositoryTrustState({privateVulnerability,branchProtection,rulesets}){
  const privateEnabled=privateVulnerability?.ok===true&&privateVulnerability?.body?.enabled===true;
  const branchProtectionReadable=branchProtection?.ok===true;
  const rulesetsReadable=rulesets?.ok===true&&Array.isArray(rulesets?.body);
  const rulesetCount=rulesetsReadable?rulesets.body.length:0;
  const anyProtectionObserved=branchProtectionReadable||rulesetCount>0;
  return {
    privateVulnerabilityReporting:{
      enabled:privateEnabled,
      readable:privateVulnerability?.ok===true,
      httpStatus:privateVulnerability?.status??null
    },
    repositoryProtection:{
      branchProtectionReadable,
      rulesetsReadable,
      rulesetCount,
      anyProtectionObserved,
      branchProtection:branchProtectionReadable?branchProtection.body:null,
      rulesets:rulesetsReadable?rulesets.body:null
    },
    candidateGateState:{
      'P12-17':privateEnabled?'READY_FOR_REVIEW':'BLOCKED_PRIVATE_CHANNEL_NOT_VERIFIED',
      'P13-17':anyProtectionObserved?'STATE_CAPTURED_REQUIRES_POLICY_REVIEW':'BLOCKED_REPOSITORY_PROTECTION_NOT_OBSERVED'
    },
    closureEligible:false,
    productionClosed:false
  };
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  const token=process.env.OPENCONTAINER_REPO_ADMIN_READ_TOKEN;
  if(!token)throw new Error('OPENCONTAINER_REPO_ADMIN_READ_TOKEN is required');
  const output=resolve(args.output??'.artifacts/repository-trust/receipt.json');

  const [privateVulnerability,branchProtection,rulesets]=await Promise.all([
    github('/private-vulnerability-reporting',token),
    github('/branches/main/protection',token),
    github('/rulesets?includes_parents=true&per_page=100',token)
  ]);
  const assessment=assessRepositoryTrustState({privateVulnerability,branchProtection,rulesets});
  if(privateVulnerability.status===401||privateVulnerability.status===403)throw new Error('admin-read token cannot read private vulnerability reporting state');
  if(branchProtection.status===401||branchProtection.status===403)throw new Error('admin-read token cannot read branch protection state');
  if(rulesets.status===401||rulesets.status===403)throw new Error('admin-read token cannot read repository rulesets');

  const receipt={
    schema:'opencontainer.repository-trust-state.v1.0',
    status:'PASS',
    repository:REPO,
    sourceCommit:process.env.GITHUB_SHA??null,
    workflowRunId:process.env.GITHUB_RUN_ID??null,
    observedAt:new Date().toISOString(),
    assessment,
    rawHttpStatus:{
      privateVulnerability:privateVulnerability.status,
      branchProtection:branchProtection.status,
      rulesets:rulesets.status
    },
    boundaries:{
      tokenValueRetained:false,
      branchProtectionSufficiencyClaimed:false,
      repositoryProtectionGateClosed:false,
      productionClosed:false
    }
  };
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
  console.log('REPOSITORY TRUST STATE PASS '+JSON.stringify({
    privateVulnerabilityEnabled:assessment.privateVulnerabilityReporting.enabled,
    branchProtectionReadable:assessment.repositoryProtection.branchProtectionReadable,
    rulesetCount:assessment.repositoryProtection.rulesetCount,
    closureEligible:false
  }));
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
