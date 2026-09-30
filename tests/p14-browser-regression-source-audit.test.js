import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P14-13 uses separate frozen-floor and live newest-Stable browser campaigns',()=>{
  const installer=readFileSync('scripts/install-current-stable-ci-chrome.sh','utf8');
  const runner=readFileSync('scripts/p14-browser-regression.mjs','utf8');
  const workflow=readFileSync('.github/workflows/ci.yml','utf8');
  const pkg=JSON.parse(readFileSync('package.json','utf8'));

  assert.match(installer,/last-known-good-versions-with-downloads\.json/);
  assert.match(installer,/channels\?\.Stable/);
  assert.match(installer,/platform==='linux64'/);
  assert.match(installer,/archiveSha256/);
  assert.match(installer,/manifestSha256/);

  assert.match(runner,/frozen-floor/);
  assert.match(runner,/newest-stable/);
  assert.match(runner,/Google Chrome 153\.0\.8010\.52/);
  assert.match(runner,/major<=153/);
  assert.match(runner,/fullProductPathPasses!==2/);
  assert.match(runner,/unexplainedFailures!==0/);
  assert.match(runner,/browserMinimumFrozenByThisCourt:false/);
  assert.match(runner,/weakDeviceClaimed:false/);

  assert.equal(pkg.scripts['p14:browser-regression'],'node scripts/p14-browser-regression.mjs');
  assert.match(workflow,/p14-browser-frozen-floor:/);
  assert.match(workflow,/p14-browser-newest-stable:/);
  assert.match(workflow,/bash scripts\/install-frozen-ci-chrome\.sh/);
  assert.match(workflow,/bash scripts\/install-current-stable-ci-chrome\.sh/);
  assert.match(workflow,/--lane=frozen-floor/);
  assert.match(workflow,/--lane=newest-stable/);
});
