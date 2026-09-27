import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenContainer } from '../packages/sdk/src/index.js';
import {
  BrokerSsrfRequirements,
  NetworkAuthority,
  NetworkProfiles,
  canonicalizeExternalUrl,
  isLocalNetworkHost
} from '../packages/network/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

async function expectCode(action,code){
  try{
    await action();
    assert.fail('expected '+code);
  }catch(error){
    assert.equal(error?.code,code);
  }
}

test('network URL canonicalization rejects credentials backslashes and encoded hosts',()=>{
  assert.equal(canonicalizeExternalUrl('https://example.com/a/../b').href,'https://example.com/b');
  assert.throws(()=>canonicalizeExternalUrl('https://user:pass@example.com/a'),error=>error?.code===ErrorCodes.NETWORK_DENIED);
  assert.throws(()=>canonicalizeExternalUrl('https://example.com\\evil.test/a'),error=>error?.code===ErrorCodes.NETWORK_DENIED);
  assert.throws(()=>canonicalizeExternalUrl('https://%65xample.com/a'),error=>error?.code===ErrorCodes.NETWORK_DENIED);
});

test('loopback and private aliases stay local after URL canonicalization',()=>{
  for(const value of ['http://127.0.0.1/','http://127.1/','http://2130706433/','http://[::1]/']){
    const parsed=canonicalizeExternalUrl(value);
    assert.equal(isLocalNetworkHost(parsed.hostname),true,value+' was not classified local');
  }
  assert.equal(isLocalNetworkHost('10.2.3.4'),true);
  assert.equal(isLocalNetworkHost('172.20.1.2'),true);
  assert.equal(isLocalNetworkHost('192.168.1.2'),true);
  assert.equal(isLocalNetworkHost('example.com'),false);
});

test('network policy profiles are frozen and only downgrade in-place',async()=>{
  const net=new NetworkAuthority({profile:NetworkProfiles.OPEN_WEB});
  const open=net.authorize('https://example.com/a');
  assert.equal(open.profile,NetworkProfiles.OPEN_WEB);
  const before=net.policyReceipt;
  net.setProfile(NetworkProfiles.RESTRICTED);
  const after=net.policyReceipt;
  assert.notEqual(before.hash,after.hash);
  await expectCode(()=>Promise.resolve(net.authorize('https://example.com/a')),ErrorCodes.NETWORK_DENIED);
  net.allow({origin:'https://example.com',methods:['GET'],paths:['/api']});
  assert.equal(net.authorize('https://example.com/api/v1').allowed,true);
  await expectCode(()=>Promise.resolve(net.authorize('https://example.com/apix')),ErrorCodes.NETWORK_DENIED);
  await expectCode(()=>Promise.resolve(net.setProfile(NetworkProfiles.OPEN_WEB)),ErrorCodes.NETWORK_DENIED);
  net.setProfile(NetworkProfiles.OFFLINE);
  await expectCode(()=>Promise.resolve(net.authorize('https://example.com/api/v1')),ErrorCodes.NETWORK_DENIED);
});

test('registry-only profile accepts only registry-class capabilities',async()=>{
  const net=new NetworkAuthority({profile:NetworkProfiles.REGISTRY_ONLY})
    .allow({origin:'https://registry.example',class:'registry',paths:['/pkg/']})
    .allow({origin:'https://api.example',paths:['/']});
  assert.equal(net.authorize('https://registry.example/pkg/a.tgz').ruleClass,'registry');
  await expectCode(()=>Promise.resolve(net.authorize('https://api.example/v1')),ErrorCodes.NETWORK_DENIED);
});

test('policy version and hash are retained on allow and deny decisions',async()=>{
  const net=new NetworkAuthority({policyVersion:'oc-network-test-v7'}).allow({origin:'https://example.com',paths:['/ok']});
  const allowed=net.authorize('https://example.com/ok');
  assert.equal(allowed.policyVersion,'oc-network-test-v7');
  assert.match(allowed.policyHash,/^ocnp:[0-9a-f]{16}$/);
  try{net.authorize('https://example.com/no');assert.fail('expected deny');}
  catch(error){
    assert.equal(error.code,ErrorCodes.NETWORK_DENIED);
    assert.equal(error.details.policyVersion,'oc-network-test-v7');
    assert.equal(error.details.policyHash,allowed.policyHash);
  }
});

test('opaque secret handles inject plaintext only inside matching authority scope',async()=>{
  const SECRET='p5-unit-secret-abcdefghijklmnopqrstuvwxyz';
  let observedAuthorization=null;
  const net=new NetworkAuthority({
    fetchImpl:async (_url,options)=>{
      observedAuthorization=options.headers.get('authorization');
      return new Response('ok',{status:200});
    }
  }).allow({origin:'https://api.example',methods:['GET'],paths:['/v1/']});
  const binding=net.bindSecret({
    value:SECRET,
    header:'authorization',
    prefix:'Bearer ',
    scope:{
      schemes:['https:'],
      hosts:['api.example'],
      methods:['GET'],
      paths:['/v1/'],
      session:'s1',
      process:'p1',
      task:'t1'
    }
  });
  assert.match(binding.handle,/^ocsecret:/);
  assert.equal(JSON.stringify(binding).includes(SECRET),false);
  const result=await net.fetch('https://api.example/v1/data',{
    secretHandles:[binding.handle],
    context:{session:'s1',process:'p1',task:'t1'}
  });
  assert.equal(observedAuthorization,'Bearer '+SECRET);
  assert.equal(await result.response.text(),'ok');
  assert.equal(JSON.stringify(result.receipt).includes(SECRET),false);
  assert.equal(JSON.stringify(result.receipt).includes(binding.handle),false);
  await expectCode(()=>net.fetch('https://api.example/v1/data',{
    secretHandles:[binding.handle],
    context:{session:'s1',process:'p1',task:'wrong'}
  }),ErrorCodes.NETWORK_DENIED);
  await expectCode(()=>net.fetch('https://api.example/v1/data',{
    headers:{authorization:'Bearer raw-secret'}
  }),ErrorCodes.NETWORK_DENIED);
});

