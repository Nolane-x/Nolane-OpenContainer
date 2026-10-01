import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

function gateIdsFromLedger(ledger){
  const closed=new Set((ledger.overrides??[]).filter(x=>x.closure_met===true).map(x=>x.id));
  const all=[];
  for(const domain of ledger.domains??[]){
    const prefix=(/^P\d+/.exec(domain.domain??'')??[])[0];
    if(!prefix)continue;
    for(let i=1;i<=Number(domain.gate_count??0);i++)all.push(prefix+'-'+String(i).padStart(2,'0'));
  }
  return {
    all,
    closed:[...closed].sort(),
    open:all.filter(id=>!closed.has(id)).sort()
  };
}
function safeRepoPath(path){
  const value=String(path??'').replaceAll('\\','/');
  return value.length>0&&!value.startsWith('/')&&!value.includes('..')&&!value.includes('\0');
}
async function pathExists(path){
  try{await access(resolve(repoRoot,path));return true;}catch{return false;}
}
function workflowSecurityErrors(path,text){
  const errors=[];
  if(!/\bworkflow_dispatch\s*:/.test(text))errors.push(path+' missing workflow_dispatch');
  if(/\bpull_request\s*:|\bpush\s*:/.test(text))errors.push(path+' must not auto-run from pull_request/push');
  if(!/permissions:\s*\n\s+contents:\s*read\b/.test(text))errors.push(path+' missing top-level contents: read');
  if(/\$\{\{\s*secrets\./.test(text))errors.push(path+' references GitHub Actions secrets');
  if(/\bid-token:\s*write\b|\bcontents:\s*write\b|\bpackages:\s*write\b|\bwrite-all\b/.test(text))errors.push(path+' carries write-capable permission');
  return errors;
}

export function policySemanticErrors(path,document,expectedSourceGateSha256){
  const errors=[];
  if(document?.sourceGateSha256&&document.sourceGateSha256!==expectedSourceGateSha256){
    errors.push(path+' sourceGateSha256 drift');
  }
  const visit=(value,location='export async function verifyFinalClosureCampaign({manifest,ledger}){
  const errors=[];
  if(manifest?.schema!=='opencontainer.final-closure-campaign.v1.0')errors.push('campaign schema drift');
  const gateState=gateIdsFromLedger(ledger);
  const routes=Array.isArray(manifest?.routes)?manifest.routes:[];
  const ids=new Set();
  const routedGates=[];
  const routeReports=[];
  for(const [index,route] of routes.entries()){
    const label='route['+index+']';
    if(typeof route?.id!=='string'||!route.id)errors.push(label+' id missing');
    else if(ids.has(route.id))errors.push('duplicate route id '+route.id);
    else ids.add(route.id);
    if(!Array.isArray(route?.gates)||route.gates.length<1)errors.push(label+' gates missing');
    else routedGates.push(...route.gates);
    if(typeof route?.class!=='string'||!route.class)errors.push(label+' class missing');
    if(typeof route?.authority!=='string'||!route.authority)errors.push(label+' authority missing');
    if(!Array.isArray(route?.prerequisites)||route.prerequisites.length<1)errors.push(label+' prerequisites missing');
    if(typeof route?.output!=='string'||!route.output)errors.push(label+' output missing');
    if(route?.closureEligible!==false)errors.push(label+' closureEligible must remain false');
    if(route?.autoPromotion!==false)errors.push(label+' autoPromotion must remain false');
    const entrypoints=Array.isArray(route?.entrypoints)?route.entrypoints:[];
    if(!entrypoints.length)errors.push(label+' entrypoints missing');
    const checked=[];
    for(const path of entrypoints){
      if(!safeRepoPath(path)){errors.push(route.id+' unsafe entrypoint '+path);continue;}
      const exists=await pathExists(path);
      if(!exists){errors.push(route.id+' entrypoint missing: '+path);continue;}
      let workflowSecurity=[];
      let policySemantics=[];
      let parsedJson=null;
      if(String(path).startsWith('.github/workflows/')){
        const text=await readFile(resolve(repoRoot,path),'utf8');
        workflowSecurity=workflowSecurityErrors(path,text);
        errors.push(...workflowSecurity);
      }
      if(String(path).startsWith('release/')&&String(path).endsWith('.json')){
        try{
          parsedJson=JSON.parse(await readFile(resolve(repoRoot,path),'utf8'));
          policySemantics=policySemanticErrors(path,parsedJson,ledger?.source?.sha256);
          errors.push(...policySemantics);
        }catch(error){
          errors.push(route.id+' invalid JSON policy/harness '+path+': '+error.message);
        }
      }
      checked.push({path,exists,workflowSecurity,policySemantics});
    }
    if(route?.id==='repository-trust-state'){
      const packageJson=JSON.parse(await readFile(resolve(repoRoot,'package.json'),'utf8'));
      if(packageJson?.scripts?.['repository:trust:evidence']!=='node scripts/repository-trust-state.mjs'){
        errors.push('repository-trust-state package command drift');
      }
      const trustPath='release/EXTERNAL-TRUST-REVIEW-POLICY.v1.0.json';
      if(!entrypoints.includes(trustPath)){
        errors.push('repository-trust-state must bind EXTERNAL-TRUST-REVIEW-POLICY.v1.0.json');
      }else{
        try{
          const trust=JSON.parse(await readFile(resolve(repoRoot,trustPath),'utf8'));
          if(trust?.repositoryTrust?.mode!=='local-admin-cli')errors.push('repository-trust-state policy mode must remain local-admin-cli');
          if(trust?.repositoryTrust?.workflowPresent!==false)errors.push('repository-trust-state policy must keep workflowPresent=false');
          if(trust?.repositoryTrust?.command!=='npm run repository:trust:evidence')errors.push('repository-trust-state policy command drift');
        }catch(error){
          errors.push('repository-trust-state policy unreadable: '+error.message);
        }
      }
    }
    routeReports.push({
      id:route?.id??null,
      class:route?.class??null,
      gates:route?.gates??[],
      authority:route?.authority??null,
      entrypoints:checked,
      closureEligible:false,
      autoPromotion:false
    });
  }

  const duplicateGates=[...new Set(routedGates.filter((id,i)=>routedGates.indexOf(id)!==i))].sort();
  if(duplicateGates.length)errors.push('open gates routed more than once: '+duplicateGates.join(', '));
  const manifestGates=[...new Set(routedGates)].sort();
  const missing=gateState.open.filter(id=>!manifestGates.includes(id));
  const extra=manifestGates.filter(id=>!gateState.open.includes(id));
  if(missing.length)errors.push('open gates missing evidence route: '+missing.join(', '));
  if(extra.length)errors.push('manifest routes gates that are not currently open: '+extra.join(', '));

  if(Number(manifest?.ledgerBaseline?.closed)!==gateState.closed.length)errors.push('ledgerBaseline.closed drift');
  if(Number(manifest?.ledgerBaseline?.open)!==gateState.open.length)errors.push('ledgerBaseline.open drift');
  if(Number(manifest?.ledgerBaseline?.total)!==gateState.all.length)errors.push('ledgerBaseline.total drift');
  if(manifest?.ledgerBaseline?.productionClosed!==ledger.production_closed)errors.push('ledgerBaseline.productionClosed drift');
  if(manifest?.productionClosed!==false||ledger.production_closed!==false)errors.push('production closure must remain false while campaign has open gates');
  if(gateState.open.length===0)errors.push('final closure campaign should be retired after all gates close');

  const byClass={};
  for(const route of routes){
    byClass[route.class]=(byClass[route.class]??0)+(route.gates?.length??0);
  }
  return {
    schema:'opencontainer.final-closure-campaign-report.v1.0',
    status:errors.length?'FAIL':'PASS',
    ledger:{closed:gateState.closed.length,open:gateState.open.length,total:gateState.all.length,productionClosed:ledger.production_closed},
    routedGateCount:manifestGates.length,
    routeCount:routes.length,
    openGates:gateState.open,
    byClass,
    routeReports,
    closureEligible:false,
    autoPromotion:false,
    errors
  };
}

async function main(){
  const manifest=JSON.parse(await readFile(resolve(repoRoot,'release/FINAL-CLOSURE-CAMPAIGN.v1.0.json'),'utf8'));
  const ledger=JSON.parse(await readFile(resolve(repoRoot,'docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'),'utf8'));
  const result=await verifyFinalClosureCampaign({manifest,ledger});
  const output=resolve(repoRoot,process.argv.find(x=>x.startsWith('--output='))?.slice('--output='.length)??'.artifacts/final-closure-campaign/report.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log('FINAL CLOSURE CAMPAIGN '+result.status+' '+JSON.stringify({
    closed:result.ledger.closed,open:result.ledger.open,routes:result.routeCount,routedGates:result.routedGateCount,closureEligible:false
  }));
  if(result.errors.length){
    for(const error of result.errors)console.error('final-closure-campaign:',error);
    process.exitCode=1;
  }
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
)=>{
    if(Array.isArray(value)){
      value.forEach((item,index)=>visit(item,location+'['+index+']'));
      return;
    }
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      const next=location+'.'+key;
      if(key==='automaticLedgerClosure'&&item===true)errors.push(path+' '+next+' enables automatic ledger closure');
      if(key==='closureEligible'&&item===true)errors.push(path+' '+next+' claims closure eligibility');
      if(key==='autoPromotion'&&item===true)errors.push(path+' '+next+' enables automatic promotion');
      if((key==='productionClosed'||key==='production_closed')&&item===true)errors.push(path+' '+next+' claims production closure');
      if(key==='forbiddenAutoPromotion'&&item===false)errors.push(path+' '+next+' disables the auto-promotion guard');
      visit(item,next);
    }
  };
  visit(document);
  return errors;
}
export async function verifyFinalClosureCampaign({manifest,ledger}){
  const errors=[];
  if(manifest?.schema!=='opencontainer.final-closure-campaign.v1.0')errors.push('campaign schema drift');
  const gateState=gateIdsFromLedger(ledger);
  const routes=Array.isArray(manifest?.routes)?manifest.routes:[];
  const ids=new Set();
  const routedGates=[];
  const routeReports=[];
  for(const [index,route] of routes.entries()){
    const label='route['+index+']';
    if(typeof route?.id!=='string'||!route.id)errors.push(label+' id missing');
    else if(ids.has(route.id))errors.push('duplicate route id '+route.id);
    else ids.add(route.id);
    if(!Array.isArray(route?.gates)||route.gates.length<1)errors.push(label+' gates missing');
    else routedGates.push(...route.gates);
    if(typeof route?.class!=='string'||!route.class)errors.push(label+' class missing');
    if(typeof route?.authority!=='string'||!route.authority)errors.push(label+' authority missing');
    if(!Array.isArray(route?.prerequisites)||route.prerequisites.length<1)errors.push(label+' prerequisites missing');
    if(typeof route?.output!=='string'||!route.output)errors.push(label+' output missing');
    if(route?.closureEligible!==false)errors.push(label+' closureEligible must remain false');
    if(route?.autoPromotion!==false)errors.push(label+' autoPromotion must remain false');
    const entrypoints=Array.isArray(route?.entrypoints)?route.entrypoints:[];
    if(!entrypoints.length)errors.push(label+' entrypoints missing');
    const checked=[];
    for(const path of entrypoints){
      if(!safeRepoPath(path)){errors.push(route.id+' unsafe entrypoint '+path);continue;}
      const exists=await pathExists(path);
      if(!exists){errors.push(route.id+' entrypoint missing: '+path);continue;}
      let workflowSecurity=[];
      if(String(path).startsWith('.github/workflows/')){
        const text=await readFile(resolve(repoRoot,path),'utf8');
        workflowSecurity=workflowSecurityErrors(path,text);
        errors.push(...workflowSecurity);
      }
      checked.push({path,exists,workflowSecurity});
    }
    routeReports.push({
      id:route?.id??null,
      class:route?.class??null,
      gates:route?.gates??[],
      authority:route?.authority??null,
      entrypoints:checked,
      closureEligible:false,
      autoPromotion:false
    });
  }

  const duplicateGates=[...new Set(routedGates.filter((id,i)=>routedGates.indexOf(id)!==i))].sort();
  if(duplicateGates.length)errors.push('open gates routed more than once: '+duplicateGates.join(', '));
  const manifestGates=[...new Set(routedGates)].sort();
  const missing=gateState.open.filter(id=>!manifestGates.includes(id));
  const extra=manifestGates.filter(id=>!gateState.open.includes(id));
  if(missing.length)errors.push('open gates missing evidence route: '+missing.join(', '));
  if(extra.length)errors.push('manifest routes gates that are not currently open: '+extra.join(', '));

  if(Number(manifest?.ledgerBaseline?.closed)!==gateState.closed.length)errors.push('ledgerBaseline.closed drift');
  if(Number(manifest?.ledgerBaseline?.open)!==gateState.open.length)errors.push('ledgerBaseline.open drift');
  if(Number(manifest?.ledgerBaseline?.total)!==gateState.all.length)errors.push('ledgerBaseline.total drift');
  if(manifest?.ledgerBaseline?.productionClosed!==ledger.production_closed)errors.push('ledgerBaseline.productionClosed drift');
  if(manifest?.productionClosed!==false||ledger.production_closed!==false)errors.push('production closure must remain false while campaign has open gates');
  if(gateState.open.length===0)errors.push('final closure campaign should be retired after all gates close');

  const byClass={};
  for(const route of routes){
    byClass[route.class]=(byClass[route.class]??0)+(route.gates?.length??0);
  }
  return {
    schema:'opencontainer.final-closure-campaign-report.v1.0',
    status:errors.length?'FAIL':'PASS',
    ledger:{closed:gateState.closed.length,open:gateState.open.length,total:gateState.all.length,productionClosed:ledger.production_closed},
    routedGateCount:manifestGates.length,
    routeCount:routes.length,
    openGates:gateState.open,
    byClass,
    routeReports,
    closureEligible:false,
    autoPromotion:false,
    errors
  };
}

async function main(){
  const manifest=JSON.parse(await readFile(resolve(repoRoot,'release/FINAL-CLOSURE-CAMPAIGN.v1.0.json'),'utf8'));
  const ledger=JSON.parse(await readFile(resolve(repoRoot,'docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'),'utf8'));
  const result=await verifyFinalClosureCampaign({manifest,ledger});
  const output=resolve(repoRoot,process.argv.find(x=>x.startsWith('--output='))?.slice('--output='.length)??'.artifacts/final-closure-campaign/report.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log('FINAL CLOSURE CAMPAIGN '+result.status+' '+JSON.stringify({
    closed:result.ledger.closed,open:result.ledger.open,routes:result.routeCount,routedGates:result.routedGateCount,closureEligible:false
  }));
  if(result.errors.length){
    for(const error of result.errors)console.error('final-closure-campaign:',error);
    process.exitCode=1;
  }
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
