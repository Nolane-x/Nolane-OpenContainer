import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=resolve('.');
const roots=[
  'packages',
  'apps/playground/public/index.html',
  'apps/playground/public/index.css',
  'apps/playground/public/index.js',
  'apps/playground/public/p9-ui-court.js',
  'package-lock.json'
];

function filesUnder(path){
  const absolute=resolve(ROOT,path);
  const stat=statSync(absolute);
  if(stat.isFile())return [absolute];
  const out=[];
  for(const name of readdirSync(absolute).sort()){
    const child=resolve(absolute,name);
    const childStat=statSync(child);
    if(childStat.isDirectory())out.push(...filesUnder(relative(ROOT,child)));
    else if(childStat.isFile())out.push(child);
  }
  return out;
}
export function productSourceFiles(){return roots.flatMap(filesUnder).sort();}
export function computeProductSourceFingerprint(){
  const hash=createHash('sha256');
  const files=productSourceFiles();
  for(const file of files){
    const rel=relative(ROOT,file).replaceAll('\\','/');
    const bytes=readFileSync(file);
    hash.update(rel);hash.update('\0');hash.update(String(bytes.length));hash.update('\0');hash.update(bytes);hash.update('\0');
  }
  return {sha256:hash.digest('hex'),fileCount:files.length,roots:[...roots]};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  console.log(JSON.stringify(computeProductSourceFingerprint(),null,2));
}
