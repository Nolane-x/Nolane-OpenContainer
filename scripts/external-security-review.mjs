import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_INDEPENDENT_SCOPE=['isolation','storage','network'];

function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
function privateIpv4(address){
  const p=address.split('.').map(Number);
  if(p.length!==4)return true;
  return p[0]===10||p[0]===127||p[0]===0||
    (p[0]===169&&p[1]===254)||
    (p[0]===172&&p[1]>=16&&p[1]<=31)||
    (p[0]===192&&p[1]===168)||
    (p[0]===100&&p[1]>=64&&p[1]<=127);
}
function privateIpv6(address){
  const x=address.toLowerCase();
  return x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||
    x.startsWith('fe8')||x.startsWith('fe9')||x.startsWith('fea')||x.startsWith('feb');
}
function publicAddress(address){
  const family=isIP(address);
  if(family===4)return !privateIpv4(address);
  if(family===6)return !privateIpv6(address);
  return false;
}
export function validateExternalReviewArtifact(artifact,{expectedType,expectedCommit}={}){
  const errors=[];
  if(artifact?.schema!=='opencontainer.external-security-review.v1.0')errors.push('review schema drift');
  if(artifact?.reviewType!==expectedType)errors.push('review type drift');
  if(artifact?.sourceCommit!==expectedCommit)errors.push('review source commit drift');
  if(!/^[0-9a-f]{40}$/i.test(String(artifact?.sourceCommit??'')))errors.push('review source commit invalid');
  if(artifact?.reviewer?.human!==true)errors.push('reviewer must be human');
  if(typeof artifact?.reviewer?.id!=='string'||artifact.reviewer.id.trim().length<2)errors.push('reviewer id missing');
  if(typeof artifact?.issuedAt!=='string'||Number.isNaN(Date.parse(artifact.issuedAt)))errors.push('review issuedAt invalid');
  if(!Array.isArray(artifact?.scope))errors.push('review scope missing');
  const findingRows=Array.isArray(artifact?.findings)?artifact.findings:[];
  const unresolvedHigh=findingRows.filter(x=>['CRITICAL','HIGH'].includes(String(x?.severity).toUpperCase())&&!['RESOLVED','ACCEPTED'].includes(String(x?.status).toUpperCase()));
  if(unresolvedHigh.length)errors.push('unresolved critical/high findings remain');

  if(expectedType==='independent-security-review'){
    if(artifact?.reviewer?.independentFromProject!==true)errors.push('independent review requires independent reviewer');
    const scope=new Set(artifact?.scope??[]);
    for(const area of REQUIRED_INDEPENDENT_SCOPE)if(!scope.has(area))errors.push('independent review missing scope '+area);
  }
  if(expectedType==='human-product-security-review'){
    if(artifact?.reviewedProductSecurity!==true)errors.push('human product-security review flag missing');
  }
  if(!['PASS','PASS_WITH_ACCEPTED_RISKS'].includes(artifact?.conclusion))errors.push('review conclusion must be PASS or PASS_WITH_ACCEPTED_RISKS');
  return errors;
}
async function assertPublicHttps(url){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:')throw new Error('review artifact URL must use HTTPS');
  if(parsed.username||parsed.password)throw new Error('review artifact URL must not contain credentials');
  if(parsed.hostname==='localhost'||isIP(parsed.hostname))throw new Error('review artifact URL must use a public DNS hostname');
  const rows=await lookup(parsed.hostname,{all:true,verbatim:true});
  if(!rows.length||rows.some(x=>!publicAddress(x.address)))throw new Error('review artifact hostname resolved to non-public address');
  return parsed;
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  const reviewType=args.type;
  const sourceCommit=args['source-commit'];
  const expectedSha256=String(args.sha256??'').toLowerCase();
  const url=await assertPublicHttps(args.url);
  const output=resolve(args.output??'.artifacts/external-security-review/receipt.json');

  if(!['independent-security-review','human-product-security-review'].includes(reviewType))throw new Error('unsupported review type');
  if(!/^[0-9a-f]{40}$/i.test(String(sourceCommit??'')))throw new Error('source-commit must be full 40-hex SHA');
  if(!/^[0-9a-f]{64}$/.test(expectedSha256))throw new Error('sha256 must be full 64-hex digest');

  const response=await fetch(url,{cache:'no-store',redirect:'error'});
  if(!response.ok)throw new Error('review artifact fetch failed '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.byteLength>2*1024*1024)throw new Error('review artifact exceeds 2 MiB limit');
  const actualSha256=createHash('sha256').update(bytes).digest('hex');
  if(actualSha256!==expectedSha256)throw new Error('review artifact SHA-256 mismatch');
  let artifact;
  try{artifact=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('review artifact must be JSON');}
  const errors=validateExternalReviewArtifact(artifact,{expectedType:reviewType,expectedCommit:sourceCommit});
  if(errors.length)throw new Error('external review artifact invalid: '+errors.join('; '));

  const candidateGateState=reviewType==='independent-security-review'
    ? {'P12-18':'READY_FOR_REVIEW','P12-20':'BLOCKED_SEPARATE_HUMAN_PRODUCT_SECURITY_REVIEW'}
    : {'P12-18':'BLOCKED_SEPARATE_INDEPENDENT_REVIEW','P12-20':'READY_FOR_REVIEW'};

  const receipt={
    schema:'opencontainer.external-security-review-receipt.v1.0',
    status:'PASS',
    reviewType,
    sourceCommit,
    artifact:{url:url.href,sha256:actualSha256,bytes:bytes.byteLength,issuedAt:artifact.issuedAt},
    reviewer:{id:artifact.reviewer.id,human:true,independentFromProject:artifact.reviewer.independentFromProject===true},
    scope:artifact.scope,
    conclusion:artifact.conclusion,
    findings:{total:Array.isArray(artifact.findings)?artifact.findings.length:0,unresolvedCriticalHigh:0},
    candidateGateState,
    closureEligible:false,
    closureReason:'A validated external human review artifact is candidate evidence only. P12-18/P12-20 remain non-machine-closable and require explicit human reconciliation.',
    productionClosed:false
  };
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
  console.log('EXTERNAL SECURITY REVIEW PASS '+JSON.stringify({reviewType,sourceCommit,reviewer:artifact.reviewer.id,closureEligible:false}));
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
