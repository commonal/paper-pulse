import {sql} from '@aihot/backend/db';
import type {DailyReadingStatus} from '../types.ts';
import {DAILY_DISCOVERY,readingDate,nextDiscoveryTime,dailyCounts,dailyState} from '../daily.ts';
import {todayQueue,discoveryProgress} from './discovery.ts';

/** Read persisted schedule/run/task records only; opening the homepage never starts work. */
export async function todayReading(now=new Date()){
  const date=readingDate(now);
  const papers=await todayQueue(now);
  // pg-boss owns this table: it does not exist before the worker's first startup.
  const [schema]=await sql`SELECT to_regclass('pgboss.schedule') IS NOT NULL AS present`;
  const schedule=schema?.present?await sql`SELECT name FROM pgboss.schedule WHERE name='cron.papers.discovery'`:[];
  const [settings]=await sql`SELECT daily_limit FROM paper_discovery_settings WHERE singleton=true`;
  const [plans]=await sql`SELECT count(*)::int AS n FROM paper_discovery_plans WHERE enabled`;
  const [lastRun]=await sql<{started_at:Date;finished_at:Date|null;status:NonNullable<DailyReadingStatus['lastRun']>['status']}[]>`SELECT started_at,finished_at,status FROM job_runs WHERE job='papers.discovery' AND (detail->>'status' IS DISTINCT FROM 'skipped') ORDER BY started_at DESC,id DESC LIMIT 1`;
  const [success]=await sql`SELECT finished_at FROM job_runs WHERE job='papers.discovery' AND status='ok' AND finished_at IS NOT NULL AND (detail->>'status'='complete' OR detail->>'status' IS NULL) ORDER BY finished_at DESC LIMIT 1`;
  const progress=await discoveryProgress(now);
  const waiting=await sql`SELECT t.paper_id,t.error FROM paper_reading_tasks t JOIN paper_daily_queue q ON q.paper_id=t.paper_id WHERE q.queue_date=${date}::date AND t.status='waiting'`;
  const exclusions=await sql<{paper_id:string;title:string;reason:string;removed_at:Date}[]>`
    SELECT e.paper_id,p.title,e.reason,e.removed_at FROM paper_daily_exclusions e JOIN papers p ON p.id=e.paper_id WHERE e.queue_date=${date}::date
    UNION ALL SELECT r.paper_id,p.title,r.error AS reason,r.finished_at AS removed_at FROM paper_reading_runs r JOIN papers p ON p.id=r.paper_id
      WHERE r.error LIKE '自动日更跳过：%' AND (r.finished_at AT TIME ZONE 'Asia/Shanghai')::date=${date}::date
    ORDER BY removed_at`;
  const enabled=schedule.length>0;
  const snapshot:Omit<DailyReadingStatus,'state'>={date,enabled,activePlans:plans!.n,dailyLimit:settings?.daily_limit??3,
    time:DAILY_DISCOVERY.time,timezone:DAILY_DISCOVERY.timezone,nextRunAt:enabled&&plans!.n>0?nextDiscoveryTime(now):null,
    lastRun:lastRun?{...lastRun,started_at:lastRun.started_at.toISOString(),finished_at:lastRun.finished_at?.toISOString()??null}:null,
    lastSuccessAt:success?.finished_at.toISOString()??null,
    exclusions:exclusions.map(row=>({paperId:row.paper_id,title:row.title,reason:row.reason,removedAt:row.removed_at.toISOString()})),
    discovery:progress.plans.length?{status:progress.status,nextRetryAt:progress.next_retry_at,readyPlans:progress.plans.filter(p=>p.status==='ready').length,
      pendingPlans:progress.plans.filter(p=>p.status==='pending'||p.status==='waiting').length,failedPlans:progress.plans.filter(p=>p.status==='failed').length,
      errors:progress.plans.flatMap(p=>p.error?[p.error]:[])}:undefined,
    counts:dailyCounts(papers,new Map(waiting.map(row=>[row.paper_id,row.error??''])))};
  return {papers,daily:{...snapshot,state:dailyState(snapshot,now)}};
}
