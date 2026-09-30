import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const rawPath=resolve(repoRoot,process.argv[2]??'.artifacts/p13-openssf-scorecard/raw.json');
const outPath=resolve(repoRoot,process.argv[3]??'.artifacts/p13-openssf-scorecard/receipt.json');

function assert(condition,message,details=null){
  if(!condition){
    const error=new Error(message);
    error.details=details;
    throw error;
  }
}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function text(value){return typeof value==='string'?value.trim():'';}

const raw=await readFile(rawPath);
const document=JSON.parse(raw.toString('utf8'));
const checks=Array.isArray(document.checks)?document.checks:[];
const repository=text(document.repo?.name??document.repository?.name);
const analyzedCommit=text(document.repo?.commit??document.repository?.commit);
const score=Number(document.score);
const scorecardVersion=text(document.scorecard?.version);
const scorecardCommit=text(document.scorecard?.commit);

assert(repository.length>0,'OpenSSF Scorecard repository identity missing');
assert(/nolane-x\/nolane-opencontainer/i.test(repository),'OpenSSF Scorecard repository identity drift',{repository});
assert(Number.isFinite(score)&&score>=0&&score<=10,'OpenSSF Scorecard aggregate score is invalid',{score});
assert(checks.length>=10,'OpenSSF Scorecard returned too few checks',{checkCount:checks.length});

const names=new Set();
let unavailableChecks=0;
let scoredChecks=0;
const normalizedChecks=[];
for(const item of checks){
  const name=text(item?.name);
  const checkScore=Number(item?.score);
  assert(name.length>0,'OpenSSF Scorecard check name missing',{item});
  assert(!names.has(name),'OpenSSF Scorecard duplicate check name',{name});
  names.add(name);
  assert(Number.isFinite(checkScore)&&checkScore>=-1&&checkScore<=10,'OpenSSF Scorecard check score invalid',{name,score:item?.score});
  if(checkScore<0)unavailableChecks++;
  else scoredChecks++;
  normalizedChecks.push(Object.freeze({
    name,
    score:checkScore,
    reason:text(item?.reason).slice(0,1000)
  }));
}
assert(scoredChecks>0,'OpenSSF Scorecard produced no scored checks');

const receipt=Object.freeze({
  schema:'opencontainer.p13-openssf-scorecard-run.v1.0',
  status:'PASS',
  sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P13-18',
  sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
  action:{
    repository:'ossf/scorecard-action',
    release:'v2.4.4',
    commit:'2d1146689b8cda280b9bc96326124645441f03bc',
    publishResults:false
  },
  repository,
  analyzedCommit:analyzedCommit||null,
  workflowCommit:process.env.GITHUB_SHA??null,
  scorecard:{
    version:scorecardVersion||null,
    commit:scorecardCommit||null,
    aggregateScore:score,
    checkCount:checks.length,
    scoredChecks,
    unavailableChecks
  },
  raw:{
    sha256:sha256(raw),
    bytes:raw.byteLength
  },
  checks:normalizedChecks,
  boundaries:{
    minimumScoreThresholdClaimed:false,
    releaseProofClaimed:false,
    publicationTrustClaimed:false,
    branchProtectionClaimed:false,
    signingClaimed:false,
    productionClosed:false
  }
});

await mkdir(dirname(outPath),{recursive:true});
await writeFile(outPath,JSON.stringify(receipt,null,2)+'\n');
console.log('P13 OPENSSF SCORECARD PASS '+JSON.stringify({
  repository:receipt.repository,
  score:receipt.scorecard.aggregateScore,
  checks:receipt.scorecard.checkCount,
  unavailableChecks:receipt.scorecard.unavailableChecks,
  rawSha256:receipt.raw.sha256
}));
