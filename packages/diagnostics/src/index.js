const SECRET_KEYS = /(?:authorization|cookie|token|secret|password|api[-_]?key)/i;
const SECRET_VALUE = /\b(?:bearer\s+)?[A-Za-z0-9_\-]{20,}\b/gi;

export function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[REDACTED]');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out = {};
  for (const [key,item] of Object.entries(value)) out[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item, seen);
  return out;
}

export class DiagnosticJournal {
  #entries=[]; #limit; #sequence=0;
  constructor({limit=1000}={}) { this.#limit=Math.max(1,limit); }
  record(type, detail={}) {
    const entry=Object.freeze({seq:++this.#sequence,type,detail:redact(detail)});
    this.#entries.push(entry);
    if (this.#entries.length>this.#limit) this.#entries.splice(0,this.#entries.length-this.#limit);
    return entry;
  }
  list({since=0}={}) { return this.#entries.filter((entry)=>entry.seq>since); }
  clear() { this.#entries.length=0; }
}
