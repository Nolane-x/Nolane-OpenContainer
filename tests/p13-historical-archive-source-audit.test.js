import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P13-20 archive implementation embeds long-lived verification material without overclaiming closure',()=>{
  const build=readFileSync('scripts/build-historical-release-archive.mjs','utf8');
  const verify=readFileSync('scripts/verify-historical-release-archive.mjs','utf8');
  const releaseBuild=readFileSync('scripts/build-release-evidence.mjs','utf8');
  const releaseVerify=readFileSync('scripts/verify-release-evidence.mjs','utf8');

  for(const name of [
    'release-manifest.json','checksums.txt','opencontainer.spdx.json','provenance.intoto.json',
    'dependency-license-inventory.json','third-party-notices.json','reproducibility.json'
  ])assert.ok(build.includes(name),name);

  assert.match(build,/medium:'git-source-history'/);
  assert.match(build,/automatedExpiry:false/);
  assert.match(build,/minimumYears:10/);
  assert.match(build,/deletionRequiresSupersedingArchive:true/);
  assert.match(build,/artifactBytesArchived:false/);

  assert.match(verify,/--require-repository/);
  assert.match(verify,/git'.*ls-files/s);
  assert.match(verify,/release\/history\//);
  assert.match(verify,/SPDX-2\.3/);
  assert.match(verify,/in-toto\.io\/Statement\/v1/);
  assert.match(verify,/third-party-notices\.json/);

  assert.match(releaseBuild,/opencontainer\.third-party-notices\.v0\.1/);
  assert.match(releaseBuild,/third-party-notices\.json/);
  assert.match(releaseVerify,/third-party notices inventory drift/);
});
