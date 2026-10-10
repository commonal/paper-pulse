import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {getBoss,stopBoss} from '@aihot/backend/jobs/queue';
import {config} from '@aihot/backend/config';
import {installModules} from '@aihot/backend/modules';
import {buildApp} from '../../../apps/api/src/app.ts';
import papersModule from '../server.ts';
import {readingDate,nextDiscoveryTime,dailyCounts,dailyState,dailyMessage} from '../daily.ts';
import {todayReading} from '../backend/daily-status.ts';
import type {Paper,DailyReadingStatus} from '../types.ts';
after(async()=>{await stopBoss();await closeDb();});

const now=new Date('2026-10-08T02:00:00Z');
function snapshot():Omit<DailyReadingStatus,'state'>{
  return {date:'2026-10-08',enabled:true,activePlans:1,dailyLimit:3,time:'06:00',timezone:'Asia/Shanghai',
    nextRunAt:nextDiscoveryTime(now),lastRun:null,lastSuccessAt:null,counts:dailyCounts([],new Map())};
}
test('daily date and next scheduled start follow Beijing midnight and 06:00 boundaries',()=>{
  assert.equal(readingDate(new Date('2026-10-07T15:59:59Z')),'2026-10-07');
  assert.equal(readingDate(new Date('2026-10-07T16:00:00Z')),'2026-10-08');
  assert.equal(nextDiscoveryTime(new Date('2026-10-07T21:59:59Z')),'2026-10-07T22:00:00.000Z');
  assert.equal(nextDiscoveryTime(new Date('2026-10-07T22:00:00Z')),'2026-10-08T22:00:00.000Z');
});
test('empty queue distinguishes not due, overdue, skipped, running, failure and successful empty discovery',()=>{
  const s=snapshot();
  assert.equal(dailyState(s,new Date('2026-10-07T21:59:59Z')),'scheduled');
  assert.equal(dailyState(s,now),'overdue');
  s.lastRun={started_at:'2026-10-06T22:00:00Z',finished_at:'2026-10-06T22:01:00Z',status:'ok'};
  assert.equal(dailyState(s,now),'overdue');
  s.lastRun.started_at='2026-10-07T22:00:00Z';
  for(const [status,state] of [['skipped','overdue'],['running','discovering'],['failed','discovery_failed'],['ok','empty']] as const){
    s.lastRun.status=status;assert.equal(dailyState(s,now),state);
  }
  assert.equal(dailyState({...s,activePlans:0},now),'paused');
  assert.equal(dailyState({...s,enabled:false},now),'disabled');
});
test('readable articles and full completion stay distinct; only explicit persisted budget errors count as budget waits',()=>{
  const papers=[
    {id:'complete',digest_status:'ready',reading_status:'ready'},
    {id:'figure-processing',digest_status:'ready',reading_status:'running'},
    {id:'budget',digest_status:'ready',reading_status:'waiting'},
    {id:'receipt',digest_status:'queued',reading_status:'waiting'},
    {id:'failed',digest_status:'failed',reading_status:'failed'},
    {id:'untouched',digest_status:'unavailable'},
    {id:'invalidated',digest_status:'unavailable',reading_status:'ready'},
  ] as Paper[];
  const counts=dailyCounts(papers,new Map([['budget','服务请求预算暂时不足，等待额度恢复后自动继续。'],['receipt','请求已发送但结果尚未取回']]));
  assert.deepEqual(counts,{selected:7,readable:3,completed:1,processing:1,waiting:2,failed:1,notStarted:2,budgetWaiting:1});
  const s=snapshot();s.counts=counts;
  assert.equal(dailyState(s,now),'incomplete');
  s.counts=dailyCounts(papers.slice(0,4),new Map());assert.equal(dailyState(s,now),'waiting');
  s.counts=dailyCounts(papers.slice(0,2),new Map());assert.equal(dailyState(s,now),'processing');
  s.counts=dailyCounts(papers.slice(0,1),new Map());assert.equal(dailyState(s,now),'ready');
  assert.doesNotMatch(dailyMessage({...s,state:'waiting'}).description,/预算/);
});
test('持久化检索等待不误报成功空队列，已入选论文不被检索失败遮住',()=>{
  const s=snapshot();s.lastRun={started_at:'2026-10-07T22:00:00Z',finished_at:'2026-10-07T22:01:00Z',status:'ok'};
  s.discovery={status:'waiting',nextRetryAt:'2026-10-08T03:00:00Z',readyPlans:1,pendingPlans:1,failedPlans:0,errors:['HTTP 429']};
  assert.equal(dailyState(s,now),'discovery_waiting');
  s.counts={...s.counts,selected:1,processing:1};s.lastRun.status='failed';
  assert.equal(dailyState(s,now),'processing');
});

