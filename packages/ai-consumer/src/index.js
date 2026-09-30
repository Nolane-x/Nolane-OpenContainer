import { ErrorCodes, assertOc, ocError } from '../../protocol/src/index.js';

const MODES=Object.freeze(['Discuss','Plan','Build']);
const READ_ONLY_ACTIONS=new Set(['read','inspect','diagnostics','preview']);
const SENSITIVE_PATTERNS=[
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /(^|\/)(?:secrets?|credentials?|tokens?)(?:\.|\/|$)/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.ssh\//i
];

function pathString(value){
  assertOc(typeof value==='string'&&value.length>0,ErrorCodes.INVALID_ARGUMENT,'AI consumer path must be non-empty');
  return value.startsWith('/')?value:'/workspace/'+value.replace(/^\.\//,'');
}

function classifyPath(path){
  const normalized=pathString(path);
  return Object.freeze({
    path:normalized,
    sensitive:SENSITIVE_PATTERNS.some(pattern=>pattern.test(normalized)),
    category:/\.(?:png|jpe?g|gif|webp|svg)$/i.test(normalized)?'image':
      /(?:^|\/)package(?:-lock)?\.json$/i.test(normalized)?'package-metadata':
      /\.(?:js|mjs|cjs|ts|tsx|jsx|json|css|html|md|txt|py|rs|go|java|c|cc|cpp|h|hpp)$/i.test(normalized)?'source-text':
      'other'
  });
}

function encodeText(value){return new TextEncoder().encode(String(value));}
function decodeBytes(value){return new TextDecoder().decode(value);}
function bytesEqual(a,b){
  if(a===null||b===null)return a===b;
  if(a.byteLength!==b.byteLength)return false;
  for(let i=0;i<a.byteLength;i++)if(a[i]!==b[i])return false;
  return true;
}
function cloneBytes(value){return value===null?null:new Uint8Array(value);}

function readBytes(workspace,path){
  if(!workspace.exists(path))return null;
  const stat=workspace.stat(path);
  assertOc(stat.type==='file',ErrorCodes.INVALID_ARGUMENT,'AI ChangeSet target must be a file',{path});
  return workspace.readFile(path,{encoding:null});
}

function safeUsageMetadata(metadata){
  if(!metadata||metadata.authoritative!==true)return Object.freeze({
    authoritative:false,
    inputTokens:null,
    outputTokens:null,
    totalTokens:null,
    cost:null,
    currency:null
  });
  const finite=value=>Number.isFinite(Number(value))?Number(value):null;
  return Object.freeze({
    authoritative:true,
    inputTokens:finite(metadata.inputTokens),
    outputTokens:finite(metadata.outputTokens),
    totalTokens:finite(metadata.totalTokens),
    cost:finite(metadata.cost),
    currency:typeof metadata.currency==='string'?metadata.currency:null
  });
}

export class AiProviderSession {
  #provider=null;
  #epoch=0;
  #credentials=new Map();
  #nextCredential=0;
  #contextScope=new Set();

  switchProvider(provider){
    assertOc(typeof provider==='string'&&provider.length>0,ErrorCodes.INVALID_ARGUMENT,'AI provider id is required');
    this.#provider=provider;
    this.#epoch++;
    this.#credentials.clear();
    this.#contextScope.clear();
    return this.identity;
  }

  get identity(){
    return Object.freeze({provider:this.#provider,epoch:this.#epoch});
  }

  putSessionKey(plaintext,{provider=this.#provider}={}){
    assertOc(this.#provider!==null,ErrorCodes.INVALID_STATE,'AI provider must be selected before storing a session key');
    assertOc(provider===this.#provider,ErrorCodes.INVALID_ARGUMENT,'Session key provider does not match active provider');
    assertOc(typeof plaintext==='string'&&plaintext.length>0,ErrorCodes.INVALID_ARGUMENT,'AI provider key must be non-empty');
    const handle='ai-key-'+(++this.#nextCredential)+'-e'+this.#epoch;
    this.#credentials.set(handle,Object.freeze({provider:this.#provider,epoch:this.#epoch,plaintext}));
    return Object.freeze({handle,provider:this.#provider,epoch:this.#epoch,custody:'session-memory'});
  }

  resolveSessionKey(handle,{provider=this.#provider,epoch=this.#epoch}={}){
    const record=this.#credentials.get(typeof handle==='string'?handle:handle?.handle);
    assertOc(record,ErrorCodes.NOT_FOUND,'AI session credential handle is unavailable');
    assertOc(record.provider===provider&&record.epoch===epoch&&provider===this.#provider&&epoch===this.#epoch,ErrorCodes.WORKER_STALE,'AI session credential scope is stale',{
      activeProvider:this.#provider,activeEpoch:this.#epoch,requestedProvider:provider,requestedEpoch:epoch
    });
    return record.plaintext;
  }

  bindContext(paths=[]){
    this.#contextScope=new Set(paths.map(pathString));
    return this.contextScope;
  }

  get contextScope(){return Object.freeze([...this.#contextScope].sort());}

  sanitizeText(value){
    let text=String(value??'');
    for(const record of this.#credentials.values()){
      if(record.plaintext)text=text.split(record.plaintext).join('[REDACTED_AI_CREDENTIAL]');
    }
    return text;
  }

  supportReceipt(){
    return Object.freeze({
      provider:this.#provider,
      epoch:this.#epoch,
      credentialCount:this.#credentials.size,
      credentialCustody:'session-memory',
      plaintextIncluded:false,
      contextScope:this.contextScope
    });
  }
}

export class AiContextAuthority {
  #workspace;
  #overrides=new Set();

  constructor({workspace}={}){
    assertOc(workspace&&typeof workspace.readFile==='function'&&typeof workspace.exists==='function',ErrorCodes.INVALID_ARGUMENT,'AI context authority requires a workspace VFS');
    this.#workspace=workspace;
  }

  grantSensitiveOverride(path){
    const normalized=pathString(path);
    this.#overrides.add(normalized);
    return Object.freeze({path:normalized,explicit:true});
  }

  revokeSensitiveOverride(path){
    return this.#overrides.delete(pathString(path));
  }

  manifest(selections=[]){
    assertOc(Array.isArray(selections),ErrorCodes.INVALID_ARGUMENT,'AI context selections must be an array');
    const items=[];
    for(const selection of selections){
      const raw=typeof selection==='string'?{path:selection}:selection;
      const classification=classifyPath(raw.path);
      const exists=this.#workspace.exists(classification.path);
      const allowed=!classification.sensitive||this.#overrides.has(classification.path);
      const start=Number.isInteger(raw.start)&&raw.start>=0?raw.start:null;
      const end=Number.isInteger(raw.end)&&raw.end>=0?raw.end:null;
      assertOc(start===null||end===null||end>=start,ErrorCodes.INVALID_ARGUMENT,'AI context range end must not precede start',{path:classification.path,start,end});
      items.push(Object.freeze({
        path:classification.path,
        category:classification.category,
        sensitive:classification.sensitive,
        exists,
        allowed,
        override:classification.sensitive&&this.#overrides.has(classification.path),
        range:start===null&&end===null?null:Object.freeze({start,end})
      }));
    }
    return Object.freeze({
      schema:'opencontainer.ai-context-manifest.v1.0',
      workspaceGeneration:this.#workspace.generation,
      items:Object.freeze(items),
      included:Object.freeze(items.filter(item=>item.exists&&item.allowed)),
      excluded:Object.freeze(items.filter(item=>!item.exists||!item.allowed))
    });
  }

  materialize(manifest){
    assertOc(manifest?.schema==='opencontainer.ai-context-manifest.v1.0',ErrorCodes.INVALID_ARGUMENT,'Invalid AI context manifest');
    assertOc(manifest.workspaceGeneration===this.#workspace.generation,ErrorCodes.STALE_GENERATION,'AI context manifest is stale',{
      manifestGeneration:manifest.workspaceGeneration,currentGeneration:this.#workspace.generation
    });
    return Object.freeze(manifest.included.map(item=>{
      const text=this.#workspace.readFile(item.path);
      const content=item.range?text.slice(item.range.start??0,item.range.end??text.length):text;
      return Object.freeze({
        path:item.path,
        category:item.category,
        range:item.range,
        content
      });
    }));
  }
}

export class AiAuthority {
  #mode='Discuss';
  #approvals=new Map();
  #nextApproval=0;

  setMode(mode){
    assertOc(MODES.includes(mode),ErrorCodes.INVALID_ARGUMENT,'Unknown AI authority mode',{mode});
    this.#mode=mode;
    return this.modeReceipt();
  }

  modeReceipt(){
    return Object.freeze({
      mode:this.#mode,
      canRead:this.#mode==='Plan'||this.#mode==='Build',
      canMutate:this.#mode==='Build',
      humanLabel:this.#mode==='Discuss'?'Discuss only':this.#mode==='Plan'?'Plan / inspect only':'Build with explicit approvals'
    });
  }

  approve({action,scope,providerEpoch=null}={}){
    assertOc(this.#mode==='Build',ErrorCodes.NETWORK_DENIED,'AI mutation approval requires Build mode',{mode:this.#mode});
    assertOc(typeof action==='string'&&action.length>0,ErrorCodes.INVALID_ARGUMENT,'AI approval action is required');
    const id='ai-approval-'+(++this.#nextApproval);
    const record=Object.freeze({id,action,scope:scope??null,providerEpoch,used:false});
    this.#approvals.set(id,{...record});
    return record;
  }

  authorize({action,readOnly=false,approval=null,untrustedInstruction=null,providerEpoch=null}={}){
    assertOc(typeof action==='string'&&action.length>0,ErrorCodes.INVALID_ARGUMENT,'AI tool action is required');
    if(untrustedInstruction!==null){
      // Untrusted repository/web/tool text is deliberately not parsed for authority.
      assertOc(typeof untrustedInstruction==='string'||typeof untrustedInstruction==='object',ErrorCodes.INVALID_ARGUMENT,'Untrusted AI input must be data');
    }
    if(this.#mode==='Discuss')throw ocError(ErrorCodes.NETWORK_DENIED,'Discuss mode cannot execute AI tools',{mode:this.#mode,action});
    if(this.#mode==='Plan'&&!readOnly&&!READ_ONLY_ACTIONS.has(action)){
      throw ocError(ErrorCodes.NETWORK_DENIED,'Plan mode cannot mutate canonical state',{mode:this.#mode,action});
    }
    if(this.#mode==='Build'&&!readOnly&&!READ_ONLY_ACTIONS.has(action)){
      const id=typeof approval==='string'?approval:approval?.id;
      const record=this.#approvals.get(id);
      assertOc(record&&!record.used&&record.action===action,ErrorCodes.NETWORK_DENIED,'AI mutation requires an unused explicit approval',{action});
      if(record.providerEpoch!==null&&record.providerEpoch!==providerEpoch){
        throw ocError(ErrorCodes.WORKER_STALE,'AI approval belongs to a stale provider epoch',{expected:record.providerEpoch,actual:providerEpoch});
      }
      record.used=true;
      return Object.freeze({allowed:true,mode:this.#mode,action,approvalId:id,readOnly:false,untrustedDataGrantedAuthority:false});
    }
    return Object.freeze({allowed:true,mode:this.#mode,action,approvalId:null,readOnly:true,untrustedDataGrantedAuthority:false});
  }
}

export class AiChangeSetAuthority {
  #workspace;
  #validator;
  #commits=new Map();
  #recovery=new Map();

  constructor({workspace,validator=null}={}){
    assertOc(workspace&&typeof workspace.beginTransaction==='function'&&typeof workspace.snapshot==='function',ErrorCodes.INVALID_ARGUMENT,'AI ChangeSet authority requires a transactional workspace');
    assertOc(validator===null||typeof validator==='function',ErrorCodes.INVALID_ARGUMENT,'AI ChangeSet validator must be a function');
    this.#workspace=workspace;
    this.#validator=validator;
  }

  prepare({id,expectedGeneration=this.#workspace.generation,operations=[],destructive=false}={}){
    assertOc(typeof id==='string'&&id.length>0,ErrorCodes.INVALID_ARGUMENT,'AI ChangeSet id is required');
    assertOc(Array.isArray(operations)&&operations.length>0,ErrorCodes.INVALID_ARGUMENT,'AI ChangeSet operations are required');
    const normalized=operations.map((op,index)=>{
      assertOc(op&&['write','remove'].includes(op.kind),ErrorCodes.INVALID_ARGUMENT,'AI ChangeSet operation must be write/remove',{index});
      const path=pathString(op.path);
      return Object.freeze({
        kind:op.kind,
        path,
        content:op.kind==='write'?String(op.content??''):null
      });
    });
    const touched=new Set(normalized.map(op=>op.path));
    assertOc(touched.size===normalized.length,ErrorCodes.INVALID_ARGUMENT,'AI ChangeSet cannot target one path more than once');
    const broad=destructive===true||normalized.length>=5||normalized.filter(op=>op.kind==='remove').length>=2;
    const before=normalized.map(op=>Object.freeze({path:op.path,bytes:cloneBytes(readBytes(this.#workspace,op.path))}));
    return Object.freeze({
      schema:'opencontainer.ai-changeset.v1.0',
      id,
      expectedGeneration,
      operations:Object.freeze(normalized),
      destructive:broad,
      before:Object.freeze(before)
    });
  }

  async apply(changeSet,{signal=null,phaseHook=null}={}){
    assertOc(changeSet?.schema==='opencontainer.ai-changeset.v1.0',ErrorCodes.INVALID_ARGUMENT,'Invalid AI ChangeSet');
    const existing=this.#commits.get(changeSet.id);
    if(existing)return Object.freeze({...existing,idempotentReplay:true});
    assertOc(this.#workspace.generation===changeSet.expectedGeneration,ErrorCodes.STALE_GENERATION,'AI ChangeSet workspace precondition failed',{
      expectedGeneration:changeSet.expectedGeneration,currentGeneration:this.#workspace.generation
    });
    const checkAbort=phase=>{
      if(signal?.aborted)throw ocError(ErrorCodes.WORKER_STALE,'AI ChangeSet cancelled before canonical publish',{phase,reason:signal.reason});
    };
    checkAbort('pre-tool');
    await phaseHook?.('pre-tool',changeSet);
    checkAbort('in-tool');

    const overlay=changeSet.operations.map(op=>Object.freeze({
      ...op,
      beforeBytes:cloneBytes(readBytes(this.#workspace,op.path))
    }));
    const validation=this.#validator?await this.#validator(Object.freeze({changeSet,overlay:Object.freeze(overlay)})):Object.freeze({ok:true});
    assertOc(validation?.ok!==false,ErrorCodes.INVALID_ARGUMENT,'AI ChangeSet validation failed',{validation});

    const recoveryPoint=changeSet.destructive?Object.freeze({
      id:'recovery-'+changeSet.id,
      generation:this.#workspace.generation,
      snapshot:this.#workspace.snapshot()
    }):null;
    if(recoveryPoint)this.#recovery.set(recoveryPoint.id,recoveryPoint);

    await phaseHook?.('pre-commit',changeSet);
    checkAbort('pre-commit');

    const tx=this.#workspace.beginTransaction();
    for(const op of changeSet.operations){
      if(op.kind==='write')tx.writeFile(op.path,op.content);
      else tx.remove(op.path);
    }
    const generation=tx.commit();
    const after=changeSet.operations.map(op=>Object.freeze({path:op.path,bytes:cloneBytes(readBytes(this.#workspace,op.path))}));
    const commit=Object.freeze({
      id:changeSet.id,
      idempotentReplay:false,
      committed:true,
      acknowledged:false,
      expectedGeneration:changeSet.expectedGeneration,
      committedGeneration:generation,
      destructive:changeSet.destructive,
      recoveryPointId:recoveryPoint?.id??null,
      operations:changeSet.operations,
      before:changeSet.before,
      after:Object.freeze(after)
    });
    this.#commits.set(changeSet.id,commit);

    await phaseHook?.('post-commit',commit);
    if(signal?.aborted){
      return Object.freeze({...commit,acknowledged:false,cancelledAfterCommit:true,cancellationReason:signal.reason});
    }
    await phaseHook?.('pre-ack',commit);
    if(signal?.aborted){
      return Object.freeze({...commit,acknowledged:false,cancelledAfterCommit:true,cancellationReason:signal.reason});
    }
    const acknowledged=Object.freeze({...commit,acknowledged:true,cancelledAfterCommit:false});
    this.#commits.set(changeSet.id,acknowledged);
    return acknowledged;
  }

  receipt(id){
    const receipt=this.#commits.get(id);
    assertOc(receipt,ErrorCodes.NOT_FOUND,'AI ChangeSet receipt not found',{id});
    return receipt;
  }

  acknowledge(id){
    const receipt=this.receipt(id);
    if(receipt.acknowledged===true)return Object.freeze({...receipt,idempotentAcknowledge:true});
    const acknowledged=Object.freeze({
      ...receipt,
      acknowledged:true,
      cancelledAfterCommit:false,
      idempotentAcknowledge:false
    });
    this.#commits.set(id,acknowledged);
    return acknowledged;
  }

  recoveryPoint(id){
    const point=this.#recovery.get(id);
    assertOc(point,ErrorCodes.NOT_FOUND,'AI recovery point not found',{id});
    return point;
  }

  undo(id){
    const commit=this.receipt(id);
    for(let i=0;i<commit.after.length;i++){
      const expected=commit.after[i].bytes;
      const current=readBytes(this.#workspace,commit.after[i].path);
      if(!bytesEqual(expected,current)){
        throw ocError(ErrorCodes.STALE_GENERATION,'AI undo refused to overwrite newer user edits',{
          id,path:commit.after[i].path,currentGeneration:this.#workspace.generation,committedGeneration:commit.committedGeneration
        });
      }
    }
    const tx=this.#workspace.beginTransaction();
    for(const item of commit.before){
      if(item.bytes===null)tx.remove(item.path);
      else tx.writeFile(item.path,item.bytes);
    }
    const generation=tx.commit();
    return Object.freeze({
      id,
      undone:true,
      inverseType:'path-version-aware',
      generation,
      paths:Object.freeze(commit.before.map(item=>item.path))
    });
  }
}

export class AiChildAgentAuthority {
  #epoch=0;
  #cancelled=false;
  #reviewEvidence=[];

  start(){
    this.#epoch++;
    this.#cancelled=false;
    return this.identity;
  }

  cancel(reason='cancelled'){
    this.#cancelled=true;
    this.#epoch++;
    return Object.freeze({epoch:this.#epoch,cancelled:true,reason});
  }

  get identity(){return Object.freeze({epoch:this.#epoch,cancelled:this.#cancelled});}

  acceptResult(result,{epoch}={}){
    if(this.#cancelled||epoch!==this.#epoch){
      const evidence=Object.freeze({epoch,result,accepted:false,reason:'stale-child-result'});
      this.#reviewEvidence.push(evidence);
      return evidence;
    }
    return Object.freeze({epoch,result,accepted:true,reason:null});
  }

  get reviewEvidence(){return Object.freeze([...this.#reviewEvidence]);}
}

export class AiSharedConcurrencyAuthority {
  #resources;
  #maxAgents;
  #active=0;

  constructor({resources,maxAgents=2}={}){
    assertOc(resources&&typeof resources.acquireTask==='function',ErrorCodes.INVALID_ARGUMENT,'AI shared concurrency authority requires ResourceGovernor');
    assertOc(Number.isInteger(maxAgents)&&maxAgents>=1,ErrorCodes.INVALID_ARGUMENT,'AI maxAgents must be >= 1');
    this.#resources=resources;
    this.#maxAgents=maxAgents;
  }

  acquire({background=true,inFlightBytes=0,owner='ai-consumer'}={}){
    if(this.#active>=this.#maxAgents){
      throw ocError(ErrorCodes.RESOURCE_EXHAUSTED,'AI shared agent concurrency exhausted',{active:this.#active,maxAgents:this.#maxAgents});
    }
    const task=this.#resources.acquireTask({background,inFlightBytes,owner});
    this.#active++;
    let released=false;
    return Object.freeze({
      task,
      release:()=>{
        if(released)return false;
        released=true;
        this.#active--;
        return task.release();
      }
    });
  }

  get usage(){return Object.freeze({active:this.#active,maxAgents:this.#maxAgents});}
}

export class AiProviderBoundary {
  #session;
  #workspace;

  constructor({session,workspace}={}){
    assertOc(session instanceof AiProviderSession,ErrorCodes.INVALID_ARGUMENT,'AI provider boundary requires AiProviderSession');
    assertOc(workspace&&typeof workspace.generation==='number',ErrorCodes.INVALID_ARGUMENT,'AI provider boundary requires workspace');
    this.#session=session;
    this.#workspace=workspace;
  }

  async invoke(adapter,{credential,request,signal=null}={}){
    assertOc(adapter&&typeof adapter.invoke==='function',ErrorCodes.INVALID_ARGUMENT,'AI provider adapter must expose invoke()');
    const identity=this.#session.identity;
    const beforeGeneration=this.#workspace.generation;
    const key=this.#session.resolveSessionKey(credential,{provider:identity.provider,epoch:identity.epoch});
    try{
      const response=await adapter.invoke(Object.freeze({
        provider:identity.provider,
        epoch:identity.epoch,
        apiKey:key,
        request,
        signal
      }));
      assertOc(this.#session.identity.epoch===identity.epoch&&this.#session.identity.provider===identity.provider,ErrorCodes.WORKER_STALE,'AI provider switched while request was in flight');
      return Object.freeze({
        ok:true,
        provider:identity.provider,
        epoch:identity.epoch,
        response:response?.data??response,
        usage:safeUsageMetadata(response?.usage),
        workspaceGenerationUnchanged:this.#workspace.generation===beforeGeneration
      });
    }catch(error){
      return Object.freeze({
        ok:false,
        provider:identity.provider,
        epoch:identity.epoch,
        code:error?.code??'AI_PROVIDER_ERROR',
        message:error?.message??String(error),
        usage:safeUsageMetadata(error?.usage),
        workspaceGenerationUnchanged:this.#workspace.generation===beforeGeneration
      });
    }
  }
}

export class AiCostDisplay {
  static fromUsage(usage){
    const safe=safeUsageMetadata(usage);
    if(!safe.authoritative){
      return Object.freeze({visible:false,tokens:null,cost:null,currency:null,reason:'authoritative-provider-metadata-required'});
    }
    return Object.freeze({
      visible:true,
      tokens:Object.freeze({input:safe.inputTokens,output:safe.outputTokens,total:safe.totalTokens}),
      cost:safe.cost,
      currency:safe.currency,
      reason:null
    });
  }
}

export const AiModes=Object.freeze({
  DISCUSS:'Discuss',
  PLAN:'Plan',
  BUILD:'Build'
});

export function classifyAiContextPath(path){return classifyPath(path);}
