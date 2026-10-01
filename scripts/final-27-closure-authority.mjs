import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

async function readJson(path){return JSON.parse(await readFile(resolve(repoRoot,path),'utf8'));}
async function exists(path){try{await readFile(resolve(repoRoot,path));return true;}catch{return false;}}

export function deriveAllGateIds(ledger){
  const ids=[];
  for(const [domainIndex,domain] of (ledger?.domains??[]).entries()){
    const count=Number(domain?.gate_count);
    if(!Number.isInteger(count)||count<1)throw new Error('invalid gate_count for domain '+domainIndex);
    for(let i=1;i<=count;i++)ids.push('P'+domainIndex+'-'+String(i).padStart(2,'0'));
  }
  return ids;
}

export function deriveOpenGateIds(ledger){
  const all=deriveAllGateIds(ledger);
  const closed=new Set((ledger?.overrides??[]).filter(x=>x?.closure_met===true).map(x=>x.id));
  return all.filter(id=>!closed.has(id));
}

function setDiff(a,b){return [...a].filter(x=>!b.has(x)).sort();}

function workflowErrors(path,text){
  const errors=[];
  if(!/(^|\n)\s*workflow_dispatch:\s*$/m.test(text))errors.push(path+': workflow_dispatch trigger missing');
  if(/(^|\n)\s*pull_request:\s*$/m.test(text))errors.push(path+': pull_request trigger is forbidden for final external evidence route');
  if(/(^|\n)\s*push:\s*$/m.test(text))errors.push(path+': push trigger is forbidden for final external evidence route');
  if(!/(^|\n)permissions:\s*\n\s+contents:\s*read\b/m.test(text))errors.push(path+': top-level contents: read permission missing');
  for(const signal of ['${{ secrets.','id-token: write','contents: write','packages: write','write-all','npm publish']){
    if(text.toLowerCase().includes(signal.toLowerCase()))errors.push(path+': forbidden authority/write signal '+signal);
  }
  return errors;
}

function findTrueAutomaticClosure(value,path='$',hits=[]){
  if(Array.isArray(value)){
    value.forEach((x,i)=>findTrueAutomaticClosure(x,path+'['+i+']',hits));
    return hits;
  }
  if(value&&typeof value==='object'){
    for(const [key,item] of Object.entries(value)){
      const next=path+'.'+key;
      if(key==='automaticLedgerClosure'&&item===true)hits.push(next);
      findTrueAutomaticClosure(item,next,hits);
    }
  }
  return hits;
}

