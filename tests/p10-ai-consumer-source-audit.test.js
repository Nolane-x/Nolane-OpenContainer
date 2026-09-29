import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ai=readFileSync('packages/ai-consumer/src/index.js','utf8');
const runner=readFileSync('scripts/p10-ai-consumer-evidence.mjs','utf8');
const browser=readFileSync('apps/playground/public/p10-ai-consumer.js','utf8');
const guidance=readFileSync('docs/guides/AI-CONSUMERS.md','utf8');

test('P10 optional AI consumer stays outside Core runtime surfaces',()=>{
  assert.match(guidance,/AI is an optional consumer of OpenContainer Core/);
  assert.match(guidance,/separate package\/application layer/);
  assert.match(runner,/coreSurfaceCount:9/);
  assert.match(runner,/providerSpecificCoreApiAdded:false/);
  assert.equal(readFileSync('packages/sdk/src/index.js','utf8').includes('ai-consumer'),false);
});

test('P10 source retains BYOK session custody context deny and provider epoch reset',()=>{
  assert.match(ai,/custody:'session-memory'/);
  assert.match(ai,/this\.#credentials\.clear\(\)/);
  assert.match(ai,/this\.#contextScope\.clear\(\)/);
  assert.match(ai,/plaintextIncluded:false/);
  assert.match(ai,/\[REDACTED_AI_CREDENTIAL\]/);
  assert.match(ai,/SENSITIVE_PATTERNS/);
  assert.match(ai,/allowed=!classification\.sensitive\|\|this\.#overrides\.has/);
});

test('P10 source retains authority ChangeSet idempotency undo and cancellation barriers',()=>{
  assert.match(ai,/Discuss/);
  assert.match(ai,/Plan/);
  assert.match(ai,/Build/);
  assert.match(ai,/untrustedDataGrantedAuthority:false/);
  assert.match(ai,/schema:'opencontainer\.ai-changeset\.v1\.0'/);
  assert.match(ai,/this\.#commits\.get\(changeSet\.id\)/);
  assert.match(ai,/idempotentReplay:true/);
  assert.match(ai,/recoveryPointId/);
  assert.match(ai,/inverseType:'path-version-aware'/);
  assert.match(ai,/AI undo refused to overwrite newer user edits/);
  assert.match(ai,/cancelledAfterCommit:true/);
});

test('P10 dedicated browser court covers all gates without provider-quality claim',()=>{
  const gateBlock=runner.match(/sourceGates:Object\.freeze\(Array\.from\(\{length:18\}[\s\S]*?\)\)/)?.[0]??'';
  assert.ok(gateBlock.includes('length:18'));
  assert.match(browser,/sourceGates:Array\.from\(\{length:18\}/);
  assert.match(runner,/providerQualityClaimed:false/);
  assert.match(runner,/providerAgnostic:true/);
  assert.match(runner,/byokSessionMemoryOnly:true/);
  assert.match(runner,/promptInjectionCourt:true/);
  assert.match(runner,/cancellationPhaseCourt:true/);
  assert.match(runner,/authoritativeUsageOnly:true/);
});

test('P10 cost display never fabricates metadata',()=>{
  assert.match(ai,/if\(!metadata\|\|metadata\.authoritative!==true\)/);
  assert.match(ai,/authoritative-provider-metadata-required/);
  assert.match(browser,/hiddenWithoutAuthority:hiddenCost\.visible===false/);
  assert.match(browser,/visibleWithAuthority:visibleCost\.visible===true/);
});
