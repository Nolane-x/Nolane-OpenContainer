import { createHash } from 'node:crypto';

export function levelMap(policy){
  return new Map((policy?.evidenceLevels??[]).map(item=>[item.id,item]));
}

export function validateAssurancePolicy(policy){
  const errors=[];
  if(policy?.schema!=='opencontainer.evidence-assurance-policy.v1.0')errors.push('invalid assurance policy schema');
  const levels=levelMap(policy);
  for(const id of ['SOURCE','DOCUMENTATION','MODEL','LOCAL','UNIT','INTEGRATION','BROWSER','DEVICE','CROSS-BROWSER','RELEASE-VERIFIED','BLOCKED-HARNESS']){
    if(!levels.has(id))errors.push('missing evidence level '+id);
  }
  if(levels.get('BLOCKED-HARNESS')?.closureEligible!==false)errors.push('BLOCKED-HARNESS must never be closure eligible');
  if(levels.get('SOURCE')?.closureEligible!==false||levels.get('DOCUMENTATION')?.closureEligible!==false)errors.push('source/documentation must not close critical gates');
  if(levels.get('INTEGRATION')?.closureEligible!==true)errors.push('INTEGRATION must be a closure-eligible executable level');
  const threats=new Set(policy?.benchmarkValidityThreats??[]);
  for(const name of ['warmup','cache','cpuThrottling','gc','thermal','network','devtools']){
    if(!threats.has(name))errors.push('missing benchmark validity threat '+name);
  }
  const required=new Set(policy?.decisiveBundle?.requiredFiles??[]);
  for(const name of ['environment.json','raw-results.json','summary.json','logs.json','failure-cases.json','corpus-lock.json','negative-results.json']){
    if(!required.has(name))errors.push('missing decisive bundle file '+name);
  }
  if(policy?.finalReleaseDecision?.gateCount!==304)errors.push('final release gate count must remain 304');
  return errors;
}

export function validateEvidenceRegistry({policy,registry,ledger}){
  const errors=[];
  if(registry?.schema!=='opencontainer.evidence-registry.v1.0')errors.push('invalid evidence registry schema');
  const levels=levelMap(policy);
  const byKey=new Map();
  for(const entry of registry?.entries??[]){
    if(byKey.has(entry.key))errors.push('duplicate evidence key '+entry.key);
    byKey.set(entry.key,entry);
    if(!levels.has(entry.level))errors.push('unknown evidence level '+entry.level+' for '+entry.key);
    if(!(policy?.evidenceKinds??[]).includes(entry.kind))errors.push('unknown evidence kind '+entry.kind+' for '+entry.key);
    if(entry.level==='BLOCKED-HARNESS'&&entry.status==='PASS')errors.push('BLOCKED-HARNESS cannot be PASS: '+entry.key);
  }
  for(const key of Object.keys(ledger?.evidence_catalog??{})){
    if(!byKey.has(key))errors.push('ledger evidence catalog key is unregistered: '+key);
  }
  for(const row of ledger?.overrides??[]){
    const entry=byKey.get(row.evidence);
    if(!entry)continue;
    if(row.closure_met===true){
      const level=levels.get(entry.level);
      if(entry.kind!=='EXECUTABLE')errors.push(row.id+' is closed by non-executable evidence '+row.evidence);
      if(level?.closureEligible!==true)errors.push(row.id+' is closed below integration evidence: '+entry.level);
      if(entry.status!=='PASS')errors.push(row.id+' is closed by non-PASS evidence '+row.evidence);
      const minimumId=policy?.promotionToMinimumLevel?.[row.promotion];
      const minimum=levels.get(minimumId);
      if(!minimum)errors.push(row.id+' has unknown promotion '+String(row.promotion));
      else if((level?.rank??-Infinity)<minimum.rank)errors.push(row.id+' evidence level '+entry.level+' is below ledger promotion '+row.promotion);
    }
    if(row.promotion==='BLOCKED-HARNESS'&&row.closure_met===true)errors.push(row.id+' promotes BLOCKED-HARNESS to closure');
  }
  return errors;
}

