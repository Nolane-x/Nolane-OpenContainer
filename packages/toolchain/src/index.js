import { ErrorCodes, ocError } from '../../protocol/src/index.js';

export const FrozenToolchains=Object.freeze({
  vite830:Object.freeze({
    consumer:'vite',consumerVersion:'8.3.0',rolldown:'1.2.9',rolldownBinding:'1.2.9',
    rolldownWasmSha256:'629aa10c37a9920cd5729a35af148983c881f4ff9edd6368a7d63b5acbf89dc2',
    lightningcss:'1.33.0',
    lightningcssTarballSha256:'266866c1b0efd7ca5307fe312411e4f1895b997086fb76f392ec5b60aadf31c8'
  })
});

export function certifyToolchain(candidate,profile=FrozenToolchains.vite830){
  const required=['consumer','consumerVersion','rolldown','rolldownBinding','rolldownWasmSha256','lightningcss','lightningcssTarballSha256'];
  for(const key of required)if(!candidate?.[key])throw ocError(ErrorCodes.TOOLCHAIN_UNSUPPORTED,'Missing toolchain identity field: '+key);
  if(candidate.rolldown!==candidate.rolldownBinding)throw ocError(ErrorCodes.TOOLCHAIN_SKEW,'Rolldown package/binding skew requires an explicit differential profile',{rolldown:candidate.rolldown,binding:candidate.rolldownBinding});
  for(const key of required)if(candidate[key]!==profile[key]){
    const code=key.toLowerCase().includes('sha')?ErrorCodes.DIGEST_MISMATCH:ErrorCodes.TOOLCHAIN_UNSUPPORTED;
    throw ocError(code,'Toolchain identity mismatch: '+key,{expected:profile[key],actual:candidate[key]});
  }
  return Object.freeze({status:'EXACT_PROFILE',profile:Object.freeze({...candidate})});
}
