import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export function parseSemver(value){
  const text=String(value??'');
  const match=text.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if(!match)return null;
  return Object.freeze({
    raw:text,
    major:Number(match[1]),
    minor:Number(match[2]),
    patch:Number(match[3]),
    prerelease:match[4]?Object.freeze(match[4].split('.')):Object.freeze([])
  });
}

function isPositiveInteger(value){
  return Number.isInteger(value)&&value>0;
}

function hasProfileVersion(value){
  return typeof value==='string'&&/(?:^|[-:])v\d+(?:$|[-:])/.test(value);
}

function promotionRank(policy,value){
  return Number(policy.promotionRank?.[value]??0);
}

function gate(ledger,id){
  return (ledger.overrides??[]).find((item)=>item.id===id)??null;
}

export function validateReleasePolicy(policy){
  const errors=[];
  if(policy?.schema!=='opencontainer.release-promotion-policy.v0.1')errors.push('invalid release policy schema');
  const channels=[...(policy?.channels??[])].sort((a,b)=>a.order-b.order);
  const expected=['canary','beta','rc','stable'];
  if(channels.map((item)=>item.id).join(',')!==expected.join(','))errors.push('release channel order must be canary,beta,rc,stable');
  if(channels.some((item,index)=>item.order!==index+1))errors.push('release channel order numbers must be contiguous from 1');
  if(JSON.stringify(policy?.decisionValues)!==JSON.stringify(['GO','REDESIGN','KILL']))errors.push('release decision values drifted');
  if(JSON.stringify(policy?.implications)!==JSON.stringify(['api','storage','security']))errors.push('release implication keys drifted');
  const ranks=policy?.promotionRank??{};
  const expectedRanks=['IMPLEMENTED','PASS-UNIT','PASS-INTEGRATION','PASS-BROWSER','RELEASE-VERIFIED'];
  let prior=0;
  for(const key of expectedRanks){
    const value=Number(ranks[key]??0);
    if(value<=prior)errors.push('promotion rank is not strictly monotonic at '+key);
    prior=value;
  }
  const stable=channels.find((item)=>item.id==='stable');
  if(stable?.requireProductionClosed!==true)errors.push('stable must require production closure');
  if(stable?.requireReleaseVerified!==true)errors.push('stable must require release verification');
  if(stable?.requireZeroUnexplainedCriticalFlakes!==true)errors.push('stable must fail on unexplained critical flakiness');
  if(stable?.allowUnresolvedRisks!==false)errors.push('stable cannot allow unresolved risks');
  return errors;
}

export function profileVersionFailures({candidate,rootPackage,sdkPackage,protocolPackage,profile}){
  const failures=[];
  const version=parseSemver(candidate?.version);
  if(!version)failures.push('candidate version is not valid semantic versioning: '+String(candidate?.version));
  for(const [label,value] of [
    ['root package',rootPackage?.version],
    ['public SDK',sdkPackage?.version],
    ['protocol package',protocolPackage?.version],
    ['production profile runtime',profile?.runtime?.version],
    ['production profile protocol',profile?.protocol?.packageVersion]
  ]){
    if(value!==candidate?.version)failures.push(label+' version '+String(value)+' does not match candidate '+String(candidate?.version));
  }

  for(const [label,value] of [
    ['filesystem logical profile',profile?.filesystem?.logicalProfile],
    ['OPFS checkpoint profile',profile?.filesystem?.opfsCheckpointProfile],
    ['sync RPC mailbox profile',profile?.protocol?.syncRpcMailboxProfile],
    ['Service Worker compatibility profile',profile?.browser?.serviceWorkerCompatibilityId]
  ]){
    if(!hasProfileVersion(value))failures.push(label+' has no explicit version identity: '+String(value));
  }

  for(const [label,value] of [
    ['snapshot schema',profile?.filesystem?.snapshotSchemaVersion],
    ['OPFS manifest',profile?.filesystem?.opfsManifestVersion],
    ['portable snapshot format',profile?.snapshot?.portableFormatVersion],
    ['worker RPC envelope',profile?.protocol?.workerRpcEnvelopeVersion]
  ]){
    if(!isPositiveInteger(value))failures.push(label+' must be a positive integer version');
  }
  return failures;
}

