import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyFinalClosureCampaign } from '../scripts/verify-final-closure-campaign.mjs';

const manifest=JSON.parse(readFileSync('release/FINAL-CLOSURE-CAMPAIGN.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('final closure campaign maps exactly all 27 currently open gates',async()=>{
  const result=await verifyFinalClosureCampaign({manifest,ledger});
  assert.equal(result.status,'PASS',result.errors.join('\n'));
  assert.deepEqual(result.ledger,{closed:277,open:27,total:304,productionClosed:false});
  assert.equal(result.routeCount,13);
  assert.equal(result.routedGateCount,27);
  assert.equal(result.openGates.length,27);
  assert.equal(result.closureEligible,false);
  assert.equal(result.autoPromotion,false);
});

test('every final campaign route stays candidate-only and has real repository entrypoints',async()=>{
  const result=await verifyFinalClosureCampaign({manifest,ledger});
  for(const route of result.routeReports){
    assert.equal(route.closureEligible,false,route.id);
    assert.equal(route.autoPromotion,false,route.id);
    assert.ok(route.entrypoints.length>=1,route.id);
    for(const entry of route.entrypoints){
      assert.equal(entry.exists,true,route.id+' '+entry.path);
      assert.deepEqual(entry.workflowSecurity,[],route.id+' '+entry.path);
    }
  }
});

test('high-risk remaining gates use their preregistered human/device/admin/legal authorities',()=>{
  const gateRoute=gate=>{
    const routes=manifest.routes.filter(x=>x.gates.includes(gate));
    assert.equal(routes.length,1,gate);
    return routes[0];
  };
  assert.equal(gateRoute('P1-15').id,'field-browser-incident');
  assert.equal(gateRoute('P7-09').id,'reference-device-core');
  assert.equal(gateRoute('P9-05').id,'p9-human-acceptance');
  assert.equal(gateRoute('P9-12').id,'weak-device-ui-budget');
  assert.equal(gateRoute('P12-18').id,'external-security-review');
  assert.equal(gateRoute('P13-03').id,'trusted-publisher-admin-decision');
  assert.equal(gateRoute('P13-17').id,'repository-trust-state');
  assert.equal(gateRoute('P14-04').id,'adjacent-published-release');
  assert.equal(gateRoute('P16-01').id,'final-license-decision');
  assert.equal(gateRoute('P16-05').id,'fto-counsel-review');
});

test('campaign verifier fails closed when one open gate loses its route',async()=>{
  const broken=structuredClone(manifest);
  broken.routes=broken.routes.map(route=>({...route,gates:route.gates.filter(id=>id!=='P16-05')})).filter(route=>route.gates.length);
  const result=await verifyFinalClosureCampaign({manifest:broken,ledger});
  assert.equal(result.status,'FAIL');
  assert.ok(result.errors.some(x=>x.includes('P16-05')));
});

test('campaign verifier rejects duplicate routes and automatic promotion',async()=>{
  const broken=structuredClone(manifest);
  broken.routes.push({
    ...structuredClone(broken.routes[0]),
    id:'duplicate-public-topology',
    autoPromotion:true
  });
  const result=await verifyFinalClosureCampaign({manifest:broken,ledger});
  assert.equal(result.status,'FAIL');
  assert.ok(result.errors.some(x=>x.includes('routed more than once')));
  assert.ok(result.errors.some(x=>x.includes('autoPromotion must remain false')));
});

test('campaign baseline cannot drift from production ledger',async()=>{
  const broken=structuredClone(manifest);
  broken.ledgerBaseline.closed=278;
  const result=await verifyFinalClosureCampaign({manifest:broken,ledger});
  assert.equal(result.status,'FAIL');
  assert.ok(result.errors.includes('ledgerBaseline.closed drift'));
});

test('final closure campaign verifier is retained by critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/final-closure-campaign.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=116);
  assert.equal(flake.contract.iterations,5);
});
