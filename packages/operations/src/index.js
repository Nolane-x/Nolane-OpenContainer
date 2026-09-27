import { browserCapabilityProbe } from '../../diagnostics/src/index.js';

function assert(condition,message){
  if(!condition)throw new Error(message);
}
function freeze(value){
  if(Array.isArray(value))return Object.freeze(value.map(freeze));
  if(value&&typeof value==='object'){
    const out={};
    for(const [key,item] of Object.entries(value))out[key]=freeze(item);
    return Object.freeze(out);
  }
  return value;
}
function safeVersion(value){
  return typeof value==='string'&&/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

export function assessRuntimeOperationsPolicy({policy,runtimeVersion,fs}={}){
  assert(policy?.schema==='opencontainer.operations-policy.v1.0','operations policy is required');
  assert(safeVersion(runtimeVersion),'runtimeVersion must be semver-like');
  const blocked=(policy.runtimeBlock?.blockedVersions??[]).includes(runtimeVersion);
  const supported=runtimeVersion===policy.releaseSupport?.activeVersion&&!blocked;
  const mode=blocked?'read-only':supported?'read-write':'unsupported';
  if(blocked&&fs?.setReadOnly)fs.setReadOnly(true,policy.runtimeBlock.reasonPrefix+runtimeVersion);
  return freeze({
    schema:'opencontainer.runtime-operations-assessment.v1.0',
    runtimeVersion,
    supported,
    blocked,
    mode,
    mutationAllowed:mode==='read-write',
    exportAllowed:blocked?policy.runtimeBlock.allowExport:true,
    readAllowed:blocked?policy.runtimeBlock.allowRead:true,
    reason:blocked?policy.runtimeBlock.reasonPrefix+runtimeVersion:supported?'active-supported-line':'outside-supported-pre1.0-line'
  });
}

export function exerciseVulnerabilityWorkflow(policy,input={}){
  assert(policy?.schema==='opencontainer.operations-policy.v1.0','operations policy is required');
  const wf=policy.vulnerabilityWorkflow;
  for(const key of wf.requiredFields)assert(input[key]!==undefined&&input[key]!==null,'vulnerability missing '+key);
  const severity=String(input.severity).toUpperCase();
  assert(['CRITICAL','HIGH','MODERATE','LOW'].includes(severity),'invalid vulnerability severity');
  const states=['RECEIVED','TRIAGED'];
  if(wf.embargoRequiredFor.includes(severity))states.push('EMBARGOED');
  states.push('FIX_READY','ADVISORY_READY','DISCLOSED');
  return freeze({
    schema:'opencontainer.vulnerability-workflow-drill.v1.0',
    id:String(input.id),
    severity,
    affectedVersions:[...input.affectedVersions],
    owner:String(input.owner),
    receivedAt:String(input.receivedAt),
    states,
    embargoed:states.includes('EMBARGOED'),
    advisoryChannels:[...wf.advisoryChannels],
    privateChannelVerified:wf.privateChannelVerified===true,
    status:'PASS'
  });
}

export function exerciseIncident(policy,scenario){
  assert(policy?.schema==='opencontainer.operations-policy.v1.0','operations policy is required');
  assert(scenario&&typeof scenario.id==='string','incident scenario required');
  const roles=(policy.incidentRoles??[]).map(x=>x.id);
  assert(roles.length>=4,'incident roles incomplete');
  const required=[...(scenario.required??[])];
  assert(required.length>=5,'incident scenario lacks required actions');
  return freeze({
    schema:'opencontainer.incident-drill.v1.0',
    scenario:scenario.id,
    trigger:scenario.trigger,
    roles,
    actions:required,
    containment:required.filter(x=>/freeze|stop|suspend|block|fail-closed|revoke/.test(x)),
    recovery:required.filter(x=>/recover|rollback|rebuild|export|rotate|readability/.test(x)),
    notification:required.filter(x=>/notify|advisory|known-issue/.test(x)),
    evidencePreservation:required.filter(x=>/evidence|provenance|regression|known-issue|post-incident/.test(x)),
    status:'PASS'
  });
}

export function localHealthReceipt({policy,runtimeVersion,fs=null,diagnostics=null,scope=globalThis}={}){
  assert(policy?.localHealth?.telemetryFree===true,'local health must be telemetry-free');
  const probe=browserCapabilityProbe(scope);
  const diag=diagnostics?.summary?.()??null;
  const telemetry=diag?.telemetry??diagnostics?.telemetry??null;
  if(telemetry)assert(telemetry.remoteEnabled!==true,'local health cannot require remote telemetry');
  return freeze({
    schema:'opencontainer.local-health.v1.0',
    profile:policy.profile,
    runtimeVersion,
    browser:probe,
    workspace:{
      readOnly:fs?.readOnly??null,
      readOnlyReason:fs?.readOnlyReason??null,
      generation:fs?.generation??null
    },
    diagnostics:diag,
    remoteRequestCount:0,
    centralServiceRequired:false,
    telemetryFree:true
  });
}

export function issueRegressionCheck({policy,registry}={}){
  assert(policy?.issueRegressionRule,'issue regression policy required');
  assert(registry?.schema==='opencontainer.security-regression-registry.v1.0','security regression registry required');
  const violations=[];
  for(const row of registry.entries??[]){
    if(!['CRITICAL','HIGH'].includes(row.severity))continue;
    const tests=(row.evidence??[]).filter(x=>x.startsWith('tests/')&&x.endsWith('.test.js'));
    if(typeof row.id!=='string'||!row.id)violations.push('missing stable identity');
    if(!tests.length)violations.push(row.id+': no executable regression test');
    if(row.status!=='FIXED_RETAINED')violations.push(row.id+': fix evidence not retained');
  }
  return freeze({
    schema:'opencontainer.issue-regression-rule.v1.0',
    checked:(registry.entries??[]).length,
    violations,
    status:violations.length?'FAIL':'PASS'
  });
}

export function knownIssueQuery({database,version,profile,browser=null}={}){
  assert(database?.schema==='opencontainer.known-issues.v1.0','known issues database required');
  return freeze((database.entries??[]).filter(item=>
    (!version||item.version===version)&&
    (!profile||item.profile===profile)&&
    (!browser||item.browser===browser)
  ));
}

export function backupExportRecommendation(policy,{importance='normal',beforeRiskyChange=false}={}){
  assert(policy?.backupExport,'backup/export policy required');
  return freeze({
    schema:'opencontainer.backup-export-recommendation.v1.0',
    importance,
    recommendExport:importance==='important'||beforeRiskyChange===true,
    beforeRiskyChange:beforeRiskyChange===true,
    message:policy.backupExport.recommendation,
    browserStorageGuarantee:policy.backupExport.browserStorageGuarantee,
    nagging:policy.backupExport.nagging===true,
    falseDurabilityGuarantee:policy.backupExport.falseDurabilityGuarantee===true
  });
}

export function endOfLifeDisposition(policy,{runtimeVersion,hasPortableExport=true}={}){
  assert(policy?.endOfLife,'EOL policy required');
  return freeze({
    schema:'opencontainer.eol-disposition.v1.0',
    runtimeVersion,
    supported:false,
    mutation:'blocked-or-read-only',
    projectReadability:policy.endOfLife.projectReadability===true,
    portableExport:hasPortableExport&&policy.endOfLife.portableExport===true,
    destructiveStorageDowngrade:policy.endOfLife.destructiveStorageDowngrade===true
  });
}

export function validateKnownIssues(policy,database){
  const errors=[];
  if(database?.schema!=='opencontainer.known-issues.v1.0')errors.push('invalid known issues schema');
  const ids=new Set();
  for(const item of database?.entries??[]){
    if(ids.has(item.id))errors.push('duplicate known issue '+item.id);
    ids.add(item.id);
    if(policy.knownIssues.requireVersion&&!safeVersion(item.version))errors.push(item.id+': invalid version');
    if(policy.knownIssues.requireProfile&&typeof item.profile!=='string')errors.push(item.id+': missing profile');
    if(policy.knownIssues.requireBrowser&&typeof item.browser!=='string')errors.push(item.id+': missing browser');
    if(policy.knownIssues.workaroundMustBeSafeOrNull&&item.workaround!==null&&item.safeWorkaround!==true)errors.push(item.id+': unsafe workaround');
  }
  return errors;
}