export function reviewedChangeFailures(candidate,policy){
  const failures=[];
  const changes=candidate?.reviewedChanges;
  if(!Array.isArray(changes)||changes.length===0)return ['release candidate has no reviewed changes'];
  for(const [index,change] of changes.entries()){
    const prefix='reviewedChanges['+index+']';
    if(typeof change?.ref!=='string'||!change.ref.trim())failures.push(prefix+' has no review reference');
    if(typeof change?.title!=='string'||!change.title.trim())failures.push(prefix+' has no title');
    if(!/^[0-9a-f]{40}$/.test(String(change?.mergeCommit??'')))failures.push(prefix+' mergeCommit is not a full Git commit');
    for(const key of policy?.implications??[]){
      const value=change?.implications?.[key];
      if(typeof value!=='string'||!value.trim())failures.push(prefix+' has no '+key+' implication');
    }
  }
  return failures;
}

function versionClassFailures(candidate,channel){
  const failures=[];
  const version=parseSemver(candidate?.version);
  if(!version)return failures;
  if(channel.versionClass==='stable'&&version.prerelease.length>0){
    failures.push('stable channel requires a non-prerelease semantic version');
  }
  if(channel.versionClass==='prerelease'&&version.prerelease.length===0){
    failures.push(channel.id+' channel requires a prerelease semantic version');
  }
  if(Array.isArray(channel.allowedPrereleaseLabels)&&channel.allowedPrereleaseLabels.length){
    const label=version.prerelease[0]??'';
    if(!channel.allowedPrereleaseLabels.includes(label)){
      failures.push(channel.id+' channel does not allow prerelease label '+JSON.stringify(label));
    }
  }
  return failures;
}

function priorPromotionFailures(candidate,channels,target){
  const failures=[];
  const prior=(candidate?.priorPromotions??[]);
  for(const channel of channels.filter((item)=>item.order<target.order)){
    const receipt=prior.find((item)=>item.channel===channel.id);
    if(!receipt){
      failures.push('missing prior GO promotion receipt for '+channel.id);
      continue;
    }
    if(receipt.decision!=='GO')failures.push('prior promotion '+channel.id+' was not GO');
    if(typeof receipt.version!=='string'||!parseSemver(receipt.version))failures.push('prior promotion '+channel.id+' has invalid version');
    if(typeof receipt.evidence!=='string'||!receipt.evidence.trim())failures.push('prior promotion '+channel.id+' has no evidence reference');
  }
  return failures;
}

function channelEvidenceFailures({candidate,policy,ledger,target}){
  const failures=[];
  const channels=[...policy.channels].sort((a,b)=>a.order-b.order).filter((item)=>item.order<=target.order);
  for(const channel of channels){
    for(const requirement of channel.requiredEvidence??[]){
      const item=gate(ledger,requirement.gate);
      if(!item){
        failures.push(channel.id+': missing ledger evidence for '+requirement.gate);
        continue;
      }
      if(requirement.closureMet===true&&item.closure_met!==true){
        failures.push(channel.id+': '+requirement.gate+' is not closed');
      }
      if(requirement.minimumPromotion){
        const actual=promotionRank(policy,item.promotion);
        const expected=promotionRank(policy,requirement.minimumPromotion);
        if(actual<expected){
          failures.push(channel.id+': '+requirement.gate+' promotion '+String(item.promotion)+' is below '+requirement.minimumPromotion);
        }
      }
    }
    for(const id of channel.requiredClosedGates??[]){
      if(gate(ledger,id)?.closure_met!==true)failures.push(channel.id+': required gate '+id+' is not closed');
    }
  }

  if(target.requireProductionClosed===true&&ledger?.production_closed!==true){
    failures.push(target.id+': production_closed is false');
  }
  if(target.requireReleaseVerified===true&&candidate?.releaseVerification?.verified!==true){
    failures.push(target.id+': no verified release receipt is attached');
  }
  if(target.requireZeroUnexplainedCriticalFlakes===true&&candidate?.criticalTestFlakiness?.unexplained!==0){
    failures.push(target.id+': unexplained critical test flakiness is '+String(candidate?.criticalTestFlakiness?.unexplained));
  }
  if(target.allowUnresolvedRisks===false&&(candidate?.unresolvedRisks?.length??0)>0){
    failures.push(target.id+': unresolved release risks remain');
  }
  return failures;
}

export function renderChangelog(candidate){
  const lines=[
    '# OpenContainer '+candidate.version+' — '+candidate.channel,
    '',
    '## Reviewed changes',
    ''
  ];
  for(const change of candidate.reviewedChanges??[]){
    lines.push('- '+change.ref+' — '+change.title);
    lines.push('  - API: '+change.implications.api);
    lines.push('  - Storage: '+change.implications.storage);
    lines.push('  - Security: '+change.implications.security);
  }
  lines.push('','## Unresolved risks','');
  if((candidate.unresolvedRisks??[]).length===0)lines.push('- None declared.');
  else for(const risk of candidate.unresolvedRisks)lines.push('- '+risk);
  lines.push('');
  return lines.join('\n');
}

