import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpenContainer, OpenContainerProductionProfile } from '../packages/sdk/src/index.js';

test('production profile identity is immutable and exposed by SDK',async()=>{
  assert.equal(OpenContainerProductionProfile.schema,'opencontainer.production-profile.v0.1');
  assert.equal(OpenContainerProductionProfile.runtime.coreSurfaces,9);
  assert.equal(OpenContainerProductionProfile.oracle.node,'24.21.0');
  assert.equal(OpenContainerProductionProfile.oracle.npm,'11.19.0');
  assert.equal(OpenContainerProductionProfile.filesystem.snapshotSchemaVersion,1);
  assert.equal(OpenContainerProductionProfile.filesystem.opfsManifestVersion,1);
  assert.equal(OpenContainerProductionProfile.snapshot.portableFormatVersion,1);
  assert.equal(OpenContainerProductionProfile.protocol.workerRpcEnvelopeVersion,1);
  assert.equal(OpenContainerProductionProfile.productionClosed,false);
  assert.equal(Object.isFrozen(OpenContainerProductionProfile),true);
  assert.equal(Object.isFrozen(OpenContainerProductionProfile.filesystem),true);

  const runtime=await OpenContainer.boot();
  assert.equal(runtime.productionProfile,OpenContainerProductionProfile);
  assert.equal(OpenContainer.productionProfile,OpenContainerProductionProfile);
  await runtime.terminate();
});

test('published production profile JSON cannot drift from canonical SDK identity',()=>{
  const published=JSON.parse(readFileSync('docs/production/PRODUCTION-PROFILE.json','utf8'));
  assert.deepEqual(published,OpenContainerProductionProfile);
});
