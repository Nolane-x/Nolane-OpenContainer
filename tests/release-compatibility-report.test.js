import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateReleaseCompatibilityReport } from '../scripts/release-compatibility-report.mjs';

const report=JSON.parse(readFileSync('release/RELEASE-COMPATIBILITY-REPORT.v1.0.json','utf8'));
const candidate=JSON.parse(readFileSync('release/RELEASE-CANDIDATE.v0.1.json','utf8'));
const baseline=JSON.parse(readFileSync('docs/compatibility/COMPATIBILITY-BASELINE.v0.1.json','utf8'));
const scope=JSON.parse(readFileSync('release/PRODUCT-SCOPE.v1.0.json','utf8'));
const knownIssues=JSON.parse(readFileSync('release/KNOWN-ISSUES.v1.0.json','utf8'));
const profile=JSON.parse(readFileSync('docs/production/PRODUCTION-PROFILE.json','utf8'));
const humanDoc=readFileSync('docs/compatibility/RELEASE-COMPATIBILITY-REPORT.md','utf8');
const clone=x=>JSON.parse(JSON.stringify(x));

test('P11 release compatibility report contains every limitation unsupported class and known issue',()=>{
  assert.deepEqual(validateReleaseCompatibilityReport({report,candidate,baseline,scope,knownIssues,profile,humanDoc}),[]);
  assert.equal(report.limitations.length,baseline.limitations.length);
  assert.equal(report.unsupportedClasses.length,scope.unsupportedClasses.length);
  assert.deepEqual(report.knownIssueIds,knownIssues.entries.map(x=>x.id));
  assert.equal(report.productionClosed,false);
});

test('P11 report fails closed when a known limitation is omitted',()=>{
  const broken=clone(report);
  broken.limitations.pop();
  assert.ok(validateReleaseCompatibilityReport({report:broken,candidate,baseline,scope,knownIssues,profile,humanDoc}).some(x=>x.includes('known limitations')));
});

test('P11 report fails closed when unsupported product classes are omitted',()=>{
  const broken=clone(report);
  broken.unsupportedClasses.shift();
  assert.ok(validateReleaseCompatibilityReport({report:broken,candidate,baseline,scope,knownIssues,profile,humanDoc}).some(x=>x.includes('unsupported classes')));
});

test('P11 report preserves P11-12 publication and P11-13 browser-floor boundaries',()=>{
  assert.ok(report.requiredOpenBoundaries.some(x=>x.startsWith('P11-12')));
  assert.ok(report.requiredOpenBoundaries.some(x=>x.startsWith('P11-13')));
  assert.ok(report.forbiddenClaims.includes('externally published @nolane/opencontainer package'));
  assert.ok(report.forbiddenClaims.includes('cross-browser support'));
  assert.equal(profile.browser.crossBrowserReleaseMatrixClosed,false);
});