export function evaluateReleasePreflight(inputs,{sourceCommit='unknown'}={}){
  const {policy,candidate,rootPackage,sdkPackage,protocolPackage,profile,ledger}=inputs;
  const fatal=[];
  fatal.push(...validateReleasePolicy(policy));
  if(candidate?.schema!=='opencontainer.release-candidate.v0.1')fatal.push('invalid release candidate schema');
  const channels=[...(policy?.channels??[])].sort((a,b)=>a.order-b.order);
  const target=channels.find((item)=>item.id===candidate?.channel)??null;
  if(!target)fatal.push('unknown release channel '+String(candidate?.channel));
  fatal.push(...profileVersionFailures({candidate,rootPackage,sdkPackage,protocolPackage,profile}));
  fatal.push(...reviewedChangeFailures(candidate,policy));

  const redesign=[];
  if(target){
    redesign.push(...versionClassFailures(candidate,target));
    redesign.push(...priorPromotionFailures(candidate,channels,target));
    redesign.push(...channelEvidenceFailures({candidate,policy,ledger,target}));
  }

  const decision=fatal.length?'KILL':redesign.length?'REDESIGN':'GO';
  const changelog=renderChangelog(candidate);
  const changelogSha256=createHash('sha256').update(changelog).digest('hex');
  const unresolvedRisks=[
    ...(candidate?.unresolvedRisks??[]),
    ...redesign.map((item)=>'Preflight: '+item),
    ...fatal.map((item)=>'Fatal preflight: '+item)
  ];

  return Object.freeze({
    schema:'opencontainer.release-preflight.v0.1',
    releaseId:candidate?.releaseId??null,
    channel:candidate?.channel??null,
    version:candidate?.version??null,
    sourceCommit,
    decision,
    eligible:decision==='GO',
    productionClosed:ledger?.production_closed===true,
    checks:Object.freeze({
      policyValid:validateReleasePolicy(policy).length===0,
      versionProfileCoherent:profileVersionFailures({candidate,rootPackage,sdkPackage,protocolPackage,profile}).length===0,
      reviewedChangesComplete:reviewedChangeFailures(candidate,policy).length===0,
      channelEvidenceSatisfied:target?channelEvidenceFailures({candidate,policy,ledger,target}).length===0:false,
      priorPromotionChainSatisfied:target?priorPromotionFailures(candidate,channels,target).length===0:false,
      versionClassSatisfied:target?versionClassFailures(candidate,target).length===0:false,
      unexplainedCriticalFlakes:candidate?.criticalTestFlakiness?.unexplained??null
    }),
    failures:Object.freeze({
      fatal:Object.freeze(fatal),
      redesign:Object.freeze(redesign)
    }),
    unresolvedRisks:Object.freeze(unresolvedRisks),
    reviewedChangeCount:candidate?.reviewedChanges?.length??0,
    changelogSha256
  });
}

export async function loadReleaseInputs(){
  const paths={
    policy:'release/RELEASE-POLICY.v0.1.json',
    candidate:'release/RELEASE-CANDIDATE.v0.1.json',
    rootPackage:'package.json',
    sdkPackage:'packages/sdk/package.json',
    protocolPackage:'packages/protocol/package.json',
    profile:'docs/production/PRODUCTION-PROFILE.json',
    ledger:'docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'
  };
  const entries=await Promise.all(Object.entries(paths).map(async([key,path])=>[
    key,
    JSON.parse(await readFile(join(repoRoot,path),'utf8'))
  ]));
  return Object.fromEntries(entries);
}

function gitHead(){
  const result=spawnSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'});
  if(result.status!==0)throw new Error('git rev-parse HEAD failed: '+(result.stderr??''));
  return result.stdout.trim();
}

export async function runReleasePreflight({outputDir=join(repoRoot,'.artifacts','release-preflight')}={}){
  const inputs=await loadReleaseInputs();
  const receipt=evaluateReleasePreflight(inputs,{sourceCommit:gitHead()});
  const changelog=renderChangelog(inputs.candidate);
  const output=resolve(outputDir);
  await rm(output,{recursive:true,force:true});
  await mkdir(output,{recursive:true});
  await Promise.all([
    writeFile(join(output,'decision.json'),JSON.stringify(receipt,null,2)+'\n'),
    writeFile(join(output,'CHANGELOG.md'),changelog)
  ]);
  return receipt;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const receipt=await runReleasePreflight();
  console.log(JSON.stringify(receipt,null,2));
  if(receipt.decision!=='GO')process.exitCode=1;
}
