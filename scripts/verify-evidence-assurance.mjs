import { verifyEvidenceBundle } from './evidence-assurance-bundle.mjs';

const scope=process.argv[2]??'contract';
if(!['contract','browser'].includes(scope))throw new Error('evidence assurance scope must be contract or browser');
const receipt=await verifyEvidenceBundle(scope);
console.log(JSON.stringify({schema:'opencontainer.evidence-assurance-verification.v1.0',scope,ok:receipt.ok,summary:receipt.summary,errors:receipt.errors},null,2));
if(!receipt.ok)process.exitCode=1;
