import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { reviewReleaseEvidence, reviewRevocation, reviewWorkflowSecurity } from '../scripts/run-supply-chain-review.mjs';
import { scanDistributionStage } from '../scripts/build-distribution.mjs';

const policy=JSON.parse(readFileSync('release/SUPPLY-CHAIN-REVIEW-POLICY.v1.0.json','utf8'));
const operations=JSON.parse(readFileSync('release/OPERATIONS-POLICY.v1.0.json','utf8'));
const scenarios=JSON.parse(readFileSync('release/OPERATIONS-DISASTER-SCENARIOS.v1.0.json','utf8'));
const ci=readFileSync('.github/workflows/ci.yml','utf8');
const maintenance=readFileSync('.github/workflows/maintenance.yml','utf8');
const scorecard=readFileSync('.github/workflows/scorecard.yml','utf8');
const externalRelease=readFileSync('.github/workflows/external-release-evidence.yml','utf8');
const publicDeployment=readFileSync('.github/workflows/public-deployment-evidence.yml','utf8');
const adjacentRelease=readFileSync('.github/workflows/adjacent-release-evidence.yml','utf8');
const repositoryTrust=readFileSync('.github/workflows/repository-trust-state.yml','utf8');
const externalSecurityReview=readFileSync('.github/workflows/external-security-review-evidence.yml','utf8');
const workflows={'.github/workflows/ci.yml':ci,'.github/workflows/maintenance.yml':maintenance,'.github/workflows/scorecard.yml':scorecard,'.github/workflows/external-release-evidence.yml':externalRelease,'.github/workflows/public-deployment-evidence.yml':publicDeployment,'.github/workflows/adjacent-release-evidence.yml':adjacentRelease,'.github/workflows/repository-trust-state.yml':repositoryTrust,'.github/workflows/external-security-review-evidence.yml':externalSecurityReview};

test('P13 workflow court requires immutable actions least privilege and no untrusted release credentials',()=>{
  assert.deepEqual(reviewWorkflowSecurity({policy,workflows}),[]);
  const unpinned=ci.replace(/actions\/checkout@[0-9a-f]{40}/,'actions/checkout@v4');
  assert.ok(reviewWorkflowSecurity({policy,workflows:{...workflows,'.github/workflows/ci.yml':unpinned}}).some(x=>x.includes('not pinned')));
  const privileged=ci.replace('contents: read','contents: write');
  assert.ok(reviewWorkflowSecurity({policy,workflows:{...workflows,'.github/workflows/ci.yml':privileged}}).some(x=>/contents: read|forbidden|unexpected write/.test(x)));
  const expression='$'+'{{ secrets.NPM_TOKEN }}';
  const secret=ci+'\n# '+expression+'\n';
  assert.ok(reviewWorkflowSecurity({policy,workflows:{...workflows,'.github/workflows/ci.yml':secret}}).some(x=>x.includes('forbidden untrusted release signal')));
});

test('P13 gate authority refuses to machine-close external trust publication signing tag and long-archive gates',()=>{
  const closable=Object.entries(policy.gateAuthority).filter(([,v])=>v.machineClosable).map(([k])=>k);
  assert.deepEqual(closable,['P13-01','P13-02','P13-05','P13-06','P13-08','P13-11','P13-12','P13-13','P13-14','P13-15','P13-18','P13-19','P13-20']);
  for(const id of ['P13-03','P13-04','P13-07','P13-09','P13-10','P13-16','P13-17']){
    assert.equal(policy.gateAuthority[id].machineClosable,false,id);
    assert.equal(policy.gateAuthority[id].state,'OPEN_EXTERNAL',id);
  }
  assert.equal(policy.gateAuthority['P13-18'].machineClosable,true);
  assert.equal(policy.gateAuthority['P13-18'].state,'CLOSED_BY_OPENSSF');
  assert.equal(policy.gateAuthority['P13-20'].machineClosable,true);
  assert.equal(policy.gateAuthority['P13-20'].state,'CLOSED_BY_HISTORY');
});

test('P13 release-evidence review binds tested artifact SBOM provenance inventory checksums and reproducibility',()=>{
  const sha256='a'.repeat(64),sha512='b'.repeat(128),lock='c'.repeat(64),commit='d'.repeat(40);
  const manifest={
    schema:'opencontainer.release-evidence.v0.1',
    artifact:{filename:'x.tgz',sha256,sha512,contentPolicy:{violations:0}},
    source:{commit,packageLockSha256:lock,cleanTrackedTree:true},
    environment:{node:'v24.21.0',npm:'11.19.0',platform:'linux',arch:'x64'},
    toolchain:{vite:'8.3.0',rolldown:'1.2.9',rolldownBinding:'1.2.9',lightningCss:'1.33.0'}
  };
  const spdx={spdxVersion:'SPDX-2.3',packages:[{SPDXID:'SPDXRef-Package-OpenContainer',checksums:[{algorithm:'SHA256',checksumValue:sha256}]}]};
  const provenance={_type:'https://in-toto.io/Statement/v1',predicateType:'https://slsa.dev/provenance/v1',subject:[{digest:{sha256}}],predicate:{buildDefinition:{resolvedDependencies:[{digest:{gitCommit:commit}},{digest:{sha256:lock}}]}}};
  const inventory={categories:{runtimeDirect:[{}],runtimeTransitive:[{}],optionalAdapters:[],sourceDevTestOnly:[{}]},optionalAdapterPolicy:{shipped:false,bundleCount:0}};
  const reproducibility={reproducible:true,first:{sha256,sha512},second:{sha256,sha512}};
  const checksums=sha256+'  x.tgz\n'+sha512+'  x.tgz\n';
  const certification={schema:'opencontainer.distribution-certification.v0.1',build:{sha256,sha512},consumer:{installedArtifact:true,productionClosed:false}};
  assert.deepEqual(reviewReleaseEvidence({policy,manifest,spdx,provenance,inventory,reproducibility,checksums,certification}),[]);
  const wrong=JSON.parse(JSON.stringify(certification));wrong.build.sha256='e'.repeat(64);
  assert.ok(reviewReleaseEvidence({policy,manifest,spdx,provenance,inventory,reproducibility,checksums,certification:wrong}).some(x=>x.includes('does not equal tested')));
});

test('P13 distribution content policy rejects forbidden namespaces secrets and host-local paths',async()=>{
  const root=await mkdtemp(join(tmpdir(),'oc-p13-stage-'));
  try{
    await mkdir(join(root,'tests'),{recursive:true});
    await writeFile(join(root,'tests','fixture.txt'),'fixture');
    await assert.rejects(()=>scanDistributionStage(root),/content policy rejected/);
    await rm(join(root,'tests'),{recursive:true,force:true});
    await writeFile(join(root,'safe.md'),'token sk-abcdefghijklmnopqrstuvwxyz123456');
    await assert.rejects(()=>scanDistributionStage(root),/openai-style-secret/);
    await writeFile(join(root,'safe.md'),'path /home/runner/work/private');
    await assert.rejects(()=>scanDistributionStage(root),/runner-local-path/);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test('P13 compromised-release revocation is exercised and consumer warning remains mandatory',()=>{
  assert.deepEqual(reviewRevocation({policy,operations,scenarios}),[]);
  const broken=JSON.parse(JSON.stringify(scenarios));
  broken.scenarios.find(x=>x.id==='compromised-publishing-credential').required=broken.scenarios.find(x=>x.id==='compromised-publishing-credential').required.filter(x=>x!=='notify-users');
  assert.ok(reviewRevocation({policy,operations,scenarios:broken}).some(x=>x.includes('notify-users')));
});
