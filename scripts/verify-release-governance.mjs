import { readFile } from 'node:fs/promises';
import { parseSemver } from './evaluate-release-preflight.mjs';

function nonEmpty(value){return typeof value==='string'&&value.trim().length>0;}
function fullCommit(value){return typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);}
function hexDigest(value){return typeof value==='string'&&/^[0-9a-f]{64,128}$/.test(value);}
function dateMs(value){const time=Date.parse(value);return Number.isFinite(time)?time:null;}

export function validateHotfixPolicy(policy){
  const errors=[];
  if(policy?.schema!=='opencontainer.hotfix-policy.v0.1')errors.push('invalid hotfix policy schema');
  if(policy?.releaseRules?.directArtifactMutationForbidden!==true)errors.push('hotfix policy must forbid direct artifact mutation');
  if(policy?.releaseRules?.destructiveStorageDowngradeForbidden!==true)errors.push('hotfix policy must forbid destructive storage downgrade');
  if(policy?.releaseRules?.archivedDecisionRequired!==true)errors.push('hotfix policy must require archived decision evidence');
  const required=['npm run distribution:certify','npm run distribution:browser','npm run release:evidence','npm run release:verify','npm run release:preflight'];
  for(const command of required)if(!(policy?.requiredEvidenceCommands??[]).includes(command))errors.push('missing hotfix evidence command '+command);
  const phases=['after-preflight','after-payload','after-verify','after-publish'];
  const actual=policy?.storageImpact?.migration?.requiredCrashPhases??[];
  if(JSON.stringify(actual)!==JSON.stringify(phases))errors.push('hotfix migration crash phases drifted');
  return errors;
}

export function validateDeprecationPolicy(policy){
  const errors=[];
  if(policy?.schema!=='opencontainer.deprecation-policy.v0.1')errors.push('invalid deprecation policy schema');
  if(!Number.isInteger(policy?.minimumStableReleaseWindow)||policy.minimumStableReleaseWindow<2)errors.push('stable deprecation window must be at least two releases');
  if(!Number.isInteger(policy?.minimumDays)||policy.minimumDays<90)errors.push('calendar deprecation window must be at least 90 days');
  if(policy?.securityImmediateDisablement?.allowed!==true)errors.push('security immediate-disable path must be explicit');
  for(const severity of ['high','critical'])if(!(policy?.securityImmediateDisablement?.requiredSeverity??[]).includes(severity))errors.push('missing emergency severity '+severity);
  return errors;
}

function versionHotfixFailure(sourceVersion,targetVersion){
  const source=parseSemver(sourceVersion);
  const target=parseSemver(targetVersion);
  if(!source||!target)return 'hotfix source/target version must be valid SemVer';
  if(source.prerelease.length===0){
    if(target.prerelease.length>0||target.major!==source.major||target.minor!==source.minor||target.patch!==source.patch+1){
      return 'stable hotfix must increment patch exactly once without prerelease';
    }
    return null;
  }
  if(target.major!==source.major||target.minor!==source.minor||target.patch!==source.patch||target.prerelease.length===0){
    return 'prerelease hotfix must keep the same base version and remain prerelease';
  }
  if(target.raw===source.raw)return 'prerelease hotfix target must differ from source';
  if(target.prerelease[0]!==source.prerelease[0])return 'prerelease hotfix must retain the prerelease channel label';
  const sLast=Number(source.prerelease.at(-1));
  const tLast=Number(target.prerelease.at(-1));
  if(Number.isFinite(sLast)&&Number.isFinite(tLast)&&tLast<=sLast)return 'prerelease hotfix sequence must increase';
  return null;
}

export function validateHotfixRequest(policy,request){
  const errors=[...validateHotfixPolicy(policy)];
  if(request?.schema!=='opencontainer.hotfix-request.v0.1')errors.push('invalid hotfix request schema');
  if(!nonEmpty(request?.reason))errors.push('hotfix reason is required');
  const source=request?.sourceRelease??{};
  if(!fullCommit(source.sourceCommit))errors.push('hotfix source commit must be a full Git commit');
  for(const field of ['artifactSha256','artifactSha512','sbomDigest','provenanceDigest']){
    if(!hexDigest(source[field]))errors.push('missing or invalid source release '+field);
  }
  if(!nonEmpty(source.decisionReceipt))errors.push('source release decision receipt is required');
  const versionFailure=versionHotfixFailure(source.version,request?.targetVersion);
  if(versionFailure)errors.push(versionFailure);

  const commands=new Set(request?.completedEvidenceCommands??[]);
  for(const command of policy.requiredEvidenceCommands??[])if(!commands.has(command))errors.push('hotfix did not run required evidence command '+command);

  if(request?.artifactStrategy!=='rebuild-from-source')errors.push('hotfix artifact must be rebuilt from source');
  if(request?.directArtifactMutation===true)errors.push('hotfix cannot mutate a published artifact in place');
  if(request?.archivedDecision!==true)errors.push('hotfix decision record must be archived');

  const storageImpact=request?.storageImpact;
  if(!(storageImpact in (policy.storageImpact??{})))errors.push('unknown hotfix storage impact '+String(storageImpact));
  if(storageImpact==='compatible'&&!nonEmpty(request?.storageCompatibilityStatement))errors.push('compatible storage hotfix requires a compatibility statement');
  if(storageImpact==='migration'){
    const migration=request?.migrationEvidence??{};
    if(migration.dryRun!==true)errors.push('storage hotfix requires migration dry-run evidence');
    const phases=new Set(migration.crashPhases??[]);
    for(const phase of policy.storageImpact.migration.requiredCrashPhases??[])if(!phases.has(phase))errors.push('storage hotfix missing crash phase '+phase);
    if(!nonEmpty(migration.rollbackPlan))errors.push('storage hotfix requires a rollback plan');
    if(migration.destructiveStorageDowngrade===true)errors.push('storage hotfix rollback may not require destructive downgrade');
  }

  const securityImpact=request?.securityImpact;
  if(!(securityImpact in (policy.securityImpact??{})))errors.push('unknown hotfix security impact '+String(securityImpact));
  if(securityImpact==='security'){
    if(!nonEmpty(request?.incidentId))errors.push('security hotfix requires incident reference');
    if(request?.fullBrowserRegression!==true)errors.push('security hotfix requires full browser regression');
  }
  return errors;
}

