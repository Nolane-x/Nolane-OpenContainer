import { ErrorCodes, ocError } from '../../protocol/src/index.js';

function isLocalHost(hostname){const host=hostname.toLowerCase();return host==='localhost'||host==='127.0.0.1'||host==='::1'||host.endsWith('.localhost');}

export class NetworkAuthority {
  #rules=[];#allowLocal=false;
  constructor({allowLocal=false}={}){this.#allowLocal=allowLocal;}
  allow(rule){
    const origin=new URL(rule.origin).origin;
    const methods=new Set((rule.methods??['GET']).map((item)=>String(item).toUpperCase()));
    this.#rules.push(Object.freeze({origin,methods,paths:rule.paths?[...rule.paths]:null}));
    return this;
  }
  authorize(url,{method='GET'}={}){
    const parsed=new URL(url);const normalizedMethod=String(method).toUpperCase();
    if(!['http:','https:'].includes(parsed.protocol))throw ocError(ErrorCodes.NETWORK_DENIED,'Only http(s) external networking is allowed',{url:parsed.href});
    if(isLocalHost(parsed.hostname)&&!this.#allowLocal)throw ocError(ErrorCodes.NETWORK_DENIED,'Loopback/local networking denied',{url:parsed.href});
    const rule=this.#rules.find((candidate)=>candidate.origin===parsed.origin&&candidate.methods.has(normalizedMethod)&&(!candidate.paths||candidate.paths.some((prefix)=>parsed.pathname.startsWith(prefix))));
    if(!rule)throw ocError(ErrorCodes.NETWORK_DENIED,'Network capability denied',{url:parsed.href,method:normalizedMethod});
    return Object.freeze({url:parsed.href,origin:parsed.origin,method:normalizedMethod});
  }
}
