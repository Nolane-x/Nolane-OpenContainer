import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot=resolve('.');
const targets=[
  'packages/vfs/src/opfs-authority.js',
  'packages/persistence/src/release-storage.js'
];
const sources=Object.fromEntries(await Promise.all(
  targets.map(async path=>[path,await readFile(resolve(repoRoot,path),'utf8')])
));
const violations=[];
const forbidden=/\b(?:move|rename|moveEntry|renameEntry)\s*\(/g;
for(const [path,source] of Object.entries(sources)){
  for(const match of source.matchAll(forbidden)){
    violations.push({path,index:match.index,token:match[0],reason:'canonical publication must not rely on rename/move atomicity'});
  }
}
const workspace=sources['packages/vfs/src/opfs-authority.js'];
const release=sources['packages/persistence/src/release-storage.js'];
const workspaceUsesExclusiveLock=workspace.includes("this.#lockManager.request(this.#lockName, { mode: 'exclusive' }, callback)");
const workspaceRequestsSteal=/\bsteal\s*:\s*true\b/.test(workspace);
if(!workspaceUsesExclusiveLock)violations.push({path:'packages/vfs/src/opfs-authority.js',reason:'workspace writer does not use an exclusive origin-wide Web Lock'});
if(workspaceRequestsSteal)violations.push({path:'packages/vfs/src/opfs-authority.js',reason:'workspace writer requests steal-based Web Lock ownership'});
const workspacePayload=workspace.indexOf("await this.#writeCheckpointText(this.#payloads, payload, payloadText, 'payload')");
const workspaceManifest=workspace.indexOf("await this.#writeCheckpointText(this.#directory, manifestName, manifestText, 'manifest')");
if(!(workspacePayload>=0&&workspaceManifest>workspacePayload)){
  violations.push({path:'packages/vfs/src/opfs-authority.js',reason:'workspace canonical publication is not payload-before-manifest'});
}
const releasePayload=release.indexOf("await writeText(this.#payloads,candidate.manifest.payload,candidate.payloadText)");
const releaseManifest=release.indexOf("await writeText(this.#directory,manifestName,candidate.manifestText)");
if(!(releasePayload>=0&&releaseManifest>releasePayload)){
  violations.push({path:'packages/persistence/src/release-storage.js',reason:'release migration publication is not payload-before-manifest'});
}
for(const [path,source] of Object.entries(sources)){
  if(!source.includes('manifest-a')||!source.includes('manifest-b')){
    violations.push({path,reason:'dual manifest recovery roots are missing'});
  }
}
const receipt={
  schema:'opencontainer.p3-publication-source-audit.v1.0',
  status:violations.length===0?'PASS':'FAIL',
  targets,
  renameMoveDependency:false,
  workspaceExclusiveWebLock:workspaceUsesExclusiveLock,
  webLockStealRequested:workspaceRequestsSteal,
  workspacePayloadBeforeManifest:workspacePayload>=0&&workspaceManifest>workspacePayload,
  releasePayloadBeforeManifest:releasePayload>=0&&releaseManifest>releasePayload,
  violations
};
await mkdir(resolve('.artifacts/p3-persistence'),{recursive:true});
await writeFile(resolve('.artifacts/p3-persistence/source-audit.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(violations.length)process.exitCode=1;
