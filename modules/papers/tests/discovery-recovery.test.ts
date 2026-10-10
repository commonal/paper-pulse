import '../../../tests/setup.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {runPaperDiscovery,recoverPaperDiscovery,listDiscoveryPlans,discoveryRetryAt} from '../backend/discovery.ts';
process.env.PAPER_DISCOVERY_ENABLED='true';

after(async()=>{await stopBoss();await closeDb();});
const now=new Date('2026-10-10T04:00:00Z');
const feed=(id:string)=>new Response(`<feed><totalResults>1</totalResults><entry><id>https://arxiv.org/abs/${id}</id><title>Retrieval augmented generation for search</title><published>2026-10-09T00:00:00Z</published><summary>RAG retrieval methods.</summary><category term="cs.IR"/><author><name>Fixture</name></author></entry></feed>`);
async function reset(){
  await listDiscoveryPlans();
  await sql`UPDATE paper_discovery_plans SET enabled=id IN ('hot-ai','personal-rag')`;
  await sql`TRUNCATE paper_discovery_progress,paper_arxiv_throttle,paper_daily_queue,paper_trend_snapshots CASCADE`;
  await sql`DELETE FROM papers WHERE arxiv_id LIKE '2610.990%'`;
}
test('一个方向失败不阻断另一个方向，恢复只重试失败方向且不重复每日任务',async()=>{
  await reset();const original=globalThis.fetch;let hits=0;
  globalThis.fetch=(async()=>{hits++;if(hits===1)return new Response('',{status:503});return feed('2610.99001v1');}) as typeof fetch;
  try{
    const first=await runPaperDiscovery(now,{requestIntervalMs:0});
    assert.equal(first.selected,1);assert.equal(first.status,'waiting');assert.equal(hits,3);
    assert.equal((await sql`SELECT status FROM paper_reading_tasks`)[0].status,'queued');
    await recoverPaperDiscovery(new Date(now.getTime()+60_000),{requestIntervalMs:0});assert.equal(hits,3);
    await recoverPaperDiscovery(new Date(now.getTime()+16*60_000),{requestIntervalMs:0});assert.equal(hits,5);
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_daily_queue`)[0].n,1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_reading_runs`)[0].n,1);
    await recoverPaperDiscovery(new Date(now.getTime()+17*60_000),{requestIntervalMs:0});assert.equal(hits,5);
    await runPaperDiscovery(now,{requestIntervalMs:0});assert.equal(hits,5,'日更作业重复投递也不重读完成窗口');
  }finally{globalThis.fetch=original;}
});
test('限流时仍从时效内已有候选启动精读，不选择旧论文或重复购买',async()=>{
  await reset();const original=globalThis.fetch;
  globalThis.fetch=(async()=>feed('2610.99004v1')) as typeof fetch;
  try{
    await runPaperDiscovery(new Date('2026-10-09T04:00:00Z'),{requestIntervalMs:0});
    await sql`DELETE FROM paper_daily_queue`;await sql`DELETE FROM paper_reading_tasks`;await sql`DELETE FROM paper_reading_runs`;
    await sql`UPDATE papers SET published='2026-09-01' WHERE arxiv_id='2610.99004'`;
    globalThis.fetch=(async()=>new Response('',{status:429})) as typeof fetch;
    assert.equal((await runPaperDiscovery(now,{requestIntervalMs:0})).selected,0,'过期候选不能补位');
    await sql`UPDATE papers SET published='2026-10-09' WHERE arxiv_id='2610.99004'`;
    assert.equal((await runPaperDiscovery(now,{requestIntervalMs:0})).selected,1,'冷却期间仍可选取合格候选');
    assert.equal((await runPaperDiscovery(now,{requestIntervalMs:0})).selected,0);
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_reading_runs`)[0].n,1);
  }finally{globalThis.fetch=original;}
});
test('并发日更与恢复只运行一个检索，请求间隔跨阶段和方向保留',async()=>{
  await reset();const original=globalThis.fetch;const times:number[]=[];
  let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
  let started!:()=>void;const firstRequest=new Promise<void>(resolve=>started=resolve);
  globalThis.fetch=(async()=>{times.push(Date.now());if(times.length===1){started();await hold;}return feed('2610.99005v1');}) as typeof fetch;
  try{
    const first=runPaperDiscovery(now,{requestIntervalMs:40});await firstRequest;
    try{assert.equal((await runPaperDiscovery(now,{requestIntervalMs:40})).status,'skipped');}finally{release();}
    await first;assert.equal(times.length,4);
    for(let i=1;i<times.length;i++)assert.ok(times[i]!-times[i-1]!>=35);
  }finally{release();globalThis.fetch=original;}
});
test('重试有上限且保留错误；Retry-After 支持秒数和 HTTP 日期',async()=>{
  await reset();await sql`UPDATE paper_discovery_plans SET enabled=id='personal-rag'`;
  const original=globalThis.fetch;let hits=0;
  globalThis.fetch=(async()=>{hits++;return new Response('',{status:503});}) as typeof fetch;
  try{
    await runPaperDiscovery(now,{requestIntervalMs:0});
    for(let i=1;i<=5;i++)await recoverPaperDiscovery(new Date(now.getTime()+i*121*60_000),{requestIntervalMs:0});
    assert.equal(hits,5);const [progress]=await sql`SELECT status,error,attempts FROM paper_discovery_progress`;
    assert.equal(progress.status,'failed');assert.equal(progress.attempts,5);assert.match(progress.error,/503/);
    assert.equal(discoveryRetryAt(now,1,null).getTime(),now.getTime()+15*60_000);
    assert.equal(discoveryRetryAt(now,1,'bad').getTime(),now.getTime()+15*60_000);
    assert.equal(discoveryRetryAt(now,1,new Date(now.getTime()+3600_000).toUTCString()).getTime(),now.getTime()+3600_000);
  }finally{globalThis.fetch=original;}
});
test('429 持久保存 Retry-After 冷却，重启式恢复不提前请求其他方向',async()=>{
  await reset();const original=globalThis.fetch;let hits=0;
  globalThis.fetch=(async()=>{hits++;return new Response('',{status:429,headers:{'Retry-After':'3600'}});}) as typeof fetch;
  try{
    const first=await runPaperDiscovery(now,{requestIntervalMs:0});assert.equal(first.status,'waiting');assert.equal(hits,1);
    assert.ok(new Date(first.next_retry_at!).getTime()>=now.getTime()+3600_000);
    assert.ok(new Date(first.next_retry_at!).getTime()<now.getTime()+3600_000+5000);
    await recoverPaperDiscovery(new Date(now.getTime()+30*60_000),{requestIntervalMs:0});assert.equal(hits,1);
    globalThis.fetch=(async()=>{hits++;return feed('2610.99002v1');}) as typeof fetch;
    await recoverPaperDiscovery(new Date(now.getTime()+61*60_000),{requestIntervalMs:0});assert.equal(hits,5);
  }finally{globalThis.fetch=original;}
});
test('趋势历史请求失败仍保存新候选并启动精读，恢复不重复读取最近窗口',async()=>{
  await reset();await sql`UPDATE paper_discovery_plans SET enabled=id='personal-rag'`;
  const original=globalThis.fetch;let hits=0;
  globalThis.fetch=(async()=>{hits++;return hits===2?new Response('',{status:503}):feed('2610.99003v1');}) as typeof fetch;
  try{
    const first=await runPaperDiscovery(now,{requestIntervalMs:0});assert.equal(first.selected,1);
    assert.equal((await sql`SELECT phase FROM paper_discovery_progress`)[0].phase,'previous');
    await recoverPaperDiscovery(new Date(now.getTime()+16*60_000),{requestIntervalMs:0});assert.equal(hits,3);
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_trend_snapshots WHERE observed_on='2026-10-10'`)[0].n,1);
  }finally{globalThis.fetch=original;}
});
test('06:00 前不补跑，关闭开关不恢复，永久错误不无限重试',async()=>{
  await reset();const original=globalThis.fetch,enabled=process.env.PAPER_DISCOVERY_ENABLED;let hits=0;
  globalThis.fetch=(async()=>{hits++;return new Response('',{status:400});}) as typeof fetch;
  try{
    process.env.PAPER_DISCOVERY_ENABLED='true';
    await recoverPaperDiscovery(new Date('2026-10-09T21:59:59Z'),{requestIntervalMs:0});assert.equal(hits,0);
    const result=await runPaperDiscovery(now,{requestIntervalMs:0});assert.equal(result.status,'failed');assert.equal(hits,2);
    await recoverPaperDiscovery(new Date(now.getTime()+20*60_000),{requestIntervalMs:0});assert.equal(hits,2);
    await reset();process.env.PAPER_DISCOVERY_ENABLED='false';await recoverPaperDiscovery(now,{requestIntervalMs:0});assert.equal(hits,2);
  }finally{globalThis.fetch=original;if(enabled===undefined)delete process.env.PAPER_DISCOVERY_ENABLED;else process.env.PAPER_DISCOVERY_ENABLED=enabled;}
});
test('06:00 漏跑会在当天补跑，跨08:00恢复沿用原查询窗口',async()=>{
  await reset();await sql`UPDATE paper_discovery_plans SET enabled=id='personal-rag'`;
  const original=globalThis.fetch;let hits=0;const queries:string[]=[];
  globalThis.fetch=(async input=>{hits++;queries.push(new URL(String(input)).searchParams.get('search_query')!);return hits===2?new Response('',{status:503}):feed('2610.99006v1');}) as typeof fetch;
  try{
    // The fixture has older success records; none are from this reading day.
    await sql`DELETE FROM job_runs WHERE job='papers.discovery'`;
    await recoverPaperDiscovery(new Date('2026-10-09T23:55:00Z'),{requestIntervalMs:0});assert.equal(hits,2);
    await recoverPaperDiscovery(new Date('2026-10-10T00:15:00Z'),{requestIntervalMs:0});assert.equal(hits,3);
    assert.equal(queries[1],queries[2],'仅恢复趋势请求，不因UTC午夜重新检索最近窗口');
  }finally{globalThis.fetch=original;}
});
