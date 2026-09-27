import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  NETWORK_POLICY_VERSION,
  NetworkProfiles
} from '../packages/network/src/index.js';
import { OpenContainerProductionProfile } from '../packages/sdk/src/profile.js';

test('production network profile is frozen to the hardened v2 capability model',async()=>{
  const policy=JSON.parse(await readFile('docs/production/NETWORK-POLICY.v0.1.json','utf8'));
  assert.equal(OpenContainerProductionProfile.network.capabilityProfile,'deny-by-default-http-v2');
  assert.equal(OpenContainerProductionProfile.network.policyVersion,NETWORK_POLICY_VERSION);
  assert.deepEqual(
    [...OpenContainerProductionProfile.network.profiles].sort(),
    Object.values(NetworkProfiles).sort()
  );
  assert.equal(OpenContainerProductionProfile.network.secretBinding,'opaque-authority-handle-v1');
  assert.equal(OpenContainerProductionProfile.network.broker,'disabled-no-open-proxy');
  assert.equal(OpenContainerProductionProfile.network.rawTcpUdp,false);
  assert.equal(policy.version,NETWORK_POLICY_VERSION);
  assert.equal(policy.broker.enabled,false);
  assert.equal(policy.broker.openFetchProxy,false);
  assert.equal(policy.secrets.guestVisible,'opaque-handle-only');
  assert.equal(policy.preview.externalNetworkPolicyIndependent,true);
  assert.deepEqual(policy.preview.serviceWorkerIdentity,[
    'publication-session',
    'workspace-generation',
    'service-worker-compatibility-version'
  ]);
});

test('preview Service Worker edge enforces opaque-origin sandbox and strips credential-setting headers',async()=>{
  const source=await readFile('apps/playground/public/opencontainer-sw.js','utf8');
  assert.ok(source.includes('x-opencontainer-preview-sandbox'));
  assert.ok(source.includes('opaque-origin-v1'));
  const sandboxMatch=source.match(/content-security-policy'[\s\S]{0,700}?"sandbox ([^"]+)"/);
  assert.ok(sandboxMatch,'preview sandbox CSP was not found');
  assert.equal(sandboxMatch[1].includes('allow-same-origin'),false);
  for(const header of ['set-cookie','clear-site-data','www-authenticate','proxy-authenticate']){
    assert.ok(source.includes("'"+header+"'"),header+' is not stripped at preview edge');
  }
  assert.ok(source.includes("'access-control-allow-origin', '*'"));
  assert.ok(source.includes("'referrer-policy', 'no-referrer'"));
});

test('preview cancellation is propagated from Service Worker request to authority handler',async()=>{
  const [sw,bridge]=await Promise.all([
    readFile('apps/playground/public/opencontainer-sw.js','utf8'),
    readFile('packages/preview/src/browser-service-worker.js','utf8')
  ]);
  assert.ok(sw.includes('opencontainer:preview-abort'));
  assert.ok(sw.includes('signal: request.signal'));
  assert.ok(bridge.includes("data.type === 'opencontainer:preview-abort'"));
  assert.ok(bridge.includes('new AbortController()'));
  assert.ok(bridge.includes('signal: controller.signal'));
  assert.ok(bridge.includes('ErrorCodes.EDGE_ABORTED'));
});

test('ESM Service Worker routing binds publication session and workspace generation',async()=>{
  const [publication,bridge,sw]=await Promise.all([
    readFile('packages/package-env/src/native-esm-publication.js','utf8'),
    readFile('packages/package-env/src/browser-esm-edge.js','utf8'),
    readFile('apps/playground/public/opencontainer-sw.js','utf8')
  ]);
  assert.ok(publication.includes("url.searchParams.set('__oc_vfs_generation', this.generation)"));
  assert.ok(publication.includes("url.searchParams.get('__oc_vfs_generation')"));
  assert.ok(publication.includes('Published workspace module generation proof is stale or missing'));
  assert.ok(bridge.includes("data.session !== this.session || String(data.generation ?? '') !== String(this.#publication.generation ?? '')"));
  assert.ok(sw.includes("url.searchParams.get('__oc_vfs_generation')"));
  assert.ok(sw.includes('generation,'));
});

test('network broker policy is explicitly disabled rather than implemented as an open fetch proxy',async()=>{
  const policy=JSON.parse(await readFile('docs/production/NETWORK-POLICY.v0.1.json','utf8'));
  assert.equal(policy.broker.enabled,false);
  assert.equal(policy.broker.openFetchProxy,false);
  for(const requirement of [
    'normalize and authorize every target and redirect hop',
    'resolve DNS and re-check every resolved address before connect',
    'prevent DNS rebinding by binding authorization to resolved endpoint identity',
    'never accept arbitrary caller-supplied credential headers'
  ]){
    assert.ok(policy.broker.futureRequirements.includes(requirement),requirement);
  }
});
