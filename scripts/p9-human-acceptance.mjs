import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREEN_READER_TASKS=[
  'startup-status-and-main-landmarks',
  'view-navigation-preview-inspect-ai',
  'modal-dialog-focus-and-dismissal',
  'editor-save-acknowledgement',
  'process-output-and-recovery',
  'linked-folder-permission-or-conflict-state'
];
const COMPREHENSION_SCENARIOS=[
  'primary-action',
  'failure-state',
  'recovery-guidance',
  'permission-or-conflict',
  'destructive-or-high-impact-action'
];
const bannedParticipantKeys=new Set(['name','email','phone','address','fullName','realName']);

function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
function privateIpv4(address){
  const p=address.split('.').map(Number);
  if(p.length!==4)return true;
  return p[0]===10||p[0]===127||p[0]===0||(p[0]===169&&p[1]===254)||
    (p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168)||(p[0]===100&&p[1]>=64&&p[1]<=127);
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
async function publicHttpsUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:')throw new Error('human evidence URL must use HTTPS');
  if(url.username||url.password)throw new Error('human evidence URL must not contain credentials');
  if(url.hostname==='localhost'||isIP(url.hostname))throw new Error('human evidence URL must use public DNS');
  const rows=await lookup(url.hostname,{all:true,verbatim:true});
  if(!rows.length||rows.some(x=>!publicAddress(x.address)))throw new Error('human evidence hostname resolved non-public address');
  return url;
}
function validDate(value){return typeof value==='string'&&!Number.isNaN(Date.parse(value));}
function requireHumanEvaluator(artifact,errors){
  if(artifact?.evaluator?.human!==true)errors.push('evaluator must be human');
  if(typeof artifact?.evaluator?.id!=='string'||artifact.evaluator.id.trim().length<2)errors.push('evaluator id missing');
}
function validateScreenReader(artifact,errors){
  requireHumanEvaluator(artifact,errors);
  const sr=artifact?.environment?.screenReader;
  const browser=artifact?.environment?.browser;
  const os=artifact?.environment?.os;
  for(const [label,value] of [['screenReader',sr],['browser',browser],['os',os]]){
    if(typeof value?.name!=='string'||!value.name.trim())errors.push(label+' name missing');
    if(typeof value?.version!=='string'||!value.version.trim())errors.push(label+' version missing');
  }
  const results=Array.isArray(artifact?.taskResults)?artifact.taskResults:[];
  const byId=new Map(results.map(x=>[x?.id,x]));
  for(const task of SCREEN_READER_TASKS){
    const row=byId.get(task);
    if(!row)errors.push('screen-reader task missing '+task);
    else if(row.status!=='PASS')errors.push('screen-reader task did not PASS '+task);
  }
}
function validateParticipantPrivacy(participant,index,errors){
  if(typeof participant?.id!=='string'||participant.id.trim().length<2)errors.push('participant['+index+'] pseudonymous id missing');
  for(const key of Object.keys(participant??{})){
    if(bannedParticipantKeys.has(key))errors.push('participant['+index+'] contains forbidden direct-identity key '+key);
  }
}
function validateComprehension(artifact,errors){
  requireHumanEvaluator(artifact,errors);
  const participants=Array.isArray(artifact?.participants)?artifact.participants:[];
  if(participants.length<5)errors.push('human comprehension requires at least 5 participants');
  const ids=new Set();
  let correct=0,total=0,criticalMisinterpretations=0;
  for(const [index,participant] of participants.entries()){
    validateParticipantPrivacy(participant,index,errors);
    if(participant?.id)ids.add(participant.id);
    if(participant?.human!==true)errors.push('participant['+index+'] must be human');
    const rows=Array.isArray(participant?.scenarioResults)?participant.scenarioResults:[];
    const byClass=new Map(rows.map(x=>[x?.scenarioClass,x]));
    for(const scenarioClass of COMPREHENSION_SCENARIOS){
      const row=byClass.get(scenarioClass);
      if(!row)errors.push('participant['+index+'] missing scenario '+scenarioClass);
      else{
        total+=1;
        if(row.correct===true)correct+=1;
        if(row.criticalMisinterpretation===true)criticalMisinterpretations+=1;
      }
    }
  }
  if(ids.size!==participants.length)errors.push('participant ids must be unique');
  const accuracy=total?correct/total:0;
  if(accuracy<0.8)errors.push('overall comprehension accuracy below 0.8');
  if(criticalMisinterpretations!==0)errors.push('critical misinterpretations must be zero');
  return {participants:participants.length,correct,total,accuracy,criticalMisinterpretations};
}
export function validateP9HumanArtifact(artifact,{expectedType,expectedCommit}={}){
  const errors=[];
  let metrics=null;
  if(artifact?.schema!=='opencontainer.p9-human-acceptance.v1.0')errors.push('human acceptance schema drift');
  if(artifact?.evidenceType!==expectedType)errors.push('human acceptance evidence type drift');
  if(artifact?.sourceCommit!==expectedCommit)errors.push('human acceptance source commit drift');
  if(!/^[0-9a-f]{40}$/i.test(String(artifact?.sourceCommit??'')))errors.push('source commit invalid');
  if(!validDate(artifact?.issuedAt))errors.push('issuedAt invalid');
  if(artifact?.conclusion!=='PASS')errors.push('human acceptance conclusion must be PASS');

  if(expectedType==='manual-screen-reader')validateScreenReader(artifact,errors);
  else if(expectedType==='human-comprehension')metrics=validateComprehension(artifact,errors);
  else errors.push('unsupported human acceptance evidence type');

  return {errors,metrics};
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  const evidenceType=args.type;
  const sourceCommit=args['source-commit'];
  const expectedSha256=String(args.sha256??'').toLowerCase();
  const url=await publicHttpsUrl(args.url);
  const output=resolve(args.output??'.artifacts/p9-human-acceptance/receipt.json');
  if(!['manual-screen-reader','human-comprehension'].includes(evidenceType))throw new Error('unsupported evidence type');
  if(!/^[0-9a-f]{40}$/i.test(String(sourceCommit??'')))throw new Error('source-commit must be full 40-hex SHA');
  if(!/^[0-9a-f]{64}$/.test(expectedSha256))throw new Error('sha256 must be full 64-hex digest');

  const response=await fetch(url,{cache:'no-store',redirect:'error'});
  if(!response.ok)throw new Error('human evidence fetch failed '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.byteLength>2*1024*1024)throw new Error('human evidence exceeds 2 MiB limit');
  const actualSha256=createHash('sha256').update(bytes).digest('hex');
  if(actualSha256!==expectedSha256)throw new Error('human evidence SHA-256 mismatch');
  let artifact;
  try{artifact=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('human evidence must be JSON');}
  const validation=validateP9HumanArtifact(artifact,{expectedType:evidenceType,expectedCommit:sourceCommit});
  if(validation.errors.length)throw new Error('P9 human evidence invalid: '+validation.errors.join('; '));

  const candidateGateState=evidenceType==='manual-screen-reader'
    ? {'P9-05':'READY_FOR_REVIEW','P9-11':'BLOCKED_SEPARATE_HUMAN_COMPREHENSION_STUDY'}
    : {'P9-05':'BLOCKED_SEPARATE_MANUAL_SCREEN_READER_STUDY','P9-11':'READY_FOR_REVIEW'};
  const receipt={
    schema:'opencontainer.p9-human-acceptance-receipt.v1.0',
    status:'PASS',
    evidenceType,
    sourceCommit,
    artifact:{url:url.href,sha256:actualSha256,bytes:bytes.byteLength,issuedAt:artifact.issuedAt},
    evaluator:{id:artifact.evaluator.id,human:true},
    metrics:validation.metrics,
    candidateGateState,
    closureEligible:false,
    closureReason:'Human evidence intake is reviewable evidence only. P9-05/P9-11 remain non-machine-closable and require explicit human reconciliation.',
    boundaries:{manualScreenReaderAutoClosed:false,humanComprehensionAutoClosed:false,p9_12WeakDeviceClaimed:false,productionClosed:false}
  };
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
  console.log('P9 HUMAN ACCEPTANCE PASS '+JSON.stringify({evidenceType,sourceCommit,closureEligible:false}));
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
