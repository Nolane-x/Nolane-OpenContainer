import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const files=[
  'apps/playground/public/weak-device-ui-sampler.html',
  'apps/playground/public/weak-device-ui-sampler.js',
  'scripts/weak-device-ui-court.mjs',
  'scripts/weak-device-budget.mjs',
  'release/WEAK-DEVICE-BUDGET-PROTOCOL.v1.0.json'
];
export function computeWeakDeviceProtocolFingerprint(){
  const hash=createHash('sha256');
  for(const path of files){
    const bytes=readFileSync(resolve(path));
    hash.update(path);hash.update('\0');hash.update(String(bytes.length));hash.update('\0');hash.update(bytes);hash.update('\0');
  }
  return {sha256:hash.digest('hex'),files:[...files]};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  console.log(JSON.stringify(computeWeakDeviceProtocolFingerprint(),null,2));
}
