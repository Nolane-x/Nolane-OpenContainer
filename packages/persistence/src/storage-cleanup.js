import { ErrorCodes, assertOc } from '../../protocol/src/index.js';

export const StorageCleanupTier=Object.freeze({
  TEMPORARY:'temporary',
  DERIVED_REBUILDABLE:'derived-rebuildable',
  PUBLIC_CACHE:'public-cache',
  CHECKPOINT_GARBAGE:'checkpoint-garbage',
  CANONICAL_SOURCE:'canonical-source',
  CANONICAL_CHECKPOINT:'canonical-checkpoint'
});

const priority=Object.freeze({
  [StorageCleanupTier.TEMPORARY]:10,
  [StorageCleanupTier.DERIVED_REBUILDABLE]:20,
  [StorageCleanupTier.PUBLIC_CACHE]:30,
  [StorageCleanupTier.CHECKPOINT_GARBAGE]:40,
  [StorageCleanupTier.CANONICAL_SOURCE]:1000,
  [StorageCleanupTier.CANONICAL_CHECKPOINT]:1010
});

const canonicalTiers=new Set([
  StorageCleanupTier.CANONICAL_SOURCE,
  StorageCleanupTier.CANONICAL_CHECKPOINT
]);

function targetBytes(value){
  if(value===Infinity)return Infinity;
  const number=Number(value);
  assertOc(Number.isFinite(number)&&number>=0,ErrorCodes.INVALID_ARGUMENT,'Cleanup targetBytes must be non-negative or Infinity',{value});
  return number;
}

function reclaimedBytes(value,id){
  const number=Number(value??0);
  assertOc(Number.isFinite(number)&&number>=0,ErrorCodes.INVALID_STATE,'Cleanup source returned invalid reclaimedBytes',{id,value});
  return number;
}

export class StorageCleanupCoordinator{
  #sources=[];

  constructor({sources=[]}={}){
    assertOc(Array.isArray(sources),ErrorCodes.INVALID_ARGUMENT,'Cleanup sources must be an array');
    for(const source of sources)this.register(source);
  }

  register(source){
    assertOc(source&&typeof source==='object',ErrorCodes.INVALID_ARGUMENT,'Cleanup source must be an object');
    assertOc(typeof source.id==='string'&&source.id.length>0,ErrorCodes.INVALID_ARGUMENT,'Cleanup source id is required');
    assertOc(Object.hasOwn(priority,source.tier),ErrorCodes.INVALID_ARGUMENT,'Unknown cleanup source tier',{id:source.id,tier:source.tier});
    assertOc(!this.#sources.some(item=>item.id===source.id),ErrorCodes.INVALID_ARGUMENT,'Duplicate cleanup source id',{id:source.id});

    const canonical=canonicalTiers.has(source.tier);
    if(canonical){
      assertOc(source.protected!==false,ErrorCodes.INVALID_ARGUMENT,'Canonical cleanup source cannot disable protection',{id:source.id,tier:source.tier});
    }else{
      assertOc(typeof source.reclaim==='function',ErrorCodes.INVALID_ARGUMENT,'Reclaimable cleanup source must expose reclaim()',{id:source.id,tier:source.tier});
    }

    this.#sources.push(Object.freeze({
      id:source.id,
      tier:source.tier,
      priority:priority[source.tier],
      protected:canonical||source.protected===true,
      rebuildable:source.rebuildable===true,
      reclaim:typeof source.reclaim==='function'?source.reclaim:null
    }));
    return this;
  }

  get plan(){
    return Object.freeze(
      [...this.#sources]
        .sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))
        .map(item=>Object.freeze({
          id:item.id,
          tier:item.tier,
          priority:item.priority,
          protected:item.protected,
          rebuildable:item.rebuildable
        }))
    );
  }

  async cleanup({targetBytes:requested=Infinity}={}){
    const target=targetBytes(requested);
    const ordered=[...this.#sources].sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
    const attempts=[];
    const protectedSkipped=[];
    let reclaimed=0;

    for(const source of ordered){
      if(reclaimed>=target)break;
      if(source.protected){
        protectedSkipped.push(Object.freeze({id:source.id,tier:source.tier,priority:source.priority}));
        continue;
      }

      const remaining=target===Infinity?Infinity:Math.max(0,target-reclaimed);
      const result=await source.reclaim(Object.freeze({
        remainingBytes:remaining,
        reclaimedBytes:reclaimed,
        targetBytes:target,
        tier:source.tier,
        id:source.id
      }));
      const amount=reclaimedBytes(result?.reclaimedBytes,source.id);
      reclaimed+=amount;
      attempts.push(Object.freeze({
        id:source.id,
        tier:source.tier,
        priority:source.priority,
        rebuildable:source.rebuildable,
        reclaimedBytes:amount,
        items:Object.freeze(Array.isArray(result?.items)?result.items.map(String):[])
      }));
    }

    const targetSatisfied=target===Infinity?false:reclaimed>=target;
    return Object.freeze({
      targetBytes:target,
      reclaimedBytes:reclaimed,
      targetSatisfied,
      attempts:Object.freeze(attempts),
      protectedSkipped:Object.freeze(protectedSkipped),
      canonicalDeletionAttempted:false
    });
  }
}
