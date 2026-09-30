import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const arg=process.argv.find(value=>value.startsWith('--lane='));
const lane=arg?.slice('--lane='.length)??process.env.OPENCONTAINER_P14_BROWSER_LANE??null;
if(!['frozen-floor','newest-stable'].includes(lane))throw new Error('P14 browser regression lane must be frozen-floor or newest-stable');

function browserVersion(){
  for(const command of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0)return {command,version:String(result.stdout||result.stderr).trim()};
  }
  throw new Error('No Chrome/Chromium browser command found');
}

function run(command,args,{timeout=300000}={}){
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{stdio:'inherit',env:process.env});
    const timer=setTimeout(()=>{
      try{child.kill('SIGKILL');}catch{}
      reject(new Error(command+' timed out'));
    },timeout);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{
      clearTimeout(timer);
      if(code!==0)reject(new Error(command+' exited '+code));
      else resolveRun();
    });
  });
}

const browser=browserVersion();
const versionMatch=browser.version.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
if(!versionMatch)throw new Error('Cannot parse browser version: '+browser.version);
const parsedVersion=versionMatch[0];
const major=Number(versionMatch[1]);

let stableInstall=null;
if(lane==='frozen-floor'){
  if(browser.version!=='Google Chrome 153.0.8010.52'){
    throw new Error('P14 frozen-floor lane requires exact Chrome 153.0.8010.52; observed '+browser.version);
  }
}else{
  stableInstall=JSON.parse(await readFile('.artifacts/p14-browser-regression/newest-stable-install.json','utf8'));
  if(stableInstall?.channel!=='Stable')throw new Error('P14 newest-stable install receipt is not Stable');
  if(stableInstall?.version!==parsedVersion)throw new Error('P14 newest-stable manifest/binary version mismatch');
  if(major<=153)throw new Error('P14 newest-stable lane did not advance beyond frozen floor; observed '+browser.version);
  if(!String(stableInstall?.manifestUrl??'').includes('last-known-good-versions-with-downloads.json')){
    throw new Error('P14 newest-stable receipt is not bound to the live Stable manifest');
  }
}

await run(process.execPath,['scripts/run-browser-flake-campaign.mjs'],{timeout:300000});
const flake=JSON.parse(await readFile('.artifacts/critical-flake/browser-receipt.json','utf8'));
if(flake.status!=='PASS')throw new Error('P14 browser regression flake receipt failed');
if(flake.iterations!==2||flake.passedIterations!==2||flake.fullProductPathPasses!==2){
  throw new Error('P14 browser regression did not produce 2/2 full product paths');
}
if(flake.unexplainedFailures!==0)throw new Error('P14 browser regression has unexplained failures');

const receipt={
  schema:'opencontainer.p14-browser-regression-lane.v1.0',
  status:'PASS',
  sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P14-13',
  sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
  lane,
  browser:{
    command:browser.command,
    version:browser.version,
    parsedVersion,
    major
  },
  stableInstall,
  sourceCommit:flake.sourceCommit,
  campaign:{
    iterations:flake.iterations,
    passedIterations:flake.passedIterations,
    fullProductPathPasses:flake.fullProductPathPasses,
    unexplainedFailures:flake.unexplainedFailures,
    profile:flake.profile,
    runs:flake.runs
  },
  boundaries:{
    browserMinimumFrozenByThisCourt:false,
    crossBrowserClaimed:false,
    weakDeviceClaimed:false,
    productionCdnClaimed:false,
    productionClosed:false
  }
};

const outDir=resolve('.artifacts/p14-browser-regression');
await mkdir(outDir,{recursive:true});
await writeFile(resolve(outDir,lane+'-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log('P14 BROWSER REGRESSION PASS '+JSON.stringify({
  lane,
  browser:browser.version,
  fullProductPathPasses:receipt.campaign.fullProductPathPasses
}));
