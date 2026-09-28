import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const harness=readFileSync('scripts/p3-native-external-permission.mjs','utf8');
const court=readFileSync('apps/playground/public/p3-native-external-permission.js','utf8');
const workflow=readFileSync('.github/workflows/ci.yml','utf8');

test('P3-18 court requires a real native File System Access picker and handle',()=>{
  assert.match(court,/showDirectoryPicker\(\{mode:'readwrite'\}\)/);
  assert.match(harness,/typeof globalThis\.showDirectoryPicker/);
  assert.match(harness,/selectedKind:'directory'|picked\?\.kind==='directory'/);
  assert.match(harness,/initialReadwrite:permission\.readwrite/);
  assert.doesNotMatch(harness,/PermissionDirectoryAdapter/);
});

test('P3-18 court creates a real external-edit conflict before privileged overwrite',()=>{
  assert.match(harness,/writeFile\(linkedPath,'outside-v2','utf8'\)/);
  assert.match(harness,/OC_STALE_GENERATION/);
  assert.match(harness,/external-change-detected/);
  assert.match(harness,/silentOverwritePrevented===true/);
  assert.match(harness,/permissionRechecked===true/);
});

test('P3-18 court exercises native permission revocation and preserves local canonical state',()=>{
  assert.match(court,/removeSelected/);
  assert.match(harness,/FileSystemDirectoryHandle\.remove/);
  assert.match(harness,/permission\.readwrite==='denied'/);
  assert.match(harness,/privilegedWriteBlocked===true/);
  assert.match(harness,/localCanonicalUnaffected===true/);
  assert.match(harness,/local-canonical-survives/);
  assert.match(workflow,/p3-native-external-permission:/);
  assert.match(workflow,/xvfb-run -a/);
  assert.match(workflow,/openbox/);
});
