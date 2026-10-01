import { OpfsReleaseStorageAuthority } from '/packages/persistence/src/index.js';
import { MemoryVFS } from '/packages/vfs/src/index.js';

const out=document.getElementById('result');
const params=new URLSearchParams(location.search);
const phase=params.get('phase');
const campaign=params.get('campaign');
const marker=params.get('marker');
const expectedPreviousVersion=params.get('previousVersion');
const expectedCurrentVersion=params.get('currentVersion');

function assert(condition,message,details=null){if(!condition){const error=new Error(message);error.details=details;throw error;}}
function safe(value){return String(value??'').replace(/[^0-9A-Za-z._-]+/g,'-').slice(0,80);}
async function loadProfile(){
  const response=await fetch('/docs/production/RELEASE-STORAGE-PROFILE.v1.0.json',{cache:'no-store'});
  assert(response.ok,'release storage profile missing',{status:response.status});
  const profile=await response.json();
  assert(profile.schema==='opencontainer.release-storage-profile.v1.0','release storage profile schema drift');
  assert(Number.isInteger(profile.storageVersion)&&profile.storageVersion>0,'release storage profile version invalid');
  assert(Array.isArray(profile.readableStorageVersions),'readable storage versions missing');
  assert(profile.destructiveStorageDowngrade===false,'release storage profile allows destructive downgrade');
  return profile;
}
async function run(){
  assert(['seed','upgrade','rollback','verify-current'].includes(phase),'unsupported adjacent-release phase',{phase});
  assert(/^[0-9A-Za-z._-]{3,80}$/.test(campaign??''),'campaign id invalid');
  assert(typeof marker==='string'&&marker.length>=8&&marker.length<=128,'marker invalid');
  const profile=await loadProfile();
  const root=await navigator.storage.getDirectory();
  const directoryName='opencontainer-adjacent-release-'+safe(campaign);
  const authority=await new OpfsReleaseStorageAuthority({root,directoryName}).open();
  const before=await authority.readCanonical();
  let action=null,compatibility=null,rollback=null,writeBlocked=null;

  if(phase==='seed'){
    assert(before===null,'seed requires empty campaign storage',{before});
    await authority.seed({
      storageVersion:profile.storageVersion,
      runtimeVersion:profile.runtimeVersion,
      data:{marker,seededBy:profile.runtimeVersion}
    });
    action='seeded';
  }else if(phase==='upgrade'){
    assert(before&&before.data?.marker===marker,'upgrade cannot read previous release marker',{before});
    if(expectedPreviousVersion)assert(before.runtimeVersion===expectedPreviousVersion,'seeded runtime version drift',{expectedPreviousVersion,actual:before.runtimeVersion});
    if(profile.storageVersion===before.storageVersion){
      compatibility=await authority.compatibility({
        runtimeStorageVersion:profile.storageVersion,
        readableStorageVersions:profile.readableStorageVersions
      });
      assert(compatibility.mode==='read-write','same-schema adjacent release did not open read-write',{compatibility});
      action='reuse-compatible-storage';
    }else{
      assert(profile.storageVersion===before.storageVersion+1,'adjacent release storage jump is not +1',{before:before.storageVersion,current:profile.storageVersion});
      assert(profile.adjacentUpgradeFrom.includes(before.storageVersion),'current release profile does not authorize previous storage migration',{from:before.storageVersion,profile});
      const migration=await authority.migrate({
        fromVersion:before.storageVersion,
        toVersion:profile.storageVersion,
        runtimeVersion:profile.runtimeVersion,
        transform:data=>({...data,migratedBy:profile.runtimeVersion}),
        validate:(candidate,source)=>candidate.data?.marker===source.data?.marker
      });
      assert(migration.destructiveDowngrade===false,'migration enabled destructive downgrade');
      action='migrated';
    }
    if(expectedCurrentVersion)assert(profile.runtimeVersion===expectedCurrentVersion,'current runtime version drift',{expectedCurrentVersion,actual:profile.runtimeVersion});
  }else if(phase==='rollback'){
    assert(before&&before.data?.marker===marker,'rollback cannot read current canonical marker',{before});
    rollback=await authority.rollbackPolicy({
      runtimeStorageVersion:profile.storageVersion,
      readableStorageVersions:profile.readableStorageVersions
    });
    assert(rollback.destructiveStorageDowngrade===false,'rollback attempted destructive downgrade');
    if(rollback.mode==='read-only'){
      const fs=new MemoryVFS();
      fs.mount({'marker.txt':marker});
      await authority.applyCompatibility(fs,{runtimeStorageVersion:profile.storageVersion,readableStorageVersions:profile.readableStorageVersions});
      try{fs.beginTransaction().writeFile('marker.txt','corrupt').commit();writeBlocked=false;}
      catch(error){writeBlocked=error?.code==='OC_STORAGE_READ_ONLY';}
      assert(writeBlocked===true,'rolled-back runtime did not block write');
      action='rollback-read-only';
    }else{
      assert(rollback.mode==='unsupported','rolled-back runtime must be read-only or unsupported',{rollback});
      action='rollback-refuse-open';
    }
  }else{
    assert(before&&before.data?.marker===marker,'current release state corrupted after rollback attempt',{before});
    assert(before.storageVersion===profile.storageVersion,'current release canonical storage version drift',{before,profile});
    action='verified-current-after-rollback';
  }

  const after=await authority.readCanonical();
  assert(after&&after.data?.marker===marker,'canonical marker lost',{after});
  const roots=await authority.recoveryRoots();
  const receipt={
    schema:'opencontainer.adjacent-release-browser-phase.v1.0',
    status:'PASS',phase,campaign,marker,
    runtimeProfile:profile,
    before:before?{storageVersion:before.storageVersion,runtimeVersion:before.runtimeVersion,generation:before.generation,data:before.data}:null,
    after:{storageVersion:after.storageVersion,runtimeVersion:after.runtimeVersion,generation:after.generation,data:after.data},
    action,compatibility,rollback,writeBlocked,
    recoveryRoots:roots.map(x=>({valid:x.valid,storageVersion:x.storageVersion,generation:x.generation})),
    destructiveStorageDowngrade:false,
    productionClosed:false
  };
  document.body.dataset.stage='complete';document.body.dataset.status='pass';out.textContent=JSON.stringify(receipt);
}
run().catch(error=>{
  document.body.dataset.stage='failed';document.body.dataset.status='fail';
  out.textContent=JSON.stringify({schema:'opencontainer.adjacent-release-browser-phase.v1.0',status:'FAIL',phase,error:{message:error?.message??String(error),stack:error?.stack??null,details:error?.details??null}});
});
