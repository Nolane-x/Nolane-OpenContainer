import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { checkHostingHeaders } from '../scripts/hosting-self-check-lib.mjs';

async function freePort(){
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}

async function waitForPlayground(child){
  let output='';
  const done=new Promise((resolve,reject)=>{
    child.stdout.on('data',(chunk)=>{
      output+=chunk;
      if(output.includes('OpenContainer playground:'))resolve();
    });
    child.once('error',reject);
    child.once('exit',(code)=>reject(new Error('playground exited before ready: '+code+' '+output)));
  });
  await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('playground startup timeout')),5000))]);
}

test('hosting self-check passes against the promoted playground topology',async()=>{
  const port=await freePort();
  const child=spawn(process.execPath,['apps/playground/server.mjs'],{
    env:{...process.env,PORT:String(port)},
    stdio:['ignore','pipe','pipe']
  });
  try{
    await waitForPlayground(child);
    const receipt=await checkHostingHeaders('http://127.0.0.1:'+port+'/');
    assert.equal(receipt.ok,true,JSON.stringify(receipt.failures));
    assert.equal(receipt.profileId,'opencontainer-alpha-chromium-node24-v1');
    assert.equal(receipt.failures.length,0);
    assert.equal(receipt.receipts.length,5);
  }finally{
    child.kill('SIGTERM');
    await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,1000))]);
  }
});

test('hosting self-check reports exact header failures instead of a generic deployment error',async()=>{
  const bad=createServer((req,res)=>{
    res.statusCode=200;
    if(req.url==='/docs/production/PRODUCTION-PROFILE.json'){
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({schema:'opencontainer.production-profile.v0.1',productionClosed:false,profileId:'bad'}));
      return;
    }
    res.end('ok');
  });
  bad.listen(0,'127.0.0.1');
  await once(bad,'listening');
  try{
    const port=bad.address().port;
    const receipt=await checkHostingHeaders('http://127.0.0.1:'+port+'/');
    assert.equal(receipt.ok,false);
    assert.ok(receipt.failures.some(item=>item.header==='cross-origin-opener-policy'&&item.expected==='same-origin'));
    assert.ok(receipt.failures.some(item=>item.path==='/opencontainer-guest-worker.mjs'&&item.kind==='header'));
    assert.ok(receipt.failures.some(item=>item.header==='service-worker-allowed'));
  }finally{
    await new Promise((resolve,reject)=>bad.close(error=>error?reject(error):resolve()));
  }
});
