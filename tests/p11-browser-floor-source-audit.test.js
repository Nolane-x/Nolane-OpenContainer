import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const matrix=JSON.parse(readFileSync('release/RELEASE-COMPATIBILITY-MATRIX.v1.0.json','utf8'));
const regression=JSON.parse(readFileSync('release/P14-BROWSER-REGRESSION-EVIDENCE.v1.0.json','utf8'));
const report=JSON.parse(readFileSync('release/RELEASE-COMPATIBILITY-REPORT.v1.0.json','utf8'));
const issues=JSON.parse(readFileSync('release/KNOWN-ISSUES.v1.0.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));

test('P11-13 floor is derived from real frozen-floor plus newest-Stable full-product evidence',()=>{
  assert.equal(matrix.browserMinimumsFrozen,true);
  assert.deepEqual(matrix.browserMinimumPolicy,{
    scope:'declared-evidence-profile-only',
    browser:'Google Chrome',
    os:'Ubuntu 24.04 x64',
    minimumVersion:'153.0.8010.52',
    validatedThroughStable:'154.0.8037.92',
    evidenceGate:'P14-13',
    evidenceRun:960,
    crossBrowserClaimed:false,
    otherOsClaimed:false,
    mobileClaimed:false,
    weakDeviceClaimed:false
  });
  assert.equal(regression.campaigns.frozenFloor.browser,'Google Chrome 153.0.8010.52');
  assert.equal(regression.campaigns.frozenFloor.passedIterations,2);
  assert.equal(regression.campaigns.frozenFloor.fullProductPathPasses,2);
  assert.equal(regression.campaigns.newestStable.browser,'Google Chrome 154.0.8037.92');
  assert.equal(regression.campaigns.newestStable.passedIterations,2);
  assert.equal(regression.campaigns.newestStable.fullProductPathPasses,2);
  assert.equal(regression.aggregate.fullProductPathPasses,4);
  assert.equal(regression.aggregate.unexplainedFailures,0);
});

test('P11-13 floor applies to exactly one declared Chrome Ubuntu profile',()=>{
  const supported=matrix.rows.filter(x=>x.status==='SUPPORTED-EVIDENCE-BACKED');
  assert.equal(supported.length,1);
  const row=supported[0];
  assert.equal(row.id,'chrome-linux-declared');
  assert.equal(row.browser.minimumVersionClaimed,true);
  assert.equal(row.browser.minimumVersion,'153.0.8010.52');
  assert.deepEqual(row.browser.validatedVersions,['153.0.8010.52','154.0.8037.92']);
  assert.equal(row.os.family,'Linux');
  assert.equal(row.os.distribution,'Ubuntu');
  assert.equal(row.os.version,'24.04');
  assert.equal(row.os.arch,'x64');
  for(const other of matrix.rows.filter(x=>x.id!=='chrome-linux-declared')){
    assert.equal(other.browser.minimumVersionClaimed,false,other.id);
    assert.ok(!other.status.startsWith('SUPPORTED'),other.id);
  }
  assert.equal(matrix.crossBrowserReleaseMatrixClosed,false);
  assert.equal(matrix.resourceFloorClaimed,false);
});

test('P11-13 public report retains all unsupported browser and publication boundaries',()=>{
  assert.ok(report.forbiddenClaims.includes('cross-browser support'));
  assert.ok(report.forbiddenClaims.includes('minimum Firefox version'));
  assert.ok(report.forbiddenClaims.includes('minimum Safari version'));
  assert.ok(report.forbiddenClaims.includes('Windows support'));
  assert.ok(report.forbiddenClaims.includes('macOS support'));
  assert.ok(report.forbiddenClaims.includes('mobile support'));
  assert.ok(report.forbiddenClaims.includes('weak-device support'));
  assert.ok(report.requiredOpenBoundaries.some(x=>x.startsWith('P11-12')));
  assert.ok(report.requiredOpenBoundaries.some(x=>x.startsWith('P11-13 floor is frozen only')));
  const issue=issues.entries.find(x=>x.id==='KI-001');
  assert.equal(issue.status,'RESOLVED_PROFILE_SCOPED');
  assert.match(issue.summary,/153\.0\.8010\.52/);
  assert.match(issue.summary,/cross-browser/);
});

test('P11-13 source audit is repeated in the critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/p11-browser-floor-source-audit.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=104);
  assert.equal(flake.contract.iterations,5);
});