test('daily API reads saved schedule/run/task facts, preserves last success after failure and never enqueues work',async()=>{
  // Before worker bootstrap the pg-boss schedule table is legitimately absent.
  const initialPlans=await sql`SELECT id,enabled FROM paper_discovery_plans ORDER BY id`;
  const before=await todayReading(now);
  assert.equal(before.daily.state,'disabled');
  assert.equal(before.daily.activePlans,initialPlans.filter(row=>row.enabled).length);
  assert.deepEqual(await sql`SELECT id,enabled FROM paper_discovery_plans ORDER BY id`,initialPlans);
  const boss=await getBoss();
  await boss.createQueue('cron.papers.discovery');
  await boss.schedule('cron.papers.discovery','0 6 * * *',{}, {tz:'Asia/Shanghai'});
  await sql`INSERT INTO paper_discovery_plans(id,kind,title) VALUES('daily-status-test','personal','test')`;
  await sql`INSERT INTO job_runs(job,started_at,finished_at,status) VALUES('papers.discovery','2026-10-06T22:00:00Z','2026-10-06T22:01:00Z','ok')`;
  let result=await todayReading(now);
  assert.equal(result.daily.state,'overdue');
  assert.equal(new Date(result.daily.lastSuccessAt!).toISOString(),'2026-10-06T22:01:00.000Z');
  const [run]=await sql`INSERT INTO job_runs(job,started_at,status) VALUES('papers.discovery','2026-10-07T22:00:00Z','running') RETURNING id`;
  assert.equal((await todayReading(now)).daily.state,'discovering');
  await sql`UPDATE job_runs SET status='failed',finished_at='2026-10-07T22:01:00Z',error='private provider details' WHERE id=${run.id}`;
  result=await todayReading(now);
  assert.equal(result.daily.state,'discovery_failed');
  assert.equal(new Date(result.daily.lastSuccessAt!).toISOString(),'2026-10-06T22:01:00.000Z');
  assert.doesNotMatch(JSON.stringify(result),/private provider details/);
  await sql`UPDATE job_runs SET status='ok' WHERE id=${run.id}`;
  assert.equal((await todayReading(now)).daily.state,'empty');
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  for(const [i,id] of ids.entries()){
    await sql`INSERT INTO papers(id,title,source_url) VALUES(${id},${'Daily '+i},${'urn:daily-test:'+id})`;
    await sql`INSERT INTO paper_daily_queue(queue_date,paper_id,source_kind) VALUES('2026-10-08',${id},'personal')`;
    await sql`INSERT INTO paper_digests(paper_id,status) VALUES(${id},'ready')`;
    await sql`INSERT INTO paper_reading_tasks(paper_id,run_id,status,stage,error) VALUES(${id},${randomUUID()},${i===0?'ready':'waiting'},${i===0?'complete':'illustrations'},${i===1?'服务请求预算暂时不足，等待额度恢复后自动继续。':i===2?'请求已发送但结果尚未取回':null})`;
  }
  result=await todayReading(now);
  assert.equal(result.daily.state,'waiting');
  assert.deepEqual(result.daily.counts,{selected:3,readable:3,completed:1,processing:0,waiting:2,failed:0,notStarted:0,budgetWaiting:1});
  const saved=await sql`SELECT (SELECT count(*) FROM pgboss.job)::int AS jobs,(SELECT count(*) FROM receipts)::int AS receipts,(SELECT count(*) FROM paper_reading_tasks)::int AS tasks`;
  const previous=config.devAdmin;
  config.devAdmin={displayName:'Daily status test'};installModules([papersModule]);
  const app=await buildApp();await app.ready();
  try{
    for(let i=0;i<2;i++){
      const response=await app.inject('/api/admin/papers/today');assert.equal(response.statusCode,200);
      assert.equal(response.json().daily.time,'06:00');assert.equal(response.json().daily.timezone,'Asia/Shanghai');
      assert.doesNotMatch(response.body,/private provider details|服务请求预算暂时不足/);
    }
    assert.deepEqual(await sql`SELECT (SELECT count(*) FROM pgboss.job)::int AS jobs,(SELECT count(*) FROM receipts)::int AS receipts,(SELECT count(*) FROM paper_reading_tasks)::int AS tasks`,saved);
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/papers/today')).statusCode,401);
  }finally{config.devAdmin=previous;installModules([]);await app.close();}
});
