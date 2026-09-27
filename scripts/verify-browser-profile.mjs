import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { resolve } from 'node:path';

export function parseChromeVersion(text){
  const match=String(text??'').match(/(?:Google Chrome|Chromium)\s+(\d+)\.(\d+)\.(\d+)\.(\d+)/i);
  if(!match)return null;
  return {major:Number(match[1]),minor:Number(match[2]),build:Number(match[3]),patch:Number(match[4]),version:match.slice(1).join('.')};
}

export function parseOsRelease(text){
  const out={};
  for(const line of String(text??'').split(/\r?\n/)){
    const m=line.match(/^([A-Z0-9_]+)=(.*)$/);
    if(!m)continue;
    out[m[1]]=m[2].replace(/^"|"$/g,'');
  }
  return out;
}

export function validateBrowserProfile({policy,chrome,osRelease,platform=process.platform,arch=process.arch}){
  const errors=[];
  const target=policy?.declaredEvidenceProfile;
  if(!chrome)errors.push('unable to parse Chrome/Chromium version');
  else if(chrome.major!==target?.browser?.major)errors.push('browser major '+chrome.major+' is outside frozen P0 profile '+target?.browser?.major);
  if(platform!==target?.os?.platform)errors.push('platform '+platform+' does not match '+target?.os?.platform);
  if(arch!==target?.os?.arch)errors.push('arch '+arch+' does not match '+target?.os?.arch);
  if(String(osRelease?.ID??'').toLowerCase()!==target?.os?.distribution)errors.push('OS distribution '+String(osRelease?.ID)+' does not match '+target?.os?.distribution);
  if(osRelease?.VERSION_ID!==target?.os?.version)errors.push('OS version '+String(osRelease?.VERSION_ID)+' does not match '+target?.os?.version);
  return errors;
}

function detectChrome(){
  const candidates=['google-chrome-stable','google-chrome','chromium','chromium-browser'];
  for(const command of candidates){
    const result=spawnSync(command,['--version'],{encoding:'utf8'});
    if(result.status===0){
      const parsed=parseChromeVersion((result.stdout??'')+(result.stderr??''));
      if(parsed)return {command,raw:String((result.stdout??'')+(result.stderr??'')).trim(),...parsed};
    }
  }
  return null;
}

async function main(){
  const policy=JSON.parse(await readFile(resolve('release/PRODUCT-SCOPE.v1.0.json'),'utf8'));
  const chrome=detectChrome();
  let osText='';
  try{osText=await readFile('/etc/os-release','utf8');}catch{}
  const osRelease=parseOsRelease(osText);
  const errors=validateBrowserProfile({policy,chrome,osRelease});
  const receipt={
    schema:'opencontainer.browser-evidence-profile.v1.0',
    ok:errors.length===0,
    profileId:policy.profileId,
    evidenceProfile:policy.declaredEvidenceProfile.id,
    browser:chrome,
    platform:process.platform,
    arch:process.arch,
    os:{id:osRelease.ID??null,version:osRelease.VERSION_ID??null,prettyName:osRelease.PRETTY_NAME??null},
    device:{class:policy.declaredEvidenceProfile.device.class,logicalCpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),resourceFloorClaimed:false},
    errors
  };
  await mkdir(resolve('.artifacts/product-scope'),{recursive:true});
  await writeFile(resolve('.artifacts/product-scope/browser-profile-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
  if(errors.length)process.exitCode=1;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href)await main();
