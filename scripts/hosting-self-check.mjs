#!/usr/bin/env node
import { checkHostingHeaders } from './hosting-self-check-lib.mjs';

const baseUrl=process.argv[2]??'http://127.0.0.1:4173/';
try{
  const receipt=await checkHostingHeaders(baseUrl);
  console.log(JSON.stringify(receipt,null,2));
  if(!receipt.ok)process.exitCode=1;
}catch(error){
  console.error(JSON.stringify({
    schema:'opencontainer.hosting-self-check.v0.1',
    ok:false,
    fatal:{name:error?.name??'Error',message:error?.message??String(error)}
  },null,2));
  process.exitCode=2;
}
