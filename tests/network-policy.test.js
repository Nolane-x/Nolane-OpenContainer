import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NetworkAuthority,
  NetworkProfiles,
  NETWORK_POLICY_VERSION,
  canonicalizeNetworkUrl,
  classifyNetworkHost,
  probeLocalNetworkAccess
} from '../packages/network/src/index.js';
import { ErrorCodes } from '../packages/protocol/src/index.js';

async function expectCode(action,code){
  try{await action();assert.fail('expected '+code);}
  catch(error){assert.equal(error.code,code);}
}

test('network URL canonicalization rejects credentials backslashes encoded authorities and separators',async()=>{
  assert.equal(canonicalizeNetworkUrl('HTTPS://Example.COM:443/api').href,'https://example.com/api');
  await expectCode(()=>Promise.resolve(canonicalizeNetworkUrl('https://user:pass@example.com/api')),ErrorCodes.NETWORK_DENIED);
  await expectCode(()=>Promise.resolve(canonicalizeNetworkUrl('https:\\\\example.com\\api')),ErrorCodes.NETWORK_DENIED);
  await expectCode(()=>Promise.resolve(canonicalizeNetworkUrl('https://exa%6dple.com/api')),ErrorCodes.NETWORK_DENIED);
  await expectCode(()=>Promise.resolve(canonicalizeNetworkUrl('https://example.com/api/%2fadmin')),ErrorCodes.NETWORK_DENIED);
});

test('canonicalization denial is audit-safe and retains policy identity',async()=>{
  const net=new NetworkAuthority({policyId:'canonicalization-court'});
  const secretUrl='https://user:super-secret-password@example.com/api?token=secret-query';
  await expectCode(()=>Promise.resolve(net.authorize(secretUrl)),ErrorCodes.NETWORK_DENIED);
  const receipt=net.decisions().at(-1);
  assert.equal(receipt.decision,'deny');
  assert.equal(receipt.reason,'url-canonicalization');
  assert.equal(receipt.auditUrl,'[invalid-or-ambiguous-url]');
  assert.equal(receipt.policyVersion,NETWORK_POLICY_VERSION);
  assert.equal(receipt.policyHash,net.policyHash);
  assert.equal(JSON.stringify(receipt).includes('super-secret-password'),false);
  assert.equal(JSON.stringify(receipt).includes('secret-query'),false);
});

test('network local classification covers canonical alternate loopback and private spellings',()=>{
  for(const input of [
    'http://localhost/',
    'http://sub.localhost/',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::1]/'
  ]){
    const url=canonicalizeNetworkUrl(input);
    assert.equal(classifyNetworkHost(url.hostname),'loopback',input+' normalized to '+url.hostname);
  }
  for(const host of ['10.0.0.1','172.16.1.2','172.31.255.1','192.168.2.3','169.254.1.1']){
    assert.equal(classifyNetworkHost(host),'private',host);
  }
  assert.equal(classifyNetworkHost('8.8.8.8'),'public');
});

test('network decisions carry stable policy version hash and path-boundary truth',async()=>{
  const net=new NetworkAuthority({policyId:'court'});
  const before=net.policyHash;
  net.allow({id:'api',origin:'https://example.com',methods:['GET'],paths:['/api']});
  assert.notEqual(net.policyHash,before);
  const allowed=net.authorize('https://EXAMPLE.com:443/api/v1?token=secret#frag');
  assert.equal(allowed.policyVersion,NETWORK_POLICY_VERSION);
  assert.equal(allowed.policyHash,net.policyHash);
  assert.equal(allowed.ruleId,'api');
  assert.equal(allowed.url,'https://example.com/api/v1?token=secret');
  assert.equal(allowed.auditUrl,'https://example.com/api/v1');
  assert.equal(JSON.stringify(allowed).includes('token=secret'),true);
  assert.equal(JSON.stringify(net.decisions()).includes('token=secret'),false);
  await expectCode(()=>Promise.resolve(net.authorize('https://example.com/apievil')),ErrorCodes.NETWORK_DENIED);
  const denied=net.decisions().at(-1);
  assert.equal(denied.decision,'deny');
  assert.equal(denied.policyHash,net.policyHash);
  assert.equal(denied.auditUrl,'https://example.com/apievil');
});