export function validateNegativeResults({policy,negativeResults}){
  const errors=[];
  if(negativeResults?.schema!=='opencontainer.negative-results.v1.0')errors.push('invalid negative-results schema');
  if(negativeResults?.appendOnly!==true)errors.push('negative-result history must be append-only');
  const ids=new Set();
  for(const item of negativeResults?.results??[]){
    if(ids.has(item.id))errors.push('duplicate negative-result id '+item.id);
    ids.add(item.id);
    if(!['HYPOTHESIS_FALSIFIED','HARNESS_INVALID','PRODUCT_FAILURE','RUNTIME_FAILURE','APPLICATION_FAILURE'].includes(item.classification))errors.push('unknown negative classification '+item.classification);
    if(item.classification==='HARNESS_INVALID'){
      if(!(policy?.exclusionReasonCodes??[]).includes(item.exclusionReasonCode))errors.push(item.id+' harness invalid result lacks predefined reason code');
    }else if(item.exclusionReasonCode!==null&&item.exclusionReasonCode!==undefined){
      errors.push(item.id+' non-harness result must remain outcome data, not an exclusion');
    }
    for(const key of ['hypothesis','outcome','evidence','finding','resolution']){
      if(typeof item[key]!=='string'||!item[key].trim())errors.push(item.id+' missing '+key);
    }
  }
  if(ids.size===0)errors.push('negative-result history is empty');
  return errors;
}

export function productionGateLedgerFailures(ledger){
  const failures=[];
  const expected=Number(ledger?.source?.gate_count??0);
  const rows=ledger?.overrides??[];
  const ids=new Set(rows.map(item=>item.id));
  const expectedIds=[];
  for(const domain of ledger?.domains??[]){
    const match=String(domain.domain??'').match(/^(P\\d+)/);
    if(!match)continue;
    for(let index=1;index<=Number(domain.gate_count??0);index++){
      expectedIds.push(match[1]+'-'+String(index).padStart(2,'0'));
    }
  }
  const expectedSet=new Set(expectedIds);
  if(expected!==304)failures.push('source gate count is not 304');
  if(expectedIds.length!==expected)failures.push('domain gate counts do not sum to source gate count');
  if(rows.length!==expected)failures.push('gate ledger is incomplete: '+rows.length+'/'+expected+' reconciled');
  if(ids.size!==rows.length)failures.push('gate ledger contains duplicate gate IDs');
  const missing=expectedIds.filter(id=>!ids.has(id));
  const unexpected=[...ids].filter(id=>!expectedSet.has(id));
  if(missing.length)failures.push('gate ledger is missing exact source IDs: '+missing.slice(0,8).join(',')+(missing.length>8?'...':''));
  if(unexpected.length)failures.push('gate ledger contains unexpected IDs: '+unexpected.slice(0,8).join(',')+(unexpected.length>8?'...':''));
  const open=rows.filter(item=>item.closure_met!==true);
  if(open.length)failures.push('gate ledger still has '+open.length+' non-closed reconciled gates');
  if(ledger?.production_closed!==true)failures.push('production_closed is false');
  return failures;
}

export function evidenceLevelCounts({registry,ledger}){
  const byKey=new Map((registry?.entries??[]).map(item=>[item.key,item]));
  const counts={SOURCE:0,DOCUMENTATION:0,MODEL:0,LOCAL:0,UNIT:0,INTEGRATION:0,BROWSER:0,DEVICE:0,'CROSS-BROWSER':0,'RELEASE-VERIFIED':0,'BLOCKED-HARNESS':0};
  for(const row of ledger?.overrides??[]){
    const level=byKey.get(row.evidence)?.level;
    if(level in counts)counts[level]++;
  }
  return counts;
}

export function sha256(value){
  return createHash('sha256').update(value).digest('hex');
}
