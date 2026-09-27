import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSecurityReviewInputs, validateSecurityEvidencePaths, validateSecurityReview } from './security-review-policy.mjs';

const outDir=resolve('.artifacts/security-review');
const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
if(git.status!==0)throw new Error('git rev-parse HEAD failed');
const sourceCommit=git.stdout.trim();
await mkdir(outDir,{recursive:true});
const inputs=await loadSecurityReviewInputs();
const policyErrors=validateSecurityReview(inputs);
const pathErrors=await validateSecurityEvidencePaths(inputs);
const dependency=JSON.parse(await readFile(resolve(outDir,'dependency-audit-receipt.json'),'utf8'));
if(dependency.sourceCommit!==sourceCommit)throw new Error('dependency audit receipt is not commit-bound');
const regressions=JSON.parse(await readFile(resolve(outDir,'regression-receipt.json'),'utf8'));
if(regressions.sourceCommit!==sourceCommit)throw new Error('security regression receipt is not commit-bound');
const testFiles=[
  'tests/product-security.test.js',
  'tests/security-hardening.test.js',
  'tests/security-fuzz.test.js',
  'tests/security-malicious-package.test.js',
  'tests/network-security.test.js',
  'tests/artifact-authority.test.js',
  'tests/frozen-install.test.js',
  'tests/browser-preview-edge.test.js',
  'tests/worker-authority.test.js',
  'tests/production-diagnostics.test.js',
  'tests/hosting-self-check.test.js'
];
const run=spawnSync(process.execPath,['--test',...testFiles],{encoding:'utf8',maxBuffer:32*1024*1024});
const log=(run.stdout??'')+(run.stderr??'');
await writeFile(resolve(outDir,'security-test.log'),log);
const logSha256=createHash('sha256').update(log).digest('hex');
const failures=[
  ...policyErrors,
  ...pathErrors,
  ...(dependency.status==='PASS'?[]:['dependency vulnerability audit did not PASS']),
  ...(regressions.status==='PASS'?[]:['security regression court did not PASS']),
  ...(run.status===0?[]:['security test court failed'])
];
const receipt={
  schema:'opencontainer.product-security-review.v1.0',
  sourceCommit,
  status:failures.length===0?'PASS_TECHNICAL_COURT':'FAIL',
  sourceGateDomain:'P12',
  declaredProfile:inputs.policy.declaredEvidenceProfile,
  asvs:{version:inputs.policy.asvs.version,asset:inputs.policy.asvs.asset,sha256:inputs.policy.asvs.sha256},
  dependencyAudit:{status:dependency.status,blockingFindings:dependency.blockingFindings,includeDevBuildTooling:dependency.includeDevBuildTooling},
  securityRegressions:{status:regressions.status,registryEntries:regressions.registryEntries,executableTestFiles:regressions.executableTestFiles,logSha256:regressions.logSha256},
  resourceDosReview:{status:inputs.resourceDos.conclusion,surfaces:inputs.resourceDos.surfaces.map(item=>({id:item.id,status:item.status}))},
  staticAnalysis:{engine:inputs.policy.staticAnalysis.engine,actionCommit:inputs.policy.staticAnalysis.actionCommit,receipt:'separate CI codeql job required'},
  tests:{files:testFiles,count:testFiles.length,exitCode:run.status??1,logSha256},
  reviewBoundary:{
    humanSecurityReviewCompleted:false,
    independentSecondPartyReviewCompleted:false,
    verifiedPrivateDisclosureChannel:false,
    productSecureClaim:false,
    productionClosed:false
  },
  gateAuthority:inputs.policy.gateAuthority,
  failures
};
await writeFile(resolve(outDir,'contract-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(failures.length)process.exitCode=1;
