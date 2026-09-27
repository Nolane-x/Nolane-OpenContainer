import { ErrorCodes, assertOc } from '../../protocol/src/index.js';

export const PersistenceCorruptionClass=Object.freeze({
  CANONICAL_SOURCE:'canonical-source',
  RECOVERY_DRAFT:'recovery-draft',
  CHECKPOINT:'checkpoint',
  PACKAGE_CACHE:'package-cache',
  DERIVED_INDEX:'derived-index'
});

export const PersistenceCorruptionAction=Object.freeze({
  FAIL_CLOSED:'fail-closed',
  DISCARD_DRAFT:'discard-draft',
  FALLBACK_CHECKPOINT:'fallback-checkpoint',
  DISCARD_REFETCH:'discard-refetch',
  DISCARD_REBUILD:'discard-rebuild'
});

const policy=Object.freeze({
  [PersistenceCorruptionClass.CANONICAL_SOURCE]:Object.freeze({
    action:PersistenceCorruptionAction.FAIL_CLOSED,
    canonical:true,
    rebuildable:false
  }),
  [PersistenceCorruptionClass.RECOVERY_DRAFT]:Object.freeze({
    action:PersistenceCorruptionAction.DISCARD_DRAFT,
    canonical:false,
    rebuildable:true
  }),
  [PersistenceCorruptionClass.CHECKPOINT]:Object.freeze({
    action:PersistenceCorruptionAction.FALLBACK_CHECKPOINT,
    canonical:false,
    rebuildable:false
  }),
  [PersistenceCorruptionClass.PACKAGE_CACHE]:Object.freeze({
    action:PersistenceCorruptionAction.DISCARD_REFETCH,
    canonical:false,
    rebuildable:true
  }),
  [PersistenceCorruptionClass.DERIVED_INDEX]:Object.freeze({
    action:PersistenceCorruptionAction.DISCARD_REBUILD,
    canonical:false,
    rebuildable:true
  })
});

export function corruptionDisposition(kind){
  assertOc(typeof kind==='string'&&policy[kind],ErrorCodes.INVALID_ARGUMENT,'Unknown persistence corruption class',{kind});
  return Object.freeze({kind,...policy[kind]});
}

export function persistenceCorruptionMatrix(){
  return Object.freeze(Object.values(PersistenceCorruptionClass).map(corruptionDisposition));
}
