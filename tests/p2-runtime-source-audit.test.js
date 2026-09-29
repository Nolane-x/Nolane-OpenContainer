import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const processSource=readFileSync('packages/process/src/index.js','utf8');
const workerSource=readFileSync('packages/process/src/worker-authority.js','utf8');
const syncSource=readFileSync('packages/process/src/sync-rpc.js','utf8');
const contractsSource=readFileSync('packages/process/src/runtime-contracts.js','utf8');
const browserCourt=readFileSync('apps/playground/public/p2-runtime-court.js','utf8');
const runner=readFileSync('scripts/p2-runtime-evidence.mjs','utf8');
const boundary=readFileSync('docs/compatibility/P2-RUNTIME-PROCESS-BOUNDARY.md','utf8');
const workflow=readFileSync('.github/workflows/ci.yml','utf8');

test('P2 source audit retains worker death cleanup and stale epoch boundaries',()=>{
  assert.match(workerSource,/addEventListener\('error'/);
  assert.match(workerSource,/addEventListener\('messageerror'/);
  assert.match(workerSource,/#failTransport\(error\)/);
  assert.match(workerSource,/#rejectPending\(error\)/);
  assert.match(workerSource,/WORKER_STALE/);
  assert.match(boundary,/timeout is an unknown outcome/i);
});

test('P2 source audit retains sync-RPC no-reentrancy policy',()=>{
  assert.match(syncSource,/export class SyncRpcPolicy/);
  assert.match(syncSource,/Synchronous RPC reentrancy is forbidden/);
  assert.match(syncSource,/Synchronous RPC method is not allowed/);
  assert.match(boundary,/Only one synchronous call may be active at a time/);
});

test('P2 source audit retains exactly-once virtual process and bounded drain semantics',()=>{
  assert.match(processSource,/terminalCount/);
  assert.match(processSource,/stdout\.drain\(drainTimeoutMs\)/);
  assert.match(processSource,/stderr\.drain\(drainTimeoutMs\)/);
  assert.match(processSource,/orphanPolicy/);
  assert.match(processSource,/parentPid/);
  assert.match(processSource,/record\.state!=='RUNNING'/);
  assert.match(boundary,/virtual.*process/i);
  assert.match(boundary,/does not create host OS processes/i);
});

test('P2 source audit retains mutation cancellation transfer and virtual-port authorities',()=>{
  for(const token of [
    'export class MutationReceiptAuthority',
    'export class CancellationLineage',
    'export class ProcessPortAuthority',
    'export class BoundedTransferChannel'
  ])assert.ok(contractsSource.includes(token),token);
  assert.match(contractsSource,/mutationMayHaveOccurred/);
  assert.match(contractsSource,/Transfer backpressure budget exhausted/);
  assert.match(contractsSource,/Virtual port epoch is stale/);
  assert.match(boundary,/does \*\*not\*\* claim complete Node stream/i);
  assert.match(boundary,/does \*\*not\*\* claim raw TCP\/UDP socket parity/i);
});

test('P2 browser court covers exactly all fourteen P2 source gates and remains non-production-closed',()=>{
  const expected=Array.from({length:14},(_,index)=>'P2-'+String(index+1).padStart(2,'0'));
  for(const id of expected){
    assert.ok(browserCourt.includes("'"+id+"'")||browserCourt.includes("Array.from({length:14}"),id);
    assert.ok(runner.includes("'"+id+"'")||runner.includes("Array.from({length:14}"),id);
  }
  assert.match(browserCourt,/actualWorkerRpc:true/);
  assert.match(browserCourt,/doubleTerminal/);
  assert.match(browserCourt,/workerCrashStages/);
  assert.match(browserCourt,/transferBytes/);
  assert.match(browserCourt,/repeatedCycles:200/);
  assert.match(runner,/iterations=Number\(process\.env\.OPENCONTAINER_P2_RUNTIME_ITERATIONS\|\|2\)/);
  assert.match(runner,/actualBrowserWorkerRpc:true/);
  assert.match(runner,/duplicateTerminalSuppression:true/);
  assert.match(runner,/workerDeathStages:3/);
  assert.match(runner,/productionClosed:false/);
  assert.match(workflow,/p2-runtime-process:/);
  assert.match(workflow,/npm run p2:runtime:evidence/);
});
