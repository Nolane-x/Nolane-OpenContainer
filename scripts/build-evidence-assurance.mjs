import { join } from 'node:path';
import { baseEnvironment, buildEvidenceBundle, gitHead, readJson, repoRoot, verifyEvidenceBundle } from './evidence-assurance-bundle.mjs';

const [releaseManifest,preflight,contractFlake,productScope,ledger,negativeResults,policy]=await Promise.all([
  readJson('.artifacts/release/release-manifest.json'),
  readJson('.artifacts/release-preflight/decision.json'),
  readJson('.artifacts/critical-flake/contract-receipt.json'),
  readJson('.artifacts/product-scope/contract-receipt.json'),
  readJson('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json'),
  readJson('release/EVIDENCE-NEGATIVE-RESULTS.v1.0.json'),
  readJson('release/EVIDENCE-ASSURANCE-POLICY.v1.0.json')
]);

const environment={
  ...baseEnvironment('contract'),
  validityThreats:{
    warmup:{status:'RECORDED-NOT-CONTROLLED',note:'Contract timings are not promoted as performance benchmarks; each critical iteration is independently timed.'},
    cache:{status:'RECORDED',note:'CI dependency cache may be restored; release artifact reproducibility is checked from two independent staging builds.'},
    cpuThrottling:{status:'NOT-CONTROLLED',note:'Hosted-runner CPU scheduling is not a production performance claim.'},
    gc:{status:'NOT-FORCED',note:'V8 GC scheduling is not controlled and contract durations are not used as product performance evidence.'},
    thermal:{status:'NOT-OBSERVABLE',note:'Hosted-runner thermal state is not observable; no thermal performance claim is made.'},
    network:{status:'MIXED',note:'Compatibility corpus verification may use pinned online sources; release artifact identity and SRI/hash checks are retained.'},
    devtools:{status:'NOT-APPLICABLE',note:'Contract job does not attach browser DevTools.'}
  }
};

const failedRuns=(contractFlake.runs??[]).filter(item=>item.exitCode!==0).map(item=>({
  scope:'contract',
  iteration:item.iteration,
  classification:item.classification,
  excluded:item.classification==='HARNESS-EXCLUDED',
  reasonCode:item.reasonCode??null,
  exceptionId:item.exceptionId??null,
  failureTail:item.failureTail??null
}));

const logSources=(contractFlake.runs??[]).map(item=>'.artifacts/critical-flake/'+item.logFile);
const manifest=await buildEvidenceBundle({
  scope:'contract',
  environment,
  rawResults:{
    schema:'opencontainer.evidence-raw-results.v1.0',
    scope:'contract',
    sourceCommit:gitHead(),
    releaseManifest,
    releasePreflight:preflight,
    criticalFlake:contractFlake,
    productScope,
    ledgerSource:{gateCount:ledger.source.gate_count,domainCount:ledger.source.domain_count}
  },
  summary:{
    releaseArtifactSha256:releaseManifest.artifact.sha256,
    releaseDecision:preflight.decision,
    criticalIterations:contractFlake.iterations,
    criticalPassed:contractFlake.passedIterations,
    currentFailureCount:failedRuns.length
  },
  failureCases:{
    schema:'opencontainer.evidence-failure-cases.v1.0',
    scope:'contract',
    sourceCommit:gitHead(),
    currentFailures:failedRuns,
    historicalNegativeResultIds:negativeResults.results.map(item=>item.id),
    exclusionReasonCodes:policy.exclusionReasonCodes
  },
  logSources
});
const verified=await verifyEvidenceBundle('contract');
console.log(JSON.stringify({schema:'opencontainer.evidence-assurance-contract.v1.0',ok:verified.ok,manifest,summary:verified.summary,errors:verified.errors},null,2));
if(!verified.ok)process.exitCode=1;
