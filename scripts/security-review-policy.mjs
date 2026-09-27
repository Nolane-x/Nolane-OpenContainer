import { access, readFile } from 'node:fs/promises';

export async function loadSecurityReviewInputs(){
  const paths={
    policy:'release/SECURITY-REVIEW-POLICY.v1.0.json',
    threatModel:'release/SECURITY-THREAT-MODEL.v1.0.json',
    asvs:'release/ASVS-5.0.0-CROSSCHECK.v1.0.json',
    maliciousCorpus:'release/SECURITY-MALICIOUS-PACKAGE-CORPUS.v1.0.json',
    regressions:'release/SECURITY-REGRESSION-REGISTRY.v1.0.json',
    residualRisks:'release/SECURITY-RESIDUAL-RISKS.v1.0.json'
  };
  const values={};
  for(const [key,path] of Object.entries(paths))values[key]=JSON.parse(await readFile(path,'utf8'));
  return {...values,paths};
}

export function validateSecurityReview(inputs){
  const {policy,threatModel,asvs,maliciousCorpus,regressions,residualRisks}=inputs;
  const errors=[];
  if(policy?.schema!=='opencontainer.security-review-policy.v1.0')errors.push('invalid security review policy schema');
  if(policy?.asvs?.version!=='5.0.0')errors.push('ASVS version is not frozen to 5.0.0');
  if(policy?.asvs?.sha256!=='bcdbec214d70abcfad9284a31d4f9e5134305831d628aad3aa85d7e26626cb35')errors.push('ASVS asset hash drifted');
  if(policy?.staticAnalysis?.actionCommit!=='2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2')errors.push('CodeQL action commit drifted');
  if(JSON.stringify(policy?.dependencyReview?.blockSeverities)!==JSON.stringify(['high','critical']))errors.push('dependency release-block severity drifted');
  for(const severity of ['CRITICAL','HIGH','MODERATE','LOW']){
    const row=policy?.severitySla?.[severity];
    if(!row||!Number.isFinite(row.acknowledgeHours)||!Number.isFinite(row.remediateDays)||typeof row.releaseBlocking!=='boolean'){
      errors.push('incomplete severity/SLA '+severity);
    }
  }
  if(policy?.severitySla?.CRITICAL?.releaseBlocking!==true||policy?.severitySla?.HIGH?.releaseBlocking!==true)errors.push('critical/high must remain release blocking');
  if(policy?.releasePolicy?.scannerScoreIsSecurityClaim!==false)errors.push('scanner score must never become a security claim');
  for(const id of ['P12-17','P12-18','P12-20']){
    if(policy?.gateAuthority?.[id]?.machineClosable!==false)errors.push(id+' must not be machine closable');
  }
  if(policy?.reviewStatus?.humanSecurityReviewCompleted!==false)errors.push('human review cannot be pre-claimed');
  if(policy?.reviewStatus?.independentSecondPartyReviewCompleted!==false)errors.push('second-party review cannot be pre-claimed');
  if(policy?.reviewStatus?.verifiedPrivateDisclosureChannel!==false)errors.push('private disclosure channel cannot be pre-claimed');
  if(policy?.reviewStatus?.machineSecurityCourtMayClaimProductSecure!==false)errors.push('machine court cannot claim product secure');

  if(threatModel?.schema!=='opencontainer.security-threat-model.v1.0')errors.push('invalid threat model schema');
  const expectedZones=['trusted-host','guest-js','package-bytes','preview','storage','future-ai-credentials'];
  const actualZones=(threatModel?.trustZones??[]).map(x=>x.id);
  if(JSON.stringify(actualZones)!==JSON.stringify(expectedZones))errors.push('threat model must contain exact six P12 trust zones');
  if((threatModel?.threats??[]).length<8)errors.push('threat model is too narrow');

  if(asvs?.schema!=='opencontainer.asvs-crosscheck.v1.0')errors.push('invalid ASVS cross-check schema');
  if(asvs?.standard?.version!=='5.0.0'||asvs?.standard?.sha256!==policy?.asvs?.sha256)errors.push('ASVS cross-check identity drifted');
  const requiredAsvs=['v5.0.0-1.1.1','v5.0.0-1.3.6','v5.0.0-3.4.3','v5.0.0-3.4.4','v5.0.0-3.4.5','v5.0.0-3.4.6','v5.0.0-3.4.8','v5.0.0-5.2.4','v5.0.0-5.2.5','v5.0.0-5.3.2','v5.0.0-5.3.3'];
  const asvsIds=new Set((asvs?.requirements??[]).map(x=>x.id));
  for(const id of requiredAsvs)if(!asvsIds.has(id))errors.push('missing relevant ASVS requirement '+id);
  if(asvs?.humanReviewRequired!==true)errors.push('ASVS review must retain human review requirement');

  if(maliciousCorpus?.schema!=='opencontainer.security-malicious-package-corpus.v1.0')errors.push('invalid malicious package corpus schema');
  const corpusIds=(maliciousCorpus?.cases??[]).map(x=>x.id);
  if(corpusIds.length<11||new Set(corpusIds).size!==corpusIds.length)errors.push('malicious package corpus is incomplete or duplicated');

  if(regressions?.schema!=='opencontainer.security-regression-registry.v1.0')errors.push('invalid regression registry schema');
  const regressionIds=(regressions?.entries??[]).map(x=>x.id);
  if(regressionIds.length<10||new Set(regressionIds).size!==regressionIds.length)errors.push('security regression registry is incomplete or duplicated');
  if((regressions?.entries??[]).some(x=>!['CRITICAL','HIGH'].includes(x.severity)))errors.push('security regression registry must retain critical/high fixes only');

  if(residualRisks?.schema!=='opencontainer.security-residual-risks.v1.0')errors.push('invalid residual risk schema');
  if((residualRisks?.risks??[]).length<8)errors.push('residual risk registry is too narrow');
  if(!(residualRisks?.risks??[]).some(x=>x.id==='RISK-09'&&x.status==='MANUAL_REVIEW_OPEN'))errors.push('manual review residual risk must remain explicit');
  return errors;
}

export async function validateSecurityEvidencePaths(inputs){
  const errors=[];
  const paths=new Set();
  for(const threat of inputs.threatModel?.threats??[])for(const path of threat.evidence??[])paths.add(path);
  for(const row of inputs.asvs?.requirements??[])for(const path of row.evidence??[])paths.add(path);
  for(const row of inputs.regressions?.entries??[])for(const path of row.evidence??[])paths.add(path);
  for(const path of paths){
    try{await access(path);}
    catch{errors.push('security evidence path is missing: '+path);}
  }
  return errors;
}
