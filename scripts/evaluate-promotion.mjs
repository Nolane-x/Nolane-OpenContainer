import { readFile } from 'node:fs/promises';

export async function loadPromotionInputs(){
  const [thresholdsText,ledgerText,baselineText,oracleText]=await Promise.all([
    readFile('compat/PROMOTION-THRESHOLDS.v0.1.json','utf8'),
    readFile('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'),
    readFile('docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json','utf8'),
    readFile('compat/NODE24-ORACLE-EXCEPTIONS.v0.1.json','utf8')
  ]);
  return {
    thresholds:JSON.parse(thresholdsText),
    ledger:JSON.parse(ledgerText),
    baseline:JSON.parse(baselineText),
    oracle:JSON.parse(oracleText)
  };
}

function closedGateSet(ledger){
  return new Set((ledger.overrides??[]).filter((item)=>item.closure_met===true).map((item)=>item.id));
}

function requirementValue(key,{ledger,baseline,oracle}){
  switch(key){
    case 'frozenCorpus':
      return baseline.corpusSummary?.caseCount>=8;
    case 'minimumRealRepositories':
      return (baseline.corpusSummary?.repositories?.length??0);
    case 'minimumFreshBrowserSessionsPerEnabledCase': {
      const value=String(baseline.progression?.repeatedBrowser??'');
      const match=value.match(/^(\d+)x-/);
      return match?Number(match[1]):0;
    }
    case 'machineReadableCompatibilityReport':
      return baseline.schema==='opencontainer.compatibility-baseline.v0.1';
    case 'adapterSemanticsDeclared':
      return Array.isArray(baseline.adapters)&&baseline.adapters.length>=baseline.axes.length;
    case 'oracleExceptionsFailClosed':
      return oracle?.policy?.unlistedMismatch==='FAIL'&&oracle?.policy?.staleException==='FAIL';
    case 'publishedThirdPartyPackageCourt':
      return /published clsx package execution/i.test(baseline.surfaceEvidence?.module?.evidence??'')||
        /published clsx package execution/i.test(baseline.surfaceEvidence?.package?.evidence??'');
    case 'knownLimitationsPublished':
      return Array.isArray(baseline.limitations)&&baseline.limitations.length>0;
    case 'actualOpenContainerDistributionCertified':
      return (ledger.overrides??[]).find((item)=>item.id==='P11-12')?.closure_met===true;
    case 'publishedSamplesRunAgainstDistribution':
      return (ledger.overrides??[]).find((item)=>item.id==='P15-12')?.closure_met===true;
    case 'releaseCompatibilityReportPublished':
      return (ledger.overrides??[]).find((item)=>item.id==='P11-14')?.closure_met===true;
    case 'browserMinimumsFrozenFromRealMatrix':
      return (ledger.overrides??[]).find((item)=>item.id==='P11-13')?.closure_met===true;
    case 'productionClosed':
      return ledger.production_closed===true;
    default:
      return false;
  }
}

function requirementSatisfied(key,expected,inputs){
  const actual=requirementValue(key,inputs);
  if(typeof expected==='number')return typeof actual==='number'&&actual>=expected;
  if(Array.isArray(expected))return false;
  return actual===expected;
}

export function validateThresholds(thresholds){
  const errors=[];
  if(thresholds.schema!=='opencontainer.compatibility-promotion-thresholds.v0.1')errors.push('invalid threshold schema');
  const levels=[...(thresholds.levels??[])].sort((a,b)=>a.order-b.order);
  if(levels.length!==4)errors.push('expected Alpha/Beta/RC/1.0 levels');
  const expected=['alpha','beta','rc','1.0'];
  if(levels.map((level)=>level.id).join(',')!==expected.join(','))errors.push('promotion level order drifted');
  const seen=new Set();
  for(const level of levels){
    for(const gate of level.requiredClosedGates??[]){
      if(seen.has(gate))errors.push('gate repeated across promotion levels: '+gate);
      seen.add(gate);
    }
  }
  return errors;
}

export function evaluatePromotion({thresholds,ledger,baseline,oracle}){
  const errors=validateThresholds(thresholds);
  if(errors.length)return {schema:'opencontainer.compatibility-promotion-evaluation.v0.1',qualifiedLevel:null,errors,levels:[]};

  const closed=closedGateSet(ledger);
  const levels=[...thresholds.levels].sort((a,b)=>a.order-b.order);
  const results=[];
  let priorQualified=true;
  let qualifiedLevel=null;

  for(const level of levels){
    const gateFailures=(level.requiredClosedGates??[]).filter((gate)=>!closed.has(gate));
    const requirementFailures=[];
    for(const [key,expected] of Object.entries(level.requirements??{})){
      if(key==='noCriticalOpenGateInDomains'){
        requirementFailures.push({key,expected,actual:'not-yet-machine-reconciled'});
        continue;
      }
      if(key==='allCriticalProductionGatesClosed'||key==='releaseVerified'||key==='legalFtoClosed'||key==='operationsHandoffClosed'||key==='releaseRollbackDrill'){
        requirementFailures.push({key,expected,actual:false});
        continue;
      }
      const actual=requirementValue(key,{ledger,baseline,oracle});
      if(!requirementSatisfied(key,expected,{ledger,baseline,oracle}))requirementFailures.push({key,expected,actual});
    }
    const qualified=priorQualified&&gateFailures.length===0&&requirementFailures.length===0;
    results.push({id:level.id,qualified,gateFailures,requirementFailures});
    if(qualified)qualifiedLevel=level.id;
    priorQualified=qualified;
  }

  return {
    schema:'opencontainer.compatibility-promotion-evaluation.v0.1',
    qualifiedLevel,
    productionClosed:ledger.production_closed===true,
    levels:results
  };
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const inputs=await loadPromotionInputs();
  const receipt=evaluatePromotion(inputs);
  console.log(JSON.stringify(receipt,null,2));
  if(!receipt.qualifiedLevel)process.exitCode=1;
}