test('network profiles are monotonic and downgrade truth is explicit',async()=>{
  const offline=new NetworkAuthority({profile:NetworkProfiles.OFFLINE});
  await expectCode(()=>Promise.resolve(offline.authorize('https://registry.npmjs.org/x')),ErrorCodes.NETWORK_DENIED);
  await expectCode(()=>Promise.resolve(offline.allow({origin:'https://registry.npmjs.org'})),ErrorCodes.NETWORK_DENIED);

  const registry=new NetworkAuthority({profile:NetworkProfiles.REGISTRY_ONLY});
  registry.allow({
    id:'npm',
    origin:'https://registry.npmjs.org',
    methods:['GET'],
    paths:['/'],
    category:'registry'
  });
  assert.equal(registry.authorize('https://registry.npmjs.org/pkg').decision,'allow');
  await expectCode(
    ()=>Promise.resolve(registry.allow({origin:'https://example.com',category:'registry'})),
    ErrorCodes.NETWORK_DENIED
  );

  const restricted=new NetworkAuthority({profile:NetworkProfiles.RESTRICTED})
    .allow({origin:'https://example.com',methods:['GET'],paths:['/api']});
  assert.equal(restricted.authorize('https://example.com/api').profile,'restricted');
  await expectCode(()=>Promise.resolve(restricted.authorize('https://other.example/')),ErrorCodes.NETWORK_DENIED);

  const open=new NetworkAuthority({profile:NetworkProfiles.OPEN_WEB});
  assert.equal(open.authorize('https://other.example/path').ruleId,'profile:open-web');
  await expectCode(()=>Promise.resolve(open.authorize('http://127.0.0.1/')),ErrorCodes.NETWORK_DENIED);
});

test('managed fetch reauthorizes every redirect hop and denies capability widening',async()=>{
  const fetched=[];
  const net=new NetworkAuthority({
    fetchImpl:async(url,options)=>{
      fetched.push([url,options.redirect]);
      if(url==='https://registry.example/pkg/a')return new Response(null,{status:302,headers:{location:'https://cdn.example/artifacts/a'}});
      return new Response('ok',{status:200});
    }
  })
    .allow({id:'registry',origin:'https://registry.example',methods:['GET'],paths:['/pkg']})
    .allow({id:'cdn',origin:'https://cdn.example',methods:['GET'],paths:['/artifacts']});
  const result=await net.fetch('https://registry.example/pkg/a');
  assert.equal(await result.response.text(),'ok');
  assert.equal(result.receipt.redirects,1);
  assert.deepEqual(fetched,[
    ['https://registry.example/pkg/a','manual'],
    ['https://cdn.example/artifacts/a','manual']
  ]);

  const denied=new NetworkAuthority({
    fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/a'}})
  }).allow({origin:'https://registry.example',methods:['GET'],paths:['/pkg']});
  let calls=0;
  denied.constructor; // keep linter-free access shape stable
  const guarded=new NetworkAuthority({
    fetchImpl:async()=>{
      calls++;
      return new Response(null,{status:302,headers:{location:'https://evil.example/a'}});
    }
  }).allow({origin:'https://registry.example',methods:['GET'],paths:['/pkg']});
  await expectCode(()=>guarded.fetch('https://registry.example/pkg/a'),ErrorCodes.NETWORK_DENIED);
  assert.equal(calls,1);
});

test('managed fetch enforces decoded streaming bytes rather than Content-Length',async()=>{
  const body=new ReadableStream({
    start(controller){
      controller.enqueue(new Uint8Array(400));
      controller.enqueue(new Uint8Array(400));
      controller.close();
    }
  });
  const net=new NetworkAuthority({
    fetchImpl:async()=>new Response(body,{status:200,headers:{'content-length':'12','content-encoding':'gzip'}}),
    maxResponseBytes:512
  }).allow({origin:'https://example.com',methods:['GET']});
  await expectCode(()=>net.fetch('https://example.com/data'),ErrorCodes.OUTPUT_LIMIT);
});

