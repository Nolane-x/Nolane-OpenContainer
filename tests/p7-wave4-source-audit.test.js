import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P7 wave4 production surfaces bind to one governor and retain storage amplification court',()=>{
  const resources=readFileSync('packages/resources/src/index.js','utf8');
  const process=readFileSync('packages/process/src/index.js','utf8');
  const preview=readFileSync('packages/preview/src/index.js','utf8');
  const sdk=readFileSync('packages/sdk/src/index.js','utf8');
  const toolchain=readFileSync('packages/toolchain/src/authority.js','utf8');
  const ai=readFileSync('packages/ai-consumer/src/index.js','utf8');
  const ui=readFileSync('apps/playground/public/index.js','utf8');
  const court=readFileSync('apps/playground/public/p7-resource-wave4.js','utf8');
  const runner=readFileSync('scripts/p7-wave4.mjs','utf8');
  const workflow=readFileSync('.github/workflows/ci.yml','utf8');

  assert.match(resources,/usageByOwner/);
  assert.match(resources,/owner='task'/);
  assert.match(process,/owner:'core:process'/);
  assert.match(preview,/owner:'preview'/);
  assert.match(sdk,/new PreviewAuthority\(\{resources\}\)/);
  assert.match(toolchain,/owner:'toolchain'/);
  assert.match(ai,/owner='ai-consumer'/);
  assert.match(ui,/owner:'ui'/);

  for(const term of [
    'OpfsPackageContentStore',
    'OpfsCheckpointAuthority',
    'OpfsDerivedIndexStore',
    'tempTransactionBytes',
    'steadyAmplification',
    "sourceGates:['P7-06','P7-11']"
  ])assert.ok(court.includes(term),term);

  assert.match(runner,/P7 wave4 requires exact Chrome 153\.0\.8010\.52/);
  assert.match(workflow,/p7-wave4:/);
  assert.match(workflow,/npm run p7:wave4:evidence/);
});
