function normalizeBaseUrl(value){
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol))throw new TypeError('Hosting self-check requires an http(s) URL');
  if(!url.pathname.endsWith('/'))url.pathname+='/';
  return url;
}

function exactHeader(response,name,expected,failures){
  const actual=response.headers.get(name);
  if(actual!==expected)failures.push({kind:'header',path:new URL(response.url).pathname,header:name,expected,actual});
}

function containsDirective(response,needle,failures){
  const actual=response.headers.get('content-security-policy')??'';
  if(!actual.includes(needle))failures.push({kind:'csp',path:new URL(response.url).pathname,expectedContains:needle,actual});
  return actual;
}

async function get(base,path){
  return fetch(new URL(path,base),{cache:'no-store',redirect:'manual'});
}

export async function checkHostingHeaders(baseUrl){
  const base=normalizeBaseUrl(baseUrl);
  const failures=[];
  const receipts=[];

  const root=await get(base,'/');
  if(!root.ok)failures.push({kind:'http',path:'/',expected:'2xx',actual:root.status});
  else{
    exactHeader(root,'cross-origin-opener-policy','same-origin',failures);
    exactHeader(root,'cross-origin-embedder-policy','require-corp',failures);
    exactHeader(root,'cross-origin-resource-policy','same-origin',failures);
  }
  receipts.push({path:'/',status:root.status});

  const strict=await get(base,'/opencontainer-guest-worker.mjs');
  if(!strict.ok)failures.push({kind:'http',path:'/opencontainer-guest-worker.mjs',expected:'2xx',actual:strict.status});
  else{
    exactHeader(strict,'x-opencontainer-worker-profile','strict',failures);
    const csp=containsDirective(strict,"default-src 'none'",failures);
    containsDirective(strict,"script-src 'self' 'wasm-unsafe-eval'",failures);
    containsDirective(strict,"connect-src 'self'",failures);
    if(csp.includes("'unsafe-eval'"))failures.push({kind:'csp',path:'/opencontainer-guest-worker.mjs',forbidden:"'unsafe-eval'",actual:csp});
  }
  receipts.push({path:'/opencontainer-guest-worker.mjs',status:strict.status});

  const toolchain=await get(base,'/opencontainer-toolchain-worker.mjs');
  if(!toolchain.ok)failures.push({kind:'http',path:'/opencontainer-toolchain-worker.mjs',expected:'2xx',actual:toolchain.status});
  else{
    exactHeader(toolchain,'x-opencontainer-worker-profile','toolchain',failures);
    containsDirective(toolchain,"default-src 'none'",failures);
    containsDirective(toolchain,"'wasm-unsafe-eval'",failures);
    containsDirective(toolchain,"'unsafe-eval'",failures);
    containsDirective(toolchain,"connect-src 'self'",failures);
  }
  receipts.push({path:'/opencontainer-toolchain-worker.mjs',status:toolchain.status});

  const serviceWorker=await get(base,'/opencontainer-sw.js');
  if(!serviceWorker.ok)failures.push({kind:'http',path:'/opencontainer-sw.js',expected:'2xx',actual:serviceWorker.status});
  else exactHeader(serviceWorker,'service-worker-allowed','/',failures);
  receipts.push({path:'/opencontainer-sw.js',status:serviceWorker.status});

  const profileResponse=await get(base,'/docs/production/PRODUCTION-PROFILE.json');
  let profile=null;
  if(!profileResponse.ok)failures.push({kind:'http',path:'/docs/production/PRODUCTION-PROFILE.json',expected:'2xx',actual:profileResponse.status});
  else{
    try{profile=await profileResponse.json();}
    catch(error){failures.push({kind:'json',path:'/docs/production/PRODUCTION-PROFILE.json',message:error?.message??String(error)});}
    if(profile?.schema!=='opencontainer.production-profile.v0.1')failures.push({kind:'profile',field:'schema',expected:'opencontainer.production-profile.v0.1',actual:profile?.schema??null});
    if(profile?.productionClosed!==false)failures.push({kind:'profile',field:'productionClosed',expected:false,actual:profile?.productionClosed??null});
  }
  receipts.push({path:'/docs/production/PRODUCTION-PROFILE.json',status:profileResponse.status});

  return Object.freeze({
    schema:'opencontainer.hosting-self-check.v0.1',
    baseUrl:base.href,
    ok:failures.length===0,
    failures:Object.freeze(failures.map(Object.freeze)),
    receipts:Object.freeze(receipts.map(Object.freeze)),
    profileId:profile?.profileId??null,
    note:'Header checks verify deployment policy. Actual crossOriginIsolated/SharedArrayBuffer behavior remains a browser-runtime acceptance requirement.'
  });
}
