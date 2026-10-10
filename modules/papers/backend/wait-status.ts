import {sql} from '@aihot/backend/db';
import type {Paper,PaperReadingTask} from '../types.ts';
import {requestBudget,readingWait} from '../waiting.ts';

export async function requestBudgets(now=new Date()){
  const rows=await sql<{service:string;per_minute:number;per_hour:number;per_day:number;starts:Date[]}[]>`SELECT b.service,b.per_minute,b.per_hour,b.per_day,
    coalesce(array_agg(a.started_at ORDER BY a.started_at) FILTER(WHERE a.id IS NOT NULL),'{}'::timestamptz[]) AS starts
    FROM budgets b LEFT JOIN receipt_attempts a ON a.service=b.service AND a.origin='live' AND a.started_at>${now}::timestamptz-interval '24 hours'
    WHERE b.service IN ('llm','mineru') GROUP BY b.service`;
  return rows.map(row=>requestBudget(row.service,row,row.starts,now));
}
export async function withReadingWaits<T extends Paper>(papers:T[],now=new Date()):Promise<T[]>{
  const budgets=papers.some(p=>p.reading_status==='waiting')?await requestBudgets(now):[];
  return papers.map(p=>{
    const {reading_error,...safe}=p;
    const failure=p.reading_status==='failed'&&(reading_error?.includes('HTTP 429')||reading_error?.includes('供应商暂时不可用'))?reading_error:null;
    return {...safe,...(failure?{reading_error:failure}:{}),reading_wait:p.reading_status==='waiting'?readingWait(reading_error,p.reading_stage,budgets.find(b=>b.service===(p.reading_stage==='material'?'mineru':'llm')),now):null} as T;
  });
}
export async function withTaskWait(task:PaperReadingTask|null,now=new Date()){
  if(!task||task.status!=='waiting')return task;
  const budgets=await requestBudgets(now);
  return {...task,wait:readingWait(task.error,task.stage,budgets.find(b=>b.service===(task.stage==='material'?'mineru':'llm')),now)};
}
