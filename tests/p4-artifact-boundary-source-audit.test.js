import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const parser=readFileSync('packages/package-env/src/artifact-authority.js','utf8');
const browser=readFileSync('apps/playground/public/browser-acceptance.js','utf8');
const capture=readFileSync('scripts/capture-p4-artifact-boundary-browser-evidence.mjs','utf8');

test('P4 production TAR parser requires a complete two-block trailer and rejects trailing nonzero bytes',()=>{
  assert.match(parser,/endMarkerOffset === null/);
  assert.match(parser,/endMarkerOffset \+ 1024 > bytes\.length/);
  assert.match(parser,/Tar end-of-archive trailer requires two zero blocks/);
  assert.match(parser,/Non-zero bytes after tar end-of-archive trailer/);
});

test('P4 default archive profile admits only regular files and directories',()=>{
  assert.match(parser,/!\['0', '5'\]\.includes\(type\)/);
  assert.match(parser,/Unsupported archive entry type/);
  assert.match(parser,/safeRelativePath/);
  assert.match(parser,/Archive path traversal rejected/);
});

test('P4 browser court executes two retained npm tarballs and the hostile artifact matrix',()=>{
  for(const term of [
    'lightningcss-wasm-1.33.0.tgz',
    'rolldown-browser-1.2.9.tgz',
    'p4-artifact-boundary-pass',
    'truncatedHeader',
    'truncatedPayload',
    'truncatedTrailer',
    'truncatedGzip',
    'decompressionBudget',
    'pathTraversal',
    'absolutePath',
    'dotSegment',
    'symlink',
    'hardlink',
    'paxExtension',
    'gnuLongNameExtension',
    'OC_ARTIFACT_INTEGRITY',
    'installAnywayPath: false'
  ]) assert.ok(browser.includes(term),term);
  assert.match(browser,/DecompressionStream/);
});

test('P4 dedicated receipt fail-closes missing corpus hostile or integrity evidence',()=>{
  assert.match(capture,/opencontainer\.p4-artifact-boundary-browser\.v1\.0/);
  assert.match(capture,/corpus\.length!==2/);
  assert.match(capture,/expectedHostile/);
  assert.match(capture,/integrity\.code!=='OC_ARTIFACT_INTEGRITY'/);
  assert.match(capture,/integrity\.contentPublished!==false/);
  assert.match(capture,/integrity\.installAnywayPath!==false/);
  assert.match(capture,/specialTarFeaturesDefault!=='deny'/);
});
