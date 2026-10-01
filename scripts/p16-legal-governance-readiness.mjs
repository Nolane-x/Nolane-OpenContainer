import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectTarArchive } from '../packages/package-env/src/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const outPath=resolve(root,'.artifacts/p16/legal-governance-receipt.json');

const json=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
const text=async path=>readFile(resolve(root,path),'utf8');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(condition,message,details={})=>{
  if(!condition){
    const error=new Error(message);
    error.details=details;
    throw error;
  }
};

const [
  policy,corpusAudit,bcrReview,cleanRoom,corpus,lock,p6,
  notices,inventory,contributing,coc,governance,trademarks,cleanDiary,aiEgress,jurisdiction,security
]=await Promise.all([
  json('release/P16-LEGAL-GOVERNANCE-POLICY.v1.0.json'),
  json('release/P16-TEST-CORPUS-LICENSE-AUDIT.v1.0.json'),
  json('release/P16-BCR-LICENSE-REVIEW.v1.0.json'),
  json('release/P16-CLEAN-ROOM-SOURCE-REGISTER.v1.0.json'),
  json('compat/REAL-REPOSITORY-CORPUS.v0.1.json'),
  json('package-lock.json'),
  json('release/P6-TOOLCHAIN-VITE-EVIDENCE.v1.0.json'),
  json('.artifacts/release/third-party-notices.json'),
  json('.artifacts/release/dependency-license-inventory.json'),
  text('CONTRIBUTING.md'),text('CODE_OF_CONDUCT.md'),text('GOVERNANCE.md'),text('TRADEMARKS.md'),
  text('docs/legal/CLEAN-ROOM-DESIGN-DIARY.md'),text('docs/legal/AI-PROVIDER-DATA-EGRESS.md'),
  text('docs/legal/JURISDICTION-ASSUMPTIONS.md'),text('SECURITY.md')
]);

assert(policy.schema==='opencontainer.p16-legal-governance-policy.v1.0','P16 policy schema drift');
assert(policy.projectLicense.finalLicenseFrozen===false&&policy.projectLicense.state==='OPEN_EXTERNAL','P16-01 must remain open');
assert(policy.fto.counselRequired===true&&policy.fto.decisionRecorded===false&&policy.fto.state==='OPEN_EXTERNAL','P16-05 must remain open');

const machineGates=['P16-02','P16-03','P16-04','P16-06','P16-07','P16-08','P16-09','P16-10','P16-11','P16-12','P16-13','P16-14'];
for(const id of machineGates){
  assert(policy.gateAuthority[id]?.machineClosable===true,id+' must be machine-auditable');
  assert(policy.gateAuthority[id]?.state==='IMPLEMENTED_AWAITING_CI',id+' implementation state drift');
}
for(const id of ['P16-01','P16-05']){
  assert(policy.gateAuthority[id]?.machineClosable===false,id+' cannot be closed by CI');
  assert(policy.gateAuthority[id]?.state==='OPEN_EXTERNAL',id+' external blocker drift');
}

// P16-02: actual installed release graph notices.
assert(notices.schema==='opencontainer.third-party-notices.v0.1','third-party notices schema drift');
const graph=inventory.categories?.runtimeTransitive??[];
assert(graph.length>0,'release dependency graph is empty');
assert(notices.components?.length===graph.length,'third-party notices do not cover actual runtime graph',{notices:notices.components?.length,graph:graph.length});
for(const item of graph){
  const row=notices.components.find(x=>x.location===item.location&&x.name===item.name&&x.version===item.version);
  assert(row&&row.license===item.license,'third-party notice mismatch at '+item.location);
}
assert(notices.productionClosed===false,'notices cannot claim production closure');

// P16-03: frozen external corpus license provenance.
assert(corpusAudit.externalCases.length===corpus.cases.length,'test corpus audit count drift');
for(const item of corpus.cases){
  const review=corpusAudit.externalCases.find(x=>x.id===item.id);
  assert(review,'missing corpus license review '+item.id);
  assert(review.repository===item.repository&&review.commit===item.commit,'corpus source provenance drift '+item.id);
  assert(review.licensePath===item.license.path&&review.licenseBlobSha===item.license.blobSha,'corpus license provenance drift '+item.id);
  assert(typeof review.reviewedSpdx==='string'&&review.reviewedSpdx!=='NOASSERTION','unresolved corpus license '+item.id);
  assert(review.decision==='APPROVED_FOR_TEST_FIXTURE_USE'&&review.shippedInOpenContainerRelease===false,'corpus use decision drift '+item.id);
  assert(review.legalOpinion===false,'corpus audit must not masquerade as legal opinion '+item.id);
}
assert(corpusAudit.decision.unresolvedLicenseIdentity===0,'corpus audit has unresolved license identities');
for(const authored of corpusAudit.projectAuthored)assert(existsSync(resolve(root,authored.path)),'missing project-authored fixture '+authored.path);

