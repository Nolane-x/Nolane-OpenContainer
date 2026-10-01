import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHostingHeaders } from './hosting-self-check-lib.mjs';
import { probeBrowserPage } from './browser-page-probe-lib.mjs';

function parseArgs(argv){const out={};for(const item of argv){const m=String(item).match(/^--([^=]+)=(.*)$/);if(m)out[m[1]]=m[2];}return out;}
function privateIpv4(address){
  const p=address.split('.').map(Number);
  if(p.length!==4||p.some(x=>!Number.isInteger(x)))return false;
  return p[0]===10||p[0]===127||p[0]===0||
    (p[0]===169&&p[1]===254)||
    (p[0]===172&&p[1]>=16&&p[1]<=31)||
    (p[0]===192&&p[1]===168)||
    (p[0]===100&&p[1]>=64&&p[1]<=127);
}
function privateIpv6(address){
  const x=address.toLowerCase();
  return x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||x.startsWith('fe8')||x.startsWith('fe9')||x.startsWith('fea')||x.startsWith('feb');
}
export function isPublicAddress(address){
  const family=isIP(address);
  if(family===4)return !privateIpv4(address);
  if(family===6)return !privateIpv6(address);
  return false;
}
export function validatePublicDeploymentRequest({url,version,tag,topologyId,edgeProvider,edgeMarkerHeader}){
  const errors=[];
  let parsed=null;
  try{parsed=new URL(url);}catch{errors.push('url must be absolute');}
  if(parsed){
    if(parsed.protocol!=='https:')errors.push('public deployment URL must use https');
    if(parsed.username||parsed.password)errors.push('public deployment URL must not contain credentials');
    if(parsed.port&&parsed.port!=='443')errors.push('public deployment URL must use standard HTTPS port 443');
    if(parsed.hostname==='localhost'||isIP(parsed.hostname))errors.push('public deployment URL must use a public DNS hostname');
  }
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version??'')))errors.push('version invalid');
  if(tag!=='v'+version)errors.push('tag must equal v<version>');
  if(!/^[A-Za-z0-9._-]{3,128}$/.test(String(topologyId??'')))errors.push('topology-id invalid');
  if(!/^[A-Za-z0-9._ -]{2,128}$/.test(String(edgeProvider??'')))errors.push('edge-provider invalid');
  if(!/^x-[a-z0-9-]{2,64}$/.test(String(edgeMarkerHeader??'').toLowerCase()))errors.push('edge-marker-header must be an x-* header');
  return errors;
}
async function tlsReceipt(hostname){
  return new Promise((resolveTls,reject)=>{
    const socket=tlsConnect({host:hostname,port:443,servername:hostname,rejectUnauthorized:true});
    const timer=setTimeout(()=>{socket.destroy();reject(new Error('TLS handshake timeout'));},10000);
    socket.once('secureConnect',()=>{
      clearTimeout(timer);
      const cert=socket.getPeerCertificate();
      const receipt={
        authorized:socket.authorized,
        protocol:socket.getProtocol(),
        cipher:socket.getCipher()?.name??null,
        subjectaltname:cert?.subjectaltname??null,
        validFrom:cert?.valid_from??null,
        validTo:cert?.valid_to??null,
        fingerprint256:cert?.fingerprint256??null
      };
      socket.end();
      resolveTls(receipt);
    });
    socket.once('error',error=>{clearTimeout(timer);reject(error);});
  });
}
async function main(){
  const args=parseArgs(process.argv.slice(2));
  const url=args.url;
  const version=args.version;
  const tag=args.tag;
  const topologyId=args['topology-id'];
  const edgeProvider=args['edge-provider'];
  const edgeMarkerHeader=String(args['edge-marker-header']??'x-opencontainer-edge-id').toLowerCase();
  const output=resolve(args.output??'.artifacts/public-deployment/receipt.json');
  const requestErrors=validatePublicDeploymentRequest({url,version,tag,topologyId,edgeProvider,edgeMarkerHeader});
  if(requestErrors.length)throw new Error('invalid public deployment request: '+requestErrors.join('; '));

  const base=new URL(url);
  base.pathname='/';base.search='';base.hash='';
  const dnsRows=await lookup(base.hostname,{all:true,verbatim:true});
  if(!dnsRows.length)throw new Error('public deployment DNS returned no addresses');
  const nonPublic=dnsRows.filter(x=>!isPublicAddress(x.address));
  if(nonPublic.length)throw new Error('public deployment DNS resolved private/non-public addresses: '+JSON.stringify(nonPublic));

  const tls=await tlsReceipt(base.hostname);
  if(!tls.authorized)throw new Error('TLS certificate is not authorized');

  const root=await fetch(base,{cache:'no-store',redirect:'manual'});
  if(!root.ok)throw new Error('public deployment root returned '+root.status);
  const location=root.headers.get('location');
  if(location)throw new Error('public deployment root must not redirect during evidence campaign');
  const marker=root.headers.get(edgeMarkerHeader);
  if(marker!==topologyId)throw new Error('edge marker '+edgeMarkerHeader+' drift: expected '+topologyId+' observed '+marker);
  const hsts=root.headers.get('strict-transport-security')??'';
  if(!/max-age\s*=\s*(?:[3-9]\d{6}|[1-9]\d{7,})/i.test(hsts))throw new Error('HSTS max-age is missing or below 30 days');

  const hosting=await checkHostingHeaders(base.href);
  if(!hosting.ok)throw new Error('public deployment hosting self-check failed: '+JSON.stringify(hosting.failures));
  const profileResponse=await fetch(new URL('/docs/production/PRODUCTION-PROFILE.json',base),{cache:'no-store'});
  if(!profileResponse.ok)throw new Error('public deployment production profile unavailable');
  const deploymentProfile=await profileResponse.json();
  if(deploymentProfile?.runtime?.version!==version)throw new Error('public deployment runtime version '+deploymentProfile?.runtime?.version+' != expected '+version);

  const browser=await probeBrowserPage(base.href,{
    timeoutMs:90000,
    waitExpression:"globalThis.__openContainerUi?.ready?.()===true || document.querySelector('#app')?.dataset?.ready==='error'"
  });
  if(browser.snapshot?.ready!==true)throw new Error('public product shell did not report ready');
  if(browser.snapshot?.crossOriginIsolated!==true)throw new Error('public product shell lost crossOriginIsolated');
  if(browser.snapshot?.storageAvailable!==true||browser.snapshot?.locksAvailable!==true)throw new Error('public product shell lacks required storage/lock browser primitives');

  const receipt={
    schema:'opencontainer.public-deployment-topology.v1.0',
    status:'PASS',
    sourceGate:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P1-13/P14-12',
    sourceGateSha256:'b667e6628e22b1a48a4fba937fcd5d8bc432b233d4ea56a10db384b5e1192146',
    sourceCommit:process.env.GITHUB_SHA??null,
    workflowRunId:process.env.GITHUB_RUN_ID??null,
    deployment:{
      url:base.href,
      version,
      tag,
      runtimeVersion:deploymentProfile.runtime.version,
      hostname:base.hostname,
      topologyId,
      edgeProvider,
      edgeMarkerHeader,
      edgeMarkerValue:marker,
      dns:dnsRows,
      tls,
      hsts
    },
    hosting,
    browser,
    candidateGateState:{
      'P1-13':'READY_FOR_REVIEW',
      'P14-12':'READY_FOR_REVIEW'
    },
    closureEligible:false,
    closureReason:'A passing real-public deployment campaign is reviewable evidence only; ledger promotion remains separate and must bind the exact deployed release identity/topology.',
    productionClosed:false
  };
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
  console.log('PUBLIC DEPLOYMENT TOPOLOGY PASS '+JSON.stringify({url:base.href,topologyId,edgeProvider,addresses:dnsRows.length,closureEligible:false}));
}
const invoked=process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url));
if(invoked)await main();