function dayDifference(start,end){
  const a=dateMs(start),b=dateMs(end);
  if(a===null||b===null)return null;
  return Math.floor((b-a)/(24*60*60*1000));
}

export function validateDeprecationEntry(policy,entry){
  const errors=[...validateDeprecationPolicy(policy)];
  if(entry?.schema!=='opencontainer.deprecation-entry.v0.1')errors.push('invalid deprecation entry schema');
  if(!(policy.surfaces??[]).includes(entry?.surface))errors.push('deprecation surface must be public-api or adapter');
  if(!nonEmpty(entry?.id))errors.push('deprecation id is required');
  if(!parseSemver(entry?.deprecatedVersion))errors.push('deprecatedVersion must be valid SemVer');
  if(!parseSemver(entry?.removalVersion))errors.push('removalVersion must be valid SemVer');

  if(entry?.securityEmergency===true){
    const emergency=entry?.emergency??{};
    if(!(policy.securityImmediateDisablement.requiredSeverity??[]).includes(emergency.severity))errors.push('security emergency severity must be high or critical');
    if(!nonEmpty(emergency.incidentId))errors.push('security emergency requires incident ID');
    if(!nonEmpty(emergency.customerWarning))errors.push('security emergency requires customer warning');
    if(!nonEmpty(emergency.recoveryOrAlternative))errors.push('security emergency requires recovery or alternative');
    if(!nonEmpty(emergency.postIncidentReview))errors.push('security emergency requires post-incident review plan');
    return errors;
  }

  if(entry?.stableReleasesElapsed<policy.minimumStableReleaseWindow)errors.push('deprecation stable-release window is too short');
  const days=dayDifference(entry?.deprecatedAt,entry?.removalNotBefore);
  if(days===null)errors.push('deprecation dates are invalid');
  else if(days<policy.minimumDays)errors.push('deprecation calendar window is too short');

  if(entry?.noticePublished!==true)errors.push('normal deprecation requires published notice');
  if(!nonEmpty(entry?.replacementOrRationale))errors.push('normal deprecation requires replacement or rationale');
  if(!nonEmpty(entry?.migrationGuide))errors.push('normal deprecation requires migration guide');
  if(entry?.releaseNotesUpdated!==true)errors.push('normal deprecation requires release-note entry');
  return errors;
}

export async function verifyReleaseGovernance(){
  const [hotfixPolicyText,deprecationPolicyText,registryText]=await Promise.all([
    readFile('release/HOTFIX-POLICY.v0.1.json','utf8'),
    readFile('release/DEPRECATION-POLICY.v0.1.json','utf8'),
    readFile('release/DEPRECATIONS.v0.1.json','utf8')
  ]);
  const hotfixPolicy=JSON.parse(hotfixPolicyText);
  const deprecationPolicy=JSON.parse(deprecationPolicyText);
  const registry=JSON.parse(registryText);
  const errors=[
    ...validateHotfixPolicy(hotfixPolicy),
    ...validateDeprecationPolicy(deprecationPolicy)
  ];
  if(registry?.schema!=='opencontainer.deprecation-registry.v0.1')errors.push('invalid deprecation registry schema');
  for(const entry of registry?.entries??[])errors.push(...validateDeprecationEntry(deprecationPolicy,entry).map((error)=>entry.id+': '+error));
  return Object.freeze({
    schema:'opencontainer.release-governance-verification.v0.1',
    ok:errors.length===0,
    hotfixPolicy:hotfixPolicy.schema,
    deprecationPolicy:deprecationPolicy.schema,
    deprecationEntries:registry?.entries?.length??0,
    errors:Object.freeze(errors)
  });
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const receipt=await verifyReleaseGovernance();
  console.log(JSON.stringify(receipt,null,2));
  if(!receipt.ok)process.exitCode=1;
}