// P16-04/P16-12: clean-room source register and diary.
assert(cleanRoom.policy.proprietaryImplementationAllowed===false,'proprietary implementation input unexpectedly allowed');
assert(cleanRoom.entries.length>=5,'clean-room source register incomplete');
for(const entry of cleanRoom.entries){
  assert(Array.isArray(entry.sources)&&entry.sources.length>0,'clean-room entry has no public source '+entry.area);
  assert(String(entry.learnedBehavior??'').length>0,'clean-room entry has no learned behavior '+entry.area);
}
for(const token of ['public standards','Proprietary implementation internals','Do not record or use confidential/leaked source']){
  assert(cleanDiary.toLowerCase().includes(token.toLowerCase()),'clean-room diary missing '+token);
}

// P16-06/P16-11: every retained BCR tarball is reviewed and carries notices.
const p6Entries=[
  {
    packageName:p6.artifactIdentity.rolldownBrowser.package,
    toolVersion:p6.artifactIdentity.rolldownBrowser.version,
    artifactDigest:p6.artifactIdentity.rolldownBrowser.tarballSha256,
    adapterSemanticProfile:p6.artifactIdentity.rolldownBrowser.semanticProfile
  },
  {
    packageName:p6.artifactIdentity.lightningCss.package,
    toolVersion:p6.artifactIdentity.lightningCss.version,
    artifactDigest:p6.artifactIdentity.lightningCss.tarballSha256,
    adapterSemanticProfile:p6.artifactIdentity.lightningCss.semanticProfile
  }
];
assert(bcrReview.bcrEntries.length===p6Entries.length,'BCR review count drift');
const reviewedTarballs=new Set();
const bcrReceipts=[];
for(const expected of p6Entries){
  const review=bcrReview.bcrEntries.find(x=>
    x.packageName===expected.packageName&&
    x.toolVersion===expected.toolVersion&&
    x.artifactDigest===expected.artifactDigest&&
    x.adapterSemanticProfile===expected.adapterSemanticProfile
  );
  assert(review,'missing BCR license review '+expected.packageName);
  assert(typeof review.license==='string'&&review.license.length>0,'BCR license identity missing '+expected.packageName);
  assert(Array.isArray(review.redistributionReview)&&review.redistributionReview.length>=2,'BCR redistribution review incomplete '+expected.packageName);
  const bytes=await readFile(resolve(root,review.retainedTarball));
  assert(sha256(bytes)===review.artifactDigest,'BCR retained tarball digest drift '+expected.packageName);
  const archive=await inspectTarArchive(new Uint8Array(bytes),{requiredPrefix:'package/',maxFiles:20_000,maxUnpackedBytes:256*1024*1024});
  const fileEntries=archive.entries.filter(x=>x.type==='file');
  const paths=new Set(fileEntries.map(x=>x.path));
  const packageJsonEntry=fileEntries.find(x=>x.path==='package/package.json');
  assert(packageJsonEntry,'BCR archive missing package/package.json '+expected.packageName);
  const packageJson=JSON.parse(new TextDecoder().decode(packageJsonEntry.data));
  assert(packageJson.license===review.license,'BCR package metadata license drift '+expected.packageName,{expected:review.license,actual:packageJson.license});
  for(const notice of review.requiredArchiveNotices??[])assert(paths.has(notice),'BCR archive missing notice '+notice+' for '+expected.packageName);
  const retainedNotices=[];
  for(const notice of review.retainedDistributionNotices??[]){
    assert(existsSync(resolve(root,notice)),'BCR retained distribution notice missing '+notice+' for '+expected.packageName);
    const noticeText=await readFile(resolve(root,notice),'utf8');
    assert(noticeText.includes('Mozilla Public License Version 2.0'),'retained MPL notice content drift '+notice);
    retainedNotices.push({path:notice,sha256:sha256(Buffer.from(noticeText,'utf8'))});
  }
  reviewedTarballs.add(review.retainedTarball);
  bcrReceipts.push({
    packageName:review.packageName,version:review.toolVersion,license:review.license,
    tarball:review.retainedTarball,sha256:review.artifactDigest,
    archiveNotices:review.requiredArchiveNotices??[],retainedDistributionNotices:retainedNotices
  });
}
const vendorFiles=(await readdir(resolve(root,'toolchain/vendor'))).filter(name=>!name.startsWith('.')).map(name=>'toolchain/vendor/'+name).sort();
assert(vendorFiles.length===reviewedTarballs.size,'unreviewed vendored toolchain artifact exists',{vendorFiles,reviewed:[...reviewedTarballs]});
for(const path of vendorFiles)assert(reviewedTarballs.has(path),'vendored artifact lacks P16 review '+path);

