const SECRET_KEYS = /(?:authorization|cookie|token|secret|password|api[-_]?key|credential|session[-_]?key)/i;
const PRIVATE_CONTENT_KEYS = /^(?:body|source|sourceText|content|fileContents|prompt|transcript|completion|messages?)$/i;
const SECRET_VALUE = /\b(?:bearer\s+)?[A-Za-z0-9_\-]{20,}\b/gi;
const SIGNED_QUERY = /([?&](?:token|access_token|api[-_]?key|signature|sig|x-amz-signature|x-goog-signature|credential)=)[^&#\s]+/gi;

function redactString(value){
  return String(value)
    .replace(SIGNED_QUERY,'$1[REDACTED]')
    .replace(SECRET_VALUE,'[REDACTED]');
}

export function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out = {};
  for (const [key,item] of Object.entries(value)) {
    if (SECRET_KEYS.test(key) || PRIVATE_CONTENT_KEYS.test(key)) out[key] = '[REDACTED]';
    else out[key] = redact(item, seen);
  }
  return out;
}

function stableStringify(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stableStringify).join(',')+']';
  const keys=Object.keys(value).sort();
  return '{'+keys.map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
}

export class DiagnosticJournal {
  #entries=[]; #limit; #duplicateLimit; #sequence=0; #suppressedDuplicates=0; #recorded=0;
  constructor({limit=1000,duplicateLimit=8}={}) {
    this.#limit=Math.max(1,Number(limit)||1);
    this.#duplicateLimit=Math.max(1,Number(duplicateLimit)||1);
  }
  record(type, detail={}) {
    const seq=++this.#sequence;
    const safeType=redactString(String(type??'diagnostic'));
    const safeDetail=redact(detail);
    const signature=safeType+'\n'+stableStringify(safeDetail);
    let duplicates=0;
    for(let index=this.#entries.length-1;index>=0;index--){
      const entry=this.#entries[index];
      if(entry.signature===signature)duplicates++;
      if(duplicates>=this.#duplicateLimit)break;
    }
    if(duplicates>=this.#duplicateLimit){
      this.#suppressedDuplicates++;
      return Object.freeze({seq,type:safeType,suppressed:true});
    }
    const entry=Object.freeze({seq,type:safeType,detail:safeDetail,signature});
    this.#entries.push(entry);
    this.#recorded++;
    if (this.#entries.length>this.#limit) this.#entries.splice(0,this.#entries.length-this.#limit);
    return Object.freeze({seq:entry.seq,type:entry.type,detail:entry.detail});
  }
  list({since=0}={}) {
    return this.#entries
      .filter((entry)=>entry.seq>since)
      .map(({signature,...entry})=>Object.freeze(entry));
  }
  stats(){
    return Object.freeze({
      retained:this.#entries.length,
      limit:this.#limit,
      duplicateLimit:this.#duplicateLimit,
      suppressedDuplicates:this.#suppressedDuplicates,
      recorded:this.#recorded,
      lastSequence:this.#sequence
    });
  }
  clear() { this.#entries.length=0; }
}

export { browserCapabilityProbe, probeDeploymentHeaders, supportPreview, buildSupportBundle } from './support.js';