export async function validateFinalClosureAuthority({authority,ledger,packageJson,readText=async path=>readFile(resolve(repoRoot,path),'utf8'),readPolicy=readJson}){
  const errors=[];
  if(authority?.schema!=='opencontainer.final-closure-authority.v1.0')errors.push('authority schema drift');
  if(authority?.sourceGateSha256!==ledger?.source?.sha256)errors.push('source gate SHA-256 drift');
  if(authority?.forbiddenAutoPromotion!==true)errors.push('forbiddenAutoPromotion must be true');
  if(authority?.productionClosed!==false)errors.push('authority must not claim production closure');
  if(ledger?.production_closed!==false)errors.push('ledger unexpectedly claims production closure');

  const all=deriveAllGateIds(ledger);
  if(all.length!==ledger?.source?.gate_count)errors.push('derived gate inventory does not equal source gate_count');

  const expectedOpen=deriveOpenGateIds(ledger);
  const routes=Array.isArray(authority?.routes)?authority.routes:[];
  const mapped=routes.flatMap(route=>Array.isArray(route?.gates)?route.gates:[]);
  const mappedSet=new Set(mapped);
  const expectedSet=new Set(expectedOpen);

  if(mapped.length!==mappedSet.size)errors.push('one or more open gates are mapped to multiple authority routes');
  for(const gate of mapped)if(!all.includes(gate))errors.push('authority references unknown gate '+gate);

  const missing=setDiff(expectedSet,mappedSet);
  const extra=setDiff(mappedSet,expectedSet);
  if(missing.length)errors.push('open gates missing authority route: '+missing.join(','));
  if(extra.length)errors.push('authority routes include non-open gates: '+extra.join(','));

  const seenRouteIds=new Set();
  const workflowCache=new Map();
  const policyCache=new Map();
  for(const route of routes){
    if(typeof route?.id!=='string'||!route.id)errors.push('route id missing');
    else if(seenRouteIds.has(route.id))errors.push('duplicate route id '+route.id);
    else seenRouteIds.add(route.id);
    if(route?.automaticLedgerClosure!==false)errors.push((route?.id??'<route>')+': automaticLedgerClosure must be false');
    if(!Array.isArray(route?.gates)||route.gates.length<1)errors.push((route?.id??'<route>')+': route gates missing');
    if(typeof route?.entrypoint!=='string'||!route.entrypoint)errors.push((route?.id??'<route>')+': entrypoint missing');
    if(typeof route?.policy!=='string'||!route.policy)errors.push((route?.id??'<route>')+': policy missing');
    if(typeof route?.trigger!=='string'||!route.trigger)errors.push((route?.id??'<route>')+': real-world trigger missing');

    if(route?.entrypoint?.startsWith('.github/workflows/')){
      if(!workflowCache.has(route.entrypoint)){
        try{workflowCache.set(route.entrypoint,await readText(route.entrypoint));}
        catch{errors.push(route.id+': workflow entrypoint missing '+route.entrypoint);continue;}
      }
      errors.push(...workflowErrors(route.entrypoint,workflowCache.get(route.entrypoint)));
    }else{
      try{await readText(route.entrypoint);}
      catch{errors.push(route.id+': local entrypoint missing '+route.entrypoint);}
      if(route.authorityType==='local-admin-external-state'){
        if(route.command!=='npm run repository:trust:evidence')errors.push(route.id+': local admin command drift');
        if(packageJson?.scripts?.['repository:trust:evidence']!=='node scripts/repository-trust-state.mjs')errors.push(route.id+': package local admin command missing');
      }
    }

    if(!policyCache.has(route.policy)){
      try{policyCache.set(route.policy,await readPolicy(route.policy));}
      catch{errors.push(route.id+': policy file missing '+route.policy);continue;}
    }
    const policy=policyCache.get(route.policy);
    const trueClosures=findTrueAutomaticClosure(policy);
    if(trueClosures.length)errors.push(route.id+': referenced policy contains automatic ledger closure: '+trueClosures.join(','));
    if(policy?.productionClosed===true||policy?.production_closed===true)errors.push(route.id+': referenced policy claims production closure');

    if(route.aggregate){
      try{await readText(route.aggregate);}
      catch{errors.push(route.id+': aggregate script missing '+route.aggregate);}
    }
  }

  const closedCount=(ledger?.overrides??[]).filter(x=>x?.closure_met===true).length;
  return {
    schema:'opencontainer.final-closure-authority-verification.v1.0',
    status:errors.length?'FAIL':'PASS',
    sourceGateCount:all.length,
    closedCount,
    openCount:expectedOpen.length,
    mappedOpenCount:mapped.length,
    routeCount:routes.length,
    openGates:expectedOpen,
    routes:routes.map(x=>({id:x.id,gates:x.gates,authorityType:x.authorityType,entrypoint:x.entrypoint,trigger:x.trigger})),
    errors,
    productionClosed:false
  };
}

async function main(){
  const [authority,ledger,packageJson]=await Promise.all([
    readJson('release/FINAL-27-CLOSURE-AUTHORITY.v1.0.json'),
    readJson('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'),
    readJson('package.json')
  ]);
  const result=await validateFinalClosureAuthority({authority,ledger,packageJson});
  const output=resolve(repoRoot,'.artifacts','final-closure','authority.json');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log('FINAL CLOSURE AUTHORITY '+result.status+' '+JSON.stringify({
    closed:result.closedCount,total:result.sourceGateCount,open:result.openCount,mapped:result.mappedOpenCount,routes:result.routeCount
  }));
  if(result.errors.length){
    for(const error of result.errors)console.error(' - '+error);
    process.exitCode=1;
  }
}

const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
