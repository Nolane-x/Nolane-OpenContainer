import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scanRoots=['packages','apps/playground/public'];
const extensions=new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx']);
const allowedFiles=new Set([
  'packages/resources/src/index.js',
  'apps/playground/public/browser-acceptance.js'
]);

function ext(path){
  const index=path.lastIndexOf('.');
  return index===-1?'':path.slice(index);
}

async function walk(path,files=[]){
  for(const entry of await readdir(path,{withFileTypes:true})){
    const absolute=join(path,entry.name);
    if(entry.isDirectory())await walk(absolute,files);
    else if(entry.isFile()&&extensions.has(ext(entry.name)))files.push(absolute);
  }
  return files;
}

const findings=[];
for(const root of scanRoots){
  const absoluteRoot=join(repoRoot,root);
  for(const file of await walk(absoluteRoot)){
    const source=await readFile(file,'utf8');
    const rel=relative(repoRoot,file).replaceAll('\\','/');
    const lines=source.split(/\r?\n/);
    lines.forEach((line,index)=>{
      if(/source.?map/i.test(line)){
        findings.push({path:rel,line:index+1,text:line.trim().slice(0,240)});
      }
    });
  }
}

const violations=[];
for(const finding of findings){
  if(!allowedFiles.has(finding.path)){
    violations.push({...finding,reason:'source-map reference outside audited production paths'});
    continue;
  }
  if(finding.path==='packages/resources/src/index.js'&&!/sourceMapBytes|Retained source-map cache is disabled by default/.test(finding.text)){
    violations.push({...finding,reason:'resource source-map reference is not the explicit retained-byte budget'});
  }
  if(finding.path==='apps/playground/public/browser-acceptance.js'){
    const transient=/sourcemap\s*:\s*true|sourceMappingURL|source map is invalid/i.test(finding.text);
    if(!transient)violations.push({...finding,reason:'browser source-map reference is not transient build/output validation'});
    if(/source.?map.*(?:cache|new\s+Map|\.set\s*\()/i.test(finding.text)){
      violations.push({...finding,reason:'browser acceptance appears to retain source maps in an ungoverned cache'});
    }
  }
}

const resourcesSource=await readFile(join(repoRoot,'packages/resources/src/index.js'),'utf8');
if(!resourcesSource.includes('sourceMapBytes:Math.max(0,Math.floor(Number(limits.sourceMapBytes??0))||0)')){
  violations.push({path:'packages/resources/src/index.js',line:null,text:null,reason:'zero-default source-map retained-byte budget drifted'});
}
if(!resourcesSource.includes("sourceMapBytes:0")){
  violations.push({path:'packages/resources/src/index.js',line:null,text:null,reason:'source-map usage accounting is missing'});
}

const receipt={
  schema:'opencontainer.p7-resource-retention-audit.v1.0',
  status:violations.length===0?'PASS':'FAIL',
  scanRoots,
  auditedFileCount:(await Promise.all(scanRoots.map(async root=>(await walk(join(repoRoot,root),[])).length))).reduce((a,b)=>a+b,0),
  sourceMapReferences:findings,
  allowedFiles:[...allowedFiles],
  sourceMapRetainedBudgetDefaultBytes:0,
  violations
};

const outputDir=join(repoRoot,'.artifacts','resource-retention');
await mkdir(outputDir,{recursive:true});
await writeFile(join(outputDir,'contract-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(receipt.status!=='PASS')process.exitCode=1;
