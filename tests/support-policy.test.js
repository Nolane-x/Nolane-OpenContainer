import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Core telemetry policy is opt-in and zero-remote by default',async()=>{
  const policy=JSON.parse(await readFile('docs/production/TELEMETRY-POLICY.v0.1.json','utf8'));
  assert.equal(policy.schema,'opencontainer.telemetry-policy.v0.1');
  assert.equal(policy.remoteAnalyticsDefault,false);
  assert.equal(policy.coreRequiresRemoteTelemetry,false);
  assert.equal(policy.crashUpload.default,'off');
  assert.equal(policy.crashUpload.consent,'explicit-opt-in');
  assert.equal(policy.crashUpload.endpointInCore,null);
  assert.equal(policy.supportBundle.generatedLocally,true);
  assert.equal(policy.supportBundle.networkEmissionDefault,false);
  assert.equal(policy.supportBundle.aiPromptTranscriptDefault,false);
  assert.equal(policy.supportBundle.workspaceContentsDefault,false);
  assert.equal(policy.supportBundle.httpBodiesDefault,false);
});

test('bug report template requests reproducible receipts and warns against secret pastes',async()=>{
  const text=await readFile('.github/ISSUE_TEMPLATE/opencontainer-bug.yml','utf8');
  for(const term of [
    'Stable error code',
    'Support-bundle fingerprint',
    'Production profile and runtime version',
    'Minimal reproduction steps',
    'Never paste API keys',
    'private workspace files',
    'AI prompts/transcripts'
  ])assert.ok(text.includes(term),term);
  assert.equal(/password:\s*/i.test(text),false);
});