const companionByName=new Map(bcrReview.companionRuntime.map(x=>[x.packageName,x]));
for(const [name,key] of [['vite','node_modules/vite'],['rolldown','node_modules/rolldown'],['es-module-lexer','node_modules/es-module-lexer']]){
  const expected=companionByName.get(name);
  const actual=lock.packages?.[key];
  assert(expected&&actual,'missing companion runtime review '+name);
  assert(actual.version===expected.version&&actual.license===expected.license,'companion runtime license/version drift '+name);
}

// P16-07/08/09/10 governance documents.
for(const [name,doc,tokens] of [
  ['CONTRIBUTING',contributing,['DCO-1.1','No separate CLA','Broad external contribution','clean-room']],
  ['CODE_OF_CONDUCT',coc,['harassment','Security reports','maintainer']],
  ['GOVERNANCE',governance,['Security Maintainer','Release Approver','Compromised release','Nolane-x']],
  ['TRADEMARKS',trademarks,['separate from any source-code license','registered trademarks','official']]
]){
  for(const token of tokens)assert(doc.toLowerCase().includes(token.toLowerCase()),name+' missing '+token);
}
assert(security.includes('Reporting a vulnerability'),'SECURITY.md reporting workflow missing');
assert(policy.contribution.broadExternalContributionEnabled===false,'external contribution must remain fail-closed before license decision');
assert(policy.governance.failClosedIfRoleUnavailable===true,'privileged governance role must fail closed');
assert(policy.trademark.sourceLicenseSeparate===true&&policy.trademark.registeredTrademarkClaimed===false,'trademark/source-license boundary drift');

// P16-13 AI/provider data egress language.
for(const token of ['optional consumer-layer','does not automatically upload','provider\'s terms','privacy notice','not legal advice']){
  assert(aiEgress.toLowerCase().includes(token.toLowerCase()),'AI egress review missing '+token);
}
assert(policy.aiEgress.automaticWorkspaceUpload===false&&policy.aiEgress.userSelectedProviderTermsApply===true,'AI egress policy drift');

// P16-14 jurisdiction assumptions.
for(const token of ['no public-beta/commercial launch jurisdiction','does not claim','counsel','P16-01','P16-05']){
  assert(jurisdiction.toLowerCase().includes(token.toLowerCase()),'jurisdiction record missing '+token);
}
assert(policy.jurisdiction.universalFtoClaim===false&&policy.jurisdiction.commercialLaunchBlockedUntilCounsel===true,'jurisdiction/FTO boundary drift');

const gateResults=Object.fromEntries(machineGates.map(id=>[id,{status:'PASS-INTEGRATION',closureCandidate:true}]));
gateResults['P16-01']={status:'OPEN_EXTERNAL',closureCandidate:false};
gateResults['P16-05']={status:'OPEN_EXTERNAL',closureCandidate:false};

const receipt={
  schema:'opencontainer.p16-legal-governance-receipt.v1.0',
  status:'PASS',
  source:'OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P16',
  gateResults,
  releaseGraph:{runtimeComponents:graph.length,thirdPartyNotices:notices.components.length,rootLicense:notices.root?.license??null},
  testCorpus:{externalCases:corpusAudit.externalCases.length,projectAuthored:corpusAudit.projectAuthored.length,unresolvedLicenseIdentity:0},
  cleanRoom:{entries:cleanRoom.entries.length,proprietaryImplementationAllowed:false},
  bcr:{entries:bcrReceipts,reviewedVendoredArtifacts:vendorFiles.length},
  governance:{
    contributionDco:true,claAdopted:false,broadExternalContributionEnabled:false,
    trademarkSeparate:true,accountableAuthority:policy.governance.currentAccountableAuthority,
    failClosedIfRoleUnavailable:true
  },
  aiEgress:{automaticWorkspaceUpload:false,userSelectedProviderTermsApply:true},
  jurisdiction:{universalFtoClaim:false,commercialLaunchBlockedUntilCounsel:true},
  boundaries:{
    finalProjectLicenseClaimed:false,
    ftoClaimed:false,
    legalAdviceClaimed:false,
    productionClosed:false
  },
  productionClosed:false
};
await mkdir(dirname(outPath),{recursive:true});
await writeFile(outPath,JSON.stringify(receipt,null,2)+'\n');
console.log('P16 LEGAL GOVERNANCE READINESS PASS '+JSON.stringify({
  closureCandidates:machineGates.length,
  externalBlockers:['P16-01','P16-05'],
  runtimeNotices:receipt.releaseGraph.thirdPartyNotices,
  corpusCases:receipt.testCorpus.externalCases,
  bcrArtifacts:receipt.bcr.reviewedVendoredArtifacts
}));
