import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageCleanupCoordinator, StorageCleanupTier } from '../packages/persistence/src/index.js';

test('P3 low-storage cleanup orders rebuildable tiers before protected canonical state',async()=>{
  const invoked=[];
  const source=(id,tier,reclaimedBytes,rebuildable=true)=>({
    id,tier,rebuildable,
    async reclaim(){
      invoked.push(id);
      return {reclaimedBytes,items:[id+'-item']};
    }
  });

  const coordinator=new StorageCleanupCoordinator({sources:[
    {
      id:'canonical-checkpoint',
      tier:StorageCleanupTier.CANONICAL_CHECKPOINT,
      async reclaim(){throw new Error('canonical checkpoint must never be reclaimed');}
    },
    source('public-cache',StorageCleanupTier.PUBLIC_CACHE,300,true),
    source('derived',StorageCleanupTier.DERIVED_REBUILDABLE,200,true),
    {
      id:'canonical-source',
      tier:StorageCleanupTier.CANONICAL_SOURCE,
      async reclaim(){throw new Error('canonical source must never be reclaimed');}
    },
    source('temporary',StorageCleanupTier.TEMPORARY,100,true),
    source('checkpoint-garbage',StorageCleanupTier.CHECKPOINT_GARBAGE,400,false)
  ]});

  assert.deepEqual(coordinator.plan.map(item=>item.tier),[
    'temporary','derived-rebuildable','public-cache','checkpoint-garbage','canonical-source','canonical-checkpoint'
  ]);
  const receipt=await coordinator.cleanup({targetBytes:10_000});
  assert.deepEqual(invoked,['temporary','derived','public-cache','checkpoint-garbage']);
  assert.deepEqual(receipt.attempts.map(item=>item.tier),[
    'temporary','derived-rebuildable','public-cache','checkpoint-garbage'
  ]);
  assert.deepEqual(receipt.protectedSkipped.map(item=>item.tier),[
    'canonical-source','canonical-checkpoint'
  ]);
  assert.equal(receipt.reclaimedBytes,1000);
  assert.equal(receipt.targetSatisfied,false);
  assert.equal(receipt.canonicalDeletionAttempted,false);
});

test('P3 low-storage cleanup stops after enough rebuildable bytes without probing lower tiers',async()=>{
  const invoked=[];
  const coordinator=new StorageCleanupCoordinator({sources:[
    {
      id:'temporary',
      tier:StorageCleanupTier.TEMPORARY,
      rebuildable:true,
      async reclaim(){invoked.push('temporary');return {reclaimedBytes:80};}
    },
    {
      id:'derived',
      tier:StorageCleanupTier.DERIVED_REBUILDABLE,
      rebuildable:true,
      async reclaim(){invoked.push('derived');return {reclaimedBytes:50};}
    },
    {
      id:'cache',
      tier:StorageCleanupTier.PUBLIC_CACHE,
      rebuildable:true,
      async reclaim(){invoked.push('cache');return {reclaimedBytes:500};}
    },
    {id:'canonical',tier:StorageCleanupTier.CANONICAL_CHECKPOINT}
  ]});
  const receipt=await coordinator.cleanup({targetBytes:100});
  assert.deepEqual(invoked,['temporary','derived']);
  assert.equal(receipt.reclaimedBytes,130);
  assert.equal(receipt.targetSatisfied,true);
  assert.deepEqual(receipt.attempts.map(item=>item.id),['temporary','derived']);
  assert.equal(receipt.canonicalDeletionAttempted,false);
});

test('P3 canonical cleanup tiers cannot opt out of protection',()=>{
  assert.throws(
    ()=>new StorageCleanupCoordinator({sources:[{
      id:'unsafe',
      tier:StorageCleanupTier.CANONICAL_SOURCE,
      protected:false,
      async reclaim(){return {reclaimedBytes:1};}
    }]}),
    error=>error?.code==='OC_INVALID_ARGUMENT'
  );
});
