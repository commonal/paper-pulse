import {setTimeout as delay} from 'node:timers/promises';
import {sql} from '@aihot/backend/db';

export function discoveryRetryAt(now:Date,attempt:number,retryAfter:string|null){
  const base=now.getTime()+Math.min(120,15*2**(attempt-1))*60_000;
  const seconds=retryAfter!==null&&/^\d+$/.test(retryAfter)?Number(retryAfter):null;
  const requested=seconds!==null?now.getTime()+seconds*1000:Date.parse(retryAfter??'');
  return new Date(Number.isFinite(requested)?Math.max(base,requested):base);
}

/** Metadata imports and worker discovery share one provider connection and persisted cooldown. */
export async function requestArxiv(url:string,init:RequestInit,now=new Date(),intervalMs=3100,attempt=1){
  const started=Date.now();
  const currentTime=()=>new Date(now.getTime()+Date.now()-started);
  const session=await sql.reserve();let locked=false;
  try{
    await session`SELECT pg_advisory_lock(hashtext('papers.arxiv-request'))`;locked=true;
    await session`INSERT INTO paper_arxiv_throttle(singleton) VALUES(true) ON CONFLICT DO NOTHING`;
    const [gate]=await session`SELECT next_request_at,blocked_until FROM paper_arxiv_throttle WHERE singleton`;
    if(gate.blocked_until&&gate.blocked_until>currentTime())return new Response('',{status:429,headers:{'Retry-After':String(Math.ceil((gate.blocked_until.getTime()-currentTime().getTime())/1000))}});
    if(intervalMs!==0)await delay(Math.max(0,gate.next_request_at.getTime()-Date.now()));
    await session`UPDATE paper_arxiv_throttle SET next_request_at=${new Date(Date.now()+intervalMs)},blocked_until=NULL,updated_at=now() WHERE singleton`;
    const response=await fetch(url,init);
    if(response.status===429)await session`UPDATE paper_arxiv_throttle SET blocked_until=${discoveryRetryAt(currentTime(),attempt,response.headers.get('retry-after'))},updated_at=now() WHERE singleton`;
    // Drain the body before releasing the provider lock; headers alone do not end an HTTP request.
    const body=await response.text();
    return new Response(body,{status:response.status,headers:response.headers});
  }finally{try{if(locked)await session`SELECT pg_advisory_unlock(hashtext('papers.arxiv-request'))`;}finally{session.release();}}
}