test('secret scope enforces expiry scheme host method and path',async()=>{
  const net=new NetworkAuthority({fetchImpl:async()=>new Response('ok')})
    .allow({origin:'https://api.example',methods:['GET','POST'],paths:['/v1/']});
  const binding=net.bindSecret({
    value:'expired-secret-value-abcdefghijklmnop',
    scope:{hosts:['api.example'],methods:['POST'],paths:['/v1/private'],expiresAt:Date.now()-1}
  });
  await expectCode(()=>net.fetch('https://api.example/v1/private',{
    method:'POST',
    secretHandles:[binding.handle]
  }),ErrorCodes.NETWORK_DENIED);
});

test('redirect hops are re-authorized and cannot widen path capability',async()=>{
  const calls=[];
  const net=new NetworkAuthority({
    fetchImpl:async(url)=>{
      calls.push(url);
      if(url==='https://api.example/start')return new Response(null,{status:302,headers:{location:'/allowed/final'}});
      if(url==='https://api.example/start-denied')return new Response(null,{status:302,headers:{location:'/outside/final'}});
      return new Response('ok');
    }
  }).allow({origin:'https://api.example',methods:['GET'],paths:['/start','/start-denied','/allowed/']});
  const ok=await net.fetch('https://api.example/start');
  assert.equal(ok.receipt.redirects,1);
  assert.deepEqual(calls.slice(0,2),['https://api.example/start','https://api.example/allowed/final']);
  const before=calls.length;
  await expectCode(()=>net.fetch('https://api.example/start-denied'),ErrorCodes.NETWORK_DENIED);
  assert.equal(calls.length,before+1,'denied redirect target was fetched before authorization');
});

test('response budget counts decoded streamed bytes instead of trusting Content-Length',async()=>{
  const stream=new ReadableStream({
    start(controller){
      controller.enqueue(new Uint8Array(12));
      controller.enqueue(new Uint8Array(12));
      controller.close();
    }
  });
  const net=new NetworkAuthority({
    maxResponseBytes:20,
    fetchImpl:async()=>new Response(stream,{status:200,headers:{'content-length':'1'}})
  }).allow({origin:'https://api.example'});
  await expectCode(()=>net.fetch('https://api.example/data'),ErrorCodes.OUTPUT_LIMIT);
});

test('network body cancellation propagates to reader and rejects promptly',async()=>{
  let cancelled=false;
  let timer=null;
  const stream=new ReadableStream({
    start(controller){
      timer=setTimeout(()=>controller.enqueue(new Uint8Array([1,2,3])),1000);
    },
    cancel(){cancelled=true;clearTimeout(timer);}
  });
  const net=new NetworkAuthority({
    fetchImpl:async()=>new Response(stream,{status:200})
  }).allow({origin:'https://api.example'});
  const controller=new AbortController();
  const pending=net.fetch('https://api.example/slow',{signal:controller.signal});
  setTimeout(()=>controller.abort(new DOMException('test abort','AbortError')),10);
  await assert.rejects(pending,(error)=>error?.name==='AbortError');
  assert.equal(cancelled,true);
});

test('provider/API-key failure leaves canonical workspace generation unchanged',async()=>{
  const runtime=await OpenContainer.boot({
    network:{
      fetchImpl:async()=>new Response('provider denied',{status:401})
    }
  });
  runtime.mount({'project.txt':'stable'});
  runtime.net.allow({origin:'https://provider.example',paths:['/v1/']});
  const before=runtime.fs.snapshot();
  const secret=runtime.net.bindSecret({
    value:'provider-api-key-abcdefghijklmnopqrstuvwxyz',
    header:'authorization',
    prefix:'Bearer ',
    scope:{hosts:['provider.example'],paths:['/v1/']}
  });
  const result=await runtime.net.fetch('https://provider.example/v1/models',{secretHandles:[secret.handle]});
  assert.equal(result.response.status,401);
  const after=runtime.fs.snapshot();
  assert.equal(after.generation,before.generation);
  assert.equal(runtime.fs.readFile('project.txt'),'stable');
  await runtime.teardown();
});

test('broker SSRF contract is explicit and not implemented as an open proxy',()=>{
  assert.equal(BrokerSsrfRequirements.implementedInCore,false);
  assert.ok(BrokerSsrfRequirements.rules.some((rule)=>rule.includes('no arbitrary URL fetch proxy')));
  assert.ok(BrokerSsrfRequirements.rules.some((rule)=>rule.includes('re-authorize every redirect hop')));
});
