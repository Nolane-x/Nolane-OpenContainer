import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProductScopeInputs, validateProductScope } from '../scripts/verify-product-scope.mjs';
import { parseChromeVersion, parseOsRelease, validateBrowserProfile } from '../scripts/verify-browser-profile.mjs';

function clone(value){return JSON.parse(JSON.stringify(value));}

test('P0 product scope is frozen to nine surfaces and exact Node/npm oracle',async()=>{
  const inputs=await loadProductScopeInputs();
  assert.deepEqual(validateProductScope(inputs),[]);
  assert.equal(inputs.policy.coreSurfaceCount,9);
  assert.deepEqual(inputs.policy.coreSurfaces.map(x=>x.namespace),[
    'runtime','runtime.fs','runtime.process','runtime.packages','runtime.net','runtime.preview','runtime.snapshots','runtime.resources','runtime.diagnostics'
  ]);
  assert.deepEqual(inputs.policy.oracle,{node:'24.21.0',npm:'11.19.0'});
});

test('scope creep or oracle drift fails closed',async()=>{
  const inputs=clone(await loadProductScopeInputs());
  inputs.policy.coreSurfaces.push({id:'S10',name:'AI',namespace:'runtime.ai'});
  inputs.policy.coreSurfaceCount=10;
  inputs.policy.oracle.node='25.0.0';
  const errors=validateProductScope(inputs);
  assert.ok(errors.some(x=>x.includes('exactly nine')));
  assert.ok(errors.some(x=>x.includes('constitution drifted')));
  assert.ok(errors.some(x=>x.includes('oracle drifted')));
});

test('required unsupported and out-of-Core classes cannot disappear',async()=>{
  const inputs=clone(await loadProductScopeInputs());
  inputs.policy.unsupportedClasses=inputs.policy.unsupportedClasses.filter(x=>x.id!=='native-addons');
  inputs.policy.outOfCore=inputs.policy.outOfCore.filter(x=>x.id!=='ai');
  const errors=validateProductScope(inputs);
  assert.ok(errors.includes('missing unsupported class native-addons'));
  assert.ok(errors.includes('missing out-of-Core boundary ai'));
});

test('release blocker taxonomy includes data loss isolation secret exposure and silent corruption',async()=>{
  const inputs=clone(await loadProductScopeInputs());
  inputs.policy.severity.releaseBlockers=inputs.policy.severity.releaseBlockers.filter(x=>x.id!=='SECRET_EXPOSURE');
  const errors=validateProductScope(inputs);
  assert.ok(errors.includes('missing release-blocking severity SECRET_EXPOSURE'));
});

test('scope debt must carry owner removal plan and revisit trigger',async()=>{
  const inputs=clone(await loadProductScopeInputs());
  inputs.scopeDebt.entries[0].owner='';
  inputs.scopeDebt.entries[0].removalOrRehomePlan='';
  inputs.scopeDebt.entries[0].revisitTrigger='';
  const errors=validateProductScope(inputs);
  assert.ok(errors.some(x=>x.includes('has no owner')));
  assert.ok(errors.some(x=>x.includes('has no removal/rehome plan')));
  assert.ok(errors.some(x=>x.includes('has no revisit trigger')));
});

test('public claims require named profile and retained evidence refs',async()=>{
  const inputs=clone(await loadProductScopeInputs());
  inputs.claims.claims[0].profileId='some-other-profile';
  inputs.claims.claims[0].evidence=[];
  const errors=validateProductScope(inputs);
  assert.ok(errors.some(x=>x.includes('wrong/missing profileId')));
  assert.ok(errors.some(x=>x.includes('has no retained evidence refs')));
});

test('critical gate waiver cannot exist without full decision record',async()=>{
  const inputs=clone(await loadProductScopeInputs());
  inputs.waivers.waivers=[{gate:'P0-01',rationale:'test'}];
  const errors=validateProductScope(inputs);
  assert.ok(errors.some(x=>x.includes('missing decisionRecord')));
  assert.ok(errors.some(x=>x.includes('missing approvedBy')));
  assert.ok(errors.some(x=>x.includes('missing revisitTrigger')));
});

test('undocumented ledger waiver fails closed',async()=>{
  const inputs=clone(await loadProductScopeInputs());
  inputs.ledger.overrides[0].waiver=true;
  const errors=validateProductScope(inputs);
  assert.ok(errors.some(x=>x.includes('undocumented critical waiver')));
});

test('browser evidence parser freezes Chrome major 153 on Ubuntu 24.04 x64',()=>{
  const chrome=parseChromeVersion('Google Chrome 153.0.8010.52');
  const osRelease=parseOsRelease('ID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.3 LTS"\n');
  const policy={declaredEvidenceProfile:{browser:{major:153},os:{platform:'linux',distribution:'ubuntu',version:'24.04',arch:'x64'}}};
  assert.deepEqual(validateBrowserProfile({policy,chrome,osRelease,platform:'linux',arch:'x64'}),[]);
  assert.ok(validateBrowserProfile({policy,chrome:{...chrome,major:154},osRelease,platform:'linux',arch:'x64'}).some(x=>x.includes('outside frozen')));
  assert.ok(validateBrowserProfile({policy,chrome,osRelease,platform:'darwin',arch:'arm64'}).length>=2);
});
