import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {requestBudget,readingWait,nextRecoveryAt} from '../waiting.ts';
import {withTaskWait,withReadingWaits} from '../backend/wait-status.ts';
import {readingTask} from '../backend/reading-task.ts';
import {paperTaskFailure,paperTaskWaits} from '../backend/task-errors.ts';
import {ProviderRejectedError,BudgetExceededError} from '@aihot/backend/providers/receipts';
import type {Paper} from '../types.ts';
after(closeDb);

test('滚动窗口超额后，第三笔过期才恢复容量；不是第一笔过期就能继续',()=>{
  const now=new Date('2026-10-08T05:00:00Z');
  const starts=Array.from({length:14},(_,i)=>new Date(Date.parse('2026-10-07T06:00:00Z')+i*60000));
  const b=requestBudget('llm',{per_minute:4,per_hour:24,per_day:12},starts,now);
  assert.equal(b.windows[2]!.used,14);assert.equal(b.nextAvailableAt,'2026-10-08T06:02:00.000Z');
  const info=readingWait('服务请求预算暂时不足','reading',b,now);
  assert.match(info.detail,/14\/12/);assert.equal(info.nextRetryAt,'2026-10-08T06:05:00.000Z');
});
test('多窗口共同阻塞取最晚释放时间；零上限不承诺自动恢复',()=>{
  const now=new Date('2026-10-08T06:00:00Z');
  const starts=[new Date('2026-10-08T05:59:40Z'),new Date('2026-10-08T05:59:50Z')];
  const b=requestBudget('llm',{per_minute:1,per_hour:1,per_day:1},starts,now);
  assert.equal(b.nextAvailableAt,'2026-10-09T05:59:50.000Z');
  const stopped=requestBudget('llm',{per_minute:0,per_hour:24,per_day:60},starts,now);
  assert.equal(readingWait('预算不足','review',stopped,now).nextRetryAt,null);
  assert.match(readingWait('预算不足','review',requestBudget('llm',{per_minute:4,per_hour:24,per_day:60},[],now),now).title,/额度已恢复/);
  assert.equal(nextRecoveryAt(now),'2026-10-08T06:05:00.000Z');
});
test('配置关闭、结果未知、已有请求和供应商限流各有明确说明',()=>{
  const now=new Date();
  assert.equal(readingWait('模型调用未启用','reading',undefined,now).kind,'model_disabled');
  assert.equal(readingWait('请求已发送但结果尚未取回','review',undefined,now).nextRetryAt,null);
  assert.equal(readingWait('同一请求正在执行','reading',undefined,now).kind,'receipt_busy');
  assert.doesNotMatch(readingWait('internal error with request details','reading',undefined,now).detail,/internal|request details/);
  const error=new ProviderRejectedError('unsafe raw provider body',429,true);
  assert.match(paperTaskFailure(error).error,/供应商限流/);assert.doesNotMatch(paperTaskFailure(error).error,/unsafe/);
  assert.equal(paperTaskWaits(error),false,'供应商故障沿用有限队列重试，不进入无限恢复循环');
  assert.equal(paperTaskWaits(new BudgetExceededError('llm','day',3600)),true);
});
test('真实持久化等待任务可读地显示预算与时间，读取不新增请求或改写任务',async()=>{
  const id=randomUUID();
  await sql`INSERT INTO papers(id,title,source_url) VALUES(${id},'Waiting metadata fixture',${`https://example.org/${id}`})`;
  await sql`INSERT INTO paper_reading_tasks(paper_id,run_id,status,stage,error) VALUES(${id},${randomUUID()},'waiting','reading','服务请求预算暂时不足，等待额度恢复后自动继续。')`;
  const task=(await readingTask(id))!;
  const [before]=await sql`SELECT count(*)::int AS n FROM receipt_attempts`;
  const view=await withTaskWait(task);assert.equal(view!.wait!.kind,'budget');assert.ok(view!.wait!.budget!.windows.length===3);
  const papers=await withReadingWaits([{id,reading_status:task.status,reading_stage:task.stage,reading_error:task.error} as Paper]);
  assert.equal(papers[0]!.reading_wait!.kind,'budget');
  const [after]=await sql`SELECT count(*)::int AS n FROM receipt_attempts`;
  assert.equal(after!.n,before!.n);assert.equal((await readingTask(id))!.updated_at.toString(),task.updated_at.toString());
});
