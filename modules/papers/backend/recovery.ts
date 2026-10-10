import { sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { getBoss } from "@aihot/backend/jobs/queue";
import type { Scheduled } from "@aihot/backend/modules";
import { resumeReadingTask } from "./queue.ts";
import {recordReadingTask} from './reading-history.ts';
import type {PaperReadingTask} from '../types.ts';

export async function budgetAvailable(service: string) {
  const [row] = await sql`SELECT b.per_minute,b.per_hour,b.per_day,
    count(a.id) FILTER (WHERE a.started_at>now()-interval '1 minute')::int AS minute,
    count(a.id) FILTER (WHERE a.started_at>now()-interval '1 hour')::int AS hour,count(a.id)::int AS day
    FROM budgets b LEFT JOIN receipt_attempts a ON a.service=b.service AND a.origin='live' AND a.started_at>now()-interval '1 day'
    WHERE b.service=${service} GROUP BY b.service`;
  return row ? row.per_minute>row.minute && row.per_hour>row.hour && row.per_day>row.day : service!=="mineru";
}

/** Resume the persisted phase and options, never discover or parse unselected candidates here. */
export async function recoverPaperTasks() {
  await getBoss();
  await sql.begin(async db=>{
  const interrupted=await db<PaperReadingTask[]>`UPDATE paper_reading_tasks t SET status='waiting',error='任务执行中断，等待恢复。',updated_at=now()
    WHERE t.status='running' AND t.updated_at<now()-interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM pgboss.job j WHERE j.data->>'paperId'=t.paper_id::text
        AND j.name=CASE WHEN t.stage='material' THEN 'papers.material' WHEN t.stage='illustrations' THEN 'papers.illustrations' ELSE 'papers.digest' END
        AND j.state IN ('created','retry','active')) RETURNING t.*`;
  for(const task of interrupted)await recordReadingTask(task,'interrupted',db);
  });
  const rows = await sql`SELECT t.paper_id,t.stage,m.status AS material_status,d.status AS digest_status,i.status AS illustration_status
    FROM paper_reading_tasks t LEFT JOIN receipts r ON r.id=t.receipt_id
    LEFT JOIN paper_materials m USING (paper_id) LEFT JOIN paper_digests d USING (paper_id) LEFT JOIN paper_illustrations i USING (paper_id)
    WHERE t.status IN ('queued','waiting') AND (t.receipt_id IS NULL OR r.status IN ('failed','received','completed'))
      AND NOT EXISTS (SELECT 1 FROM pgboss.job j WHERE j.data->>'paperId'=t.paper_id::text
        AND j.name=CASE WHEN t.stage='material' THEN 'papers.material' WHEN t.stage='illustrations' THEN 'papers.illustrations' ELSE 'papers.digest' END
        AND j.state IN ('created','retry','active')) ORDER BY t.updated_at LIMIT 20`;
  const llmAvailable=config.modelCallsEnabled && await budgetAvailable("llm");
  const mineruAvailable=await budgetAvailable("mineru");
  const result={materials:0,digests:0,illustrations:0};
  for (const row of rows) {
    if (row.stage==="material") {
      if(row.material_status!=="ready" && process.env.MINERU_CALLS_ENABLED==="true" && !mineruAvailable)continue;
      if(await resumeReadingTask(row.paper_id,undefined,undefined,true))result.materials+=1;
    } else if(row.stage==="illustrations") {
      if(!llmAvailable && !["ready","unavailable"].includes(row.illustration_status))continue;
      if(await resumeReadingTask(row.paper_id,undefined,undefined,true))result.illustrations+=1;
    } else if(llmAvailable && await resumeReadingTask(row.paper_id,undefined,undefined,true))result.digests+=1;
  }
  return result;
}
export const paperRecoverySchedule: Scheduled = { name:"papers.recovery",cron:"*/5 * * * *",missed:"skip",run:recoverPaperTasks };
