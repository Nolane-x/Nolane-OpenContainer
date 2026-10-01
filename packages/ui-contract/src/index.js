const REQUIRED=Object.freeze([
  'key','round','sourceId','subsystem','trigger','userVisibleState',
  'canonicalGuarantee','primaryRecoveryAction','evidenceCourt'
]);

function text(value){return typeof value==='string'?value.trim():'';}

export function projectFailureScenario(scenario,{courtBinding=null}={}){
  for(const key of REQUIRED){
    if(!text(scenario?.[key]))throw new TypeError('Failure scenario missing '+key);
  }
  if(courtBinding!==null){
    if(text(courtBinding?.court)!==text(scenario.evidenceCourt))throw new TypeError('Failure scenario court binding mismatch');
    if(!Array.isArray(courtBinding.refs)||courtBinding.refs.length===0)throw new TypeError('Failure scenario court binding has no retained evidence refs');
  }
  return Object.freeze({
    key:text(scenario.key),
    source:Object.freeze({round:text(scenario.round),id:text(scenario.sourceId)}),
    subsystem:text(scenario.subsystem),
    trigger:text(scenario.trigger),
    state:Object.freeze({
      visible:text(scenario.userVisibleState),
      canonicalGuarantee:text(scenario.canonicalGuarantee)
    }),
    recovery:Object.freeze({
      primaryAction:text(scenario.primaryRecoveryAction)
    }),
    evidence:Object.freeze({
      court:text(scenario.evidenceCourt),
      refs:Object.freeze([...(courtBinding?.refs??[])]),
      externalAcceptance:Object.freeze([...(courtBinding?.externalAcceptance??[])])
    }),
    productionClosed:false
  });
}

export function assertFailureProjection(projection){
  if(!text(projection?.state?.visible))throw new TypeError('Failure projection has no user-visible state');
  if(!text(projection?.state?.canonicalGuarantee))throw new TypeError('Failure projection has no canonical-project guarantee');
  if(!text(projection?.recovery?.primaryAction))throw new TypeError('Failure projection has no recovery action');
  if(!text(projection?.evidence?.court))throw new TypeError('Failure projection has no evidence court');
  if(projection.productionClosed!==false)throw new TypeError('Failure projection cannot claim production closure');
  return true;
}
