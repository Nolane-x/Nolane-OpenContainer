import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveAllGateIds,
  deriveOpenGateIds,
  validateFinalClosureAuthority
} from '../scripts/final-27-closure-authority.mjs';

const authority=JSON.parse(readFileSync('release/FINAL-27-CLOSURE-AUTHORITY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const packageJson=JSON.parse(readFileSync('package.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

const expectedOpen=[
  'P1-13','P1-14','P1-15',
  'P7-01','P7-09','P7-10','P7-12',
  'P9-05','P9-11','P9-12',
  'P11-12',
  'P12-17','P12-18','P12-20',
  'P13-03','P13-04','P13-07','P13-09','P13-10','P13-16','P13-17',
  'P14-04','P14-12','P14-14',
  'P15-12',
  'P16-01','P16-05'
];

test('derived source inventory is exactly 304 gates across 19 domains',()=>{
  const all=deriveAllGateIds(ledger);
  assert.equal(all.length,304);
  assert.equal(ledger.domains.length,19);
  assert.equal(new Set(all).size,304);
  assert.equal(all[0],'P0-01');
  assert.ok(all.includes('P18-12'));
});

test('current ledger derives exactly the frozen 27 open gates',()=>{
  const open=deriveOpenGateIds(ledger);
  assert.equal(open.length,27);
  assert.deepEqual([...open].sort(),[...expectedOpen].sort());
  assert.equal((ledger.overrides??[]).filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('final closure authority maps every open gate exactly once and validates all route boundaries',async()=>{
  const result=await validateFinalClosureAuthority({authority,ledger,packageJson});
  assert.equal(result.status,'PASS',result.errors.join('\n'));
  assert.equal(result.sourceGateCount,304);
  assert.equal(result.closedCount,277);
  assert.equal(result.openCount,27);
  assert.equal(result.mappedOpenCount,27);
  assert.equal(result.routeCount,11);
  assert.deepEqual([...result.openGates].sort(),[...expectedOpen].sort());
  assert.deepEqual(result.errors,[]);
  assert.equal(result.productionClosed,false);
});

test('a duplicate or missing gate route fails closed',async()=>{
  const duplicate=structuredClone(authority);
  duplicate.routes[1].gates.push('P1-13');
  const dup=await validateFinalClosureAuthority({authority:duplicate,ledger,packageJson});
  assert.equal(dup.status,'FAIL');
  assert.ok(dup.errors.some(x=>x.includes('multiple authority routes')));

  const missing=structuredClone(authority);
  missing.routes.find(x=>x.id==='legal-decisions').gates=
    missing.routes.find(x=>x.id==='legal-decisions').gates.filter(x=>x!=='P16-05');
  const miss=await validateFinalClosureAuthority({authority:missing,ledger,packageJson});
  assert.equal(miss.status,'FAIL');
  assert.ok(miss.errors.some(x=>x.includes('open gates missing authority route')&&x.includes('P16-05')));
});

test('a newly closed gate makes the authority map stale until explicitly reconciled',async()=>{
  const promoted=structuredClone(ledger);
  promoted.overrides.push({
    id:'P16-05',
    state:'EXTERNAL',
    promotion:'LEGAL-REVIEWED',
    evidence:'future-counsel-review',
    closure_met:true
  });
  const result=await validateFinalClosureAuthority({authority,ledger:promoted,packageJson});
  assert.equal(result.status,'FAIL');
  assert.equal(result.openCount,26);
  assert.ok(result.errors.some(x=>x.includes('non-open gates')&&x.includes('P16-05')));
});

test('all external workflow routes remain manual read-only and secret-free',async()=>{
  const result=await validateFinalClosureAuthority({authority,ledger,packageJson});
  assert.equal(result.status,'PASS',result.errors.join('\n'));
  const workflowRoutes=authority.routes.filter(x=>x.entrypoint.startsWith('.github/workflows/'));
  assert.ok(workflowRoutes.length>=8);
  for(const route of workflowRoutes){
    const source=readFileSync(route.entrypoint,'utf8');
    assert.match(source,/workflow_dispatch:/,route.id);
    assert.match(source,/permissions:\n\s+contents:\s+read/,route.id);
    assert.doesNotMatch(source,/\$\{\{ secrets\.|id-token:\s*write|contents:\s*write|packages:\s*write|npm publish/,route.id);
  }
});

test('repository trust route is deliberately local-admin rather than workflow secret authority',()=>{
  const route=authority.routes.find(x=>x.id==='repository-trust');
  assert.equal(route.authorityType,'local-admin-external-state');
  assert.equal(route.entrypoint,'scripts/repository-trust-state.mjs');
  assert.equal(route.command,'npm run repository:trust:evidence');
  const trust=JSON.parse(readFileSync(route.policy,'utf8'));
  assert.equal(trust.repositoryTrust.mode,'local-admin-cli');
  assert.equal(trust.repositoryTrust.workflowPresent,false);
});

test('final closure routing cannot itself promote ledger state',()=>{
  assert.equal(authority.forbiddenAutoPromotion,true);
  assert.equal(authority.productionClosed,false);
  for(const route of authority.routes)assert.equal(route.automaticLedgerClosure,false,route.id);
  assert.equal(ledger.production_closed,false);
});

test('final 27 authority test is retained by repeated critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/final-27-closure-authority.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=116);
  assert.equal(flake.contract.iterations,5);
});
