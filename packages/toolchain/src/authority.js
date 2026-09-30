import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const HEX64=/^[0-9a-f]{64}$/i;

function stableKey(parts){
  return parts.join('\u0000');
}

export function createBcrEntryIdentity({
  packageName,
  toolVersion,
  artifactDigest,
  adapterSemanticProfile
}={}){
  assertOc(typeof packageName==='string'&&packageName,ErrorCodes.INVALID_ARGUMENT,'BCR packageName is required');
  assertOc(typeof toolVersion==='string'&&toolVersion,ErrorCodes.INVALID_ARGUMENT,'BCR toolVersion is required');
  assertOc(typeof artifactDigest==='string'&&HEX64.test(artifactDigest),ErrorCodes.INVALID_ARGUMENT,'BCR artifactDigest must be SHA-256 hex');
  assertOc(typeof adapterSemanticProfile==='string'&&adapterSemanticProfile,ErrorCodes.INVALID_ARGUMENT,'BCR adapterSemanticProfile is required');
  const identity=Object.freeze({
    packageName,
    toolVersion,
    artifactDigest:artifactDigest.toLowerCase(),
    adapterSemanticProfile
  });
  return Object.freeze({
    ...identity,
    key:stableKey([identity.packageName,identity.toolVersion,identity.artifactDigest,identity.adapterSemanticProfile])
  });
}

export class ToolchainAuthority {
  #entries=new Map();
  #maxWorkers;
  #activeWorkers=0;
  #leases=new Map();
  #nextLease=0;
  #resources=null;

  constructor({entries=[],maxWorkers=2,resources=null}={}){
    assertOc(Number.isInteger(maxWorkers)&&maxWorkers>=1,ErrorCodes.INVALID_ARGUMENT,'ToolchainAuthority maxWorkers must be >= 1');
    if(resources!==null)assertOc(typeof resources?.reserve==='function',ErrorCodes.INVALID_ARGUMENT,'ToolchainAuthority resources must expose reserve()');
    this.#maxWorkers=maxWorkers;
    this.#resources=resources;
    for(const entry of entries)this.register(entry);
  }

  register(entry){
    const identity=createBcrEntryIdentity(entry);
    assertOc(!this.#entries.has(identity.key),ErrorCodes.INVALID_STATE,'Duplicate BCR identity',{identity});
    const retained=Object.freeze({...entry,...identity});
    this.#entries.set(identity.key,retained);
    return retained;
  }

  resolve(query){
    const identity=createBcrEntryIdentity(query);
    const entry=this.#entries.get(identity.key);
    if(!entry){
      throw ocError(
        ErrorCodes.TOOLCHAIN_UNSUPPORTED,
        'No exact BCR identity is registered; silent tool/binary substitution is forbidden',
        {requested:identity}
      );
    }
    return entry;
  }

  acquireWorker({agentId='anonymous',entry}={}){
    const resolved=this.resolve(entry);
    if(this.#activeWorkers>=this.#maxWorkers){
      throw ocError(
        ErrorCodes.RESOURCE_EXHAUSTED,
        'Global ToolchainAuthority worker budget exhausted',
        {maxWorkers:this.#maxWorkers,activeWorkers:this.#activeWorkers,agentId}
      );
    }
    const globalLease=this.#resources?.reserve({workers:1,owner:'toolchain'})??null;
    const id=++this.#nextLease;
    this.#activeWorkers++;
    let released=false;
    const lease=Object.freeze({
      id,
      agentId:String(agentId),
      entry:resolved,
      release:()=>{
        if(released)return false;
        released=true;
        if(this.#leases.delete(id))this.#activeWorkers--;
        globalLease?.release();
        return true;
      }
    });
    this.#leases.set(id,lease);
    return lease;
  }

  get limits(){return Object.freeze({workers:this.#maxWorkers});}
  get usage(){return Object.freeze({workers:this.#activeWorkers});}
  get resourceBound(){return this.#resources!==null;}
  get entryCount(){return this.#entries.size;}
}

export class SharedWasmMemoryViews {
  #memory;
  #specs=new Map();
  #views=new Map();
  #buffer;
  #generation=0;

  constructor(memory){
    assertOc(memory instanceof WebAssembly.Memory,ErrorCodes.INVALID_ARGUMENT,'WebAssembly.Memory is required');
    assertOc(memory.buffer instanceof SharedArrayBuffer,ErrorCodes.INVALID_ARGUMENT,'Shared WebAssembly.Memory is required');
    this.#memory=memory;
    this.#buffer=memory.buffer;
  }

  bind(name,Type=Uint8Array,byteOffset=0,length=undefined){
    assertOc(typeof name==='string'&&name,ErrorCodes.INVALID_ARGUMENT,'Shared-memory view name is required');
    assertOc(typeof Type==='function'&&Number.isInteger(Type.BYTES_PER_ELEMENT),ErrorCodes.INVALID_ARGUMENT,'TypedArray constructor is required');
    assertOc(Number.isInteger(byteOffset)&&byteOffset>=0,ErrorCodes.INVALID_ARGUMENT,'byteOffset must be >= 0');
    assertOc(length===undefined||(Number.isInteger(length)&&length>=0),ErrorCodes.INVALID_ARGUMENT,'length must be >= 0');
    const spec=Object.freeze({Type,byteOffset,length});
    const view=this.#createView(spec);
    this.#specs.set(name,spec);
    this.#views.set(name,view);
    return view;
  }

  view(name){
    const view=this.#views.get(name);
    assertOc(view,ErrorCodes.NOT_FOUND,'Unknown shared-memory view',{name});
    return view;
  }

  grow(pages){
    assertOc(Number.isInteger(pages)&&pages>=0,ErrorCodes.INVALID_ARGUMENT,'memory.grow pages must be >= 0');
    const oldBuffer=this.#memory.buffer;
    const previousPages=this.#memory.grow(pages);
    const nextBuffer=this.#memory.buffer;
    const changed=nextBuffer!==oldBuffer||nextBuffer.byteLength!==oldBuffer.byteLength;
    if(changed){
      this.#buffer=nextBuffer;
      this.#generation++;
      for(const [name,spec] of this.#specs)this.#views.set(name,this.#createView(spec));
    }
    return Object.freeze({
      previousPages,
      currentPages:nextBuffer.byteLength/65536,
      rebound:changed,
      generation:this.#generation
    });
  }

  #createView({Type,byteOffset,length}){
    return length===undefined
      ? new Type(this.#buffer,byteOffset)
      : new Type(this.#buffer,byteOffset,length);
  }

  get generation(){return this.#generation;}
  get byteLength(){return this.#memory.buffer.byteLength;}
}