test('managed fetch propagates cancellation through response streaming',async()=>{
  let cancelled=false;
  const body=new ReadableStream({
    start(controller){
      setTimeout(()=>{if(!cancelled)controller.enqueue(new Uint8Array([1,2,3]));},5);
      setTimeout(()=>{if(!cancelled)controller.enqueue(new Uint8Array([4,5,6]));},200);
    },
    cancel(){cancelled=true;}
  });
  const net=new NetworkAuthority({
    fetchImpl:async()=>new Response(body,{status:200})
  }).allow({origin:'https://example.com',methods:['GET']});
  const controller=new AbortController();
  setTimeout(()=>controller.abort(new DOMException('court-abort','AbortError')),30);
  await assert.rejects(
    ()=>net.fetch('https://example.com/slow',{signal:controller.signal}),
    (error)=>error?.name==='AbortError'
  );
  assert.equal(cancelled,true);
});

test('opaque secret handles enforce scheme host method path session and task scope',async()=>{
  const observed=[];
  const net=new NetworkAuthority({
    fetchImpl:async(url,options)=>{
      observed.push({
        url,
        authorization:options.headers.get('authorization'),
        cookie:options.headers.get('cookie')
      });
      return new Response('authorized',{status:200});
    }
  }).allow({origin:'https://api.example',methods:['GET'],paths:['/v1']});

  const secretValue='p5-secret-value-that-must-never-appear-in-receipts';
  const secret=net.createSecret({
    value:secretValue,
    header:'authorization',
    prefix:'Bearer ',
    scope:{
      schemes:['https:'],
      hosts:['api.example'],
      methods:['GET'],
      paths:['/v1/private'],
      session:'session-a',
      task:'task-a'
    }
  });
  assert.equal(secret.plaintextExposed,false);
  assert.equal(JSON.stringify(secret).includes(secretValue),false);
  assert.equal(JSON.stringify(net.secretInfo(secret.handle)).includes(secretValue),false);

  const result=await net.fetch('https://api.example/v1/private/data',{
    secretHandle:secret.handle,
    session:'session-a',
    task:'task-a'
  });
  assert.equal(await result.response.text(),'authorized');
  assert.equal(observed[0].authorization,'Bearer '+secretValue);
  assert.equal(observed[0].cookie,null);
  assert.equal(result.receipt.secretPlaintextExposed,false);
  assert.equal(JSON.stringify(result.receipt).includes(secretValue),false);
  assert.equal(JSON.stringify(net.decisions()).includes(secretValue),false);

  for(const request of [
    {url:'https://api.example/v1/other',session:'session-a',task:'task-a'},
    {url:'https://api.example/v1/private',session:'wrong',task:'task-a'},
    {url:'https://api.example/v1/private',session:'session-a',task:'wrong'}
  ]){
    await expectCode(
      ()=>net.fetch(request.url,{secretHandle:secret.handle,session:request.session,task:request.task}),
      ErrorCodes.NETWORK_DENIED
    );
  }
  assert.equal(observed.length,1,'out-of-scope secret requests must fail before fetch');
});

test('managed fetch rejects caller-provided Authorization/Cookie plaintext',async()=>{
  let fetched=0;
  const net=new NetworkAuthority({
    fetchImpl:async()=>{fetched++;return new Response('no');}
  }).allow({origin:'https://api.example',methods:['GET']});
  await expectCode(
    ()=>net.fetch('https://api.example/',{headers:{authorization:'Bearer plaintext'}}),
    ErrorCodes.NETWORK_DENIED
  );
  await expectCode(
    ()=>net.fetch('https://api.example/',{headers:{cookie:'session=plaintext'}}),
    ErrorCodes.NETWORK_DENIED
  );
  assert.equal(fetched,0);
});

test('browser Local Network Access probe reports permission behavior without inventing support',async()=>{
  const calls=[];
  const supported=await probeLocalNetworkAccess({
    permissions:{
      async query({name}){
        calls.push(name);
        if(name==='local-network-access')return {state:'prompt'};
        throw new TypeError('unsupported');
      }
    }
  });
  assert.equal(supported.permissionsApi,true);
  assert.equal(supported.permissionName,'local-network-access');
  assert.equal(supported.state,'prompt');

  const absent=await probeLocalNetworkAccess({});
  assert.equal(absent.permissionsApi,false);
  assert.equal(absent.state,'unsupported');
});
