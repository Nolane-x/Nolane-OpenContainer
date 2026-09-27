import { baseEnvironment, buildEvidenceBundle, gitHead, readJson, verifyEvidenceBundle } from './evidence-assurance-bundle.mjs';

const [profile,browserFlake,negativeResults,policy]=await Promise.all([
  readJson('.artifacts/product-scope/browser-profile-receipt.json'),
  readJson('.artifacts/critical-flake/browser-receipt.json'),
  readJson('release/EVIDENCE-NEGATIVE-RESULTS.v1.0.json'),
  readJson('release/EVIDENCE-ASSURANCE-POLICY.v1.0.json')
]);

const environment={
  ...baseEnvironment('browser'),
  browser:profile.browser,
  declaredEvidenceProfile:profile.evidenceProfile,
  os:profile.os,
  device:profile.device,
  validityThreats:{
    warmup:{status:'RECORDED',note:'Two complete installed-distribution product-path iterations are retained independently; first-run and second-run durations remain visible.'},
    cache:{status:'MIXED',note:'CI/npm cache may be warm, while browser fixtures use no-store where product semantics require freshness; this is not a cold-cache benchmark.'},
    cpuThrottling:{status:'NOT-CONTROLLED',note:'Chrome CPU throttling is not forced on the GitHub-hosted runner; no latency floor is claimed.'},
    gc:{status:'NOT-FORCED',note:'Browser/V8 GC is not explicitly forced between full product-path iterations.'},
    thermal:{status:'NOT-OBSERVABLE',note:'Hosted-runner thermal state is unavailable and no thermal performance claim is made.'},
    network:{status:'RECORDED-MIXED',note:'P5 security fixtures are loopback/local; package/corpus steps may use pinned remote registry bytes. Network conditions are not a speed benchmark.'},
    devtools:{status:'ATTACHED-HARNESS',note:'Chrome DevTools Protocol drives acceptance; this is recorded as a validity condition rather than hidden.'}
  }
};

const failedRuns=(browserFlake.runs??[]).filter(item=>item.exitCode!==0).map(item=>({
  scope:'browser',
  iteration:item.iteration,
  classification:item.classification,
  excluded:item.classification==='HARNESS-EXCLUDED',
  reasonCode:item.reasonCode??null,
  exceptionId:item.exceptionId??null,
  failureTail:item.failureTail??null
}));
const logSources=(browserFlake.runs??[]).map(item=>'.artifacts/critical-flake/'+item.logFile);

const manifest=await buildEvidenceBundle({
  scope:'browser',
  environment,
  rawResults:{
    schema:'opencontainer.evidence-raw-results.v1.0',
    scope:'browser',
    sourceCommit:gitHead(),
    browserProfile:profile,
    criticalFlake:browserFlake
  },
  summary:{
    browserVersion:profile.browser?.version??null,
    evidenceProfile:profile.evidenceProfile,
    criticalIterations:browserFlake.iterations,
    criticalPassed:browserFlake.passedIterations,
    fullProductPathPasses:browserFlake.fullProductPathPasses,
    unexplainedFailures:browserFlake.unexplainedFailures,
    currentFailureCount:failedRuns.length
  },
  failureCases:{
    schema:'opencontainer.evidence-failure-cases.v1.0',
    scope:'browser',
    sourceCommit:gitHead(),
    currentFailures:failedRuns,
    historicalNegativeResultIds:negativeResults.results.map(item=>item.id),
    exclusionReasonCodes:policy.exclusionReasonCodes
  },
  logSources
});
const verified=await verifyEvidenceBundle('browser');
console.log(JSON.stringify({schema:'opencontainer.evidence-assurance-browser.v1.0',ok:verified.ok,manifest,summary:verified.summary,errors:verified.errors},null,2));
if(!verified.ok)process.exitCode=1;
