import {sql,type Db} from '@aihot/backend/db';
import type {PaperReadingTask} from '../types.ts';

export async function recordReadingTask(task:PaperReadingTask,action:string,db:Db,initialObserved=false){
  await db`INSERT INTO paper_reading_runs(run_id,paper_id,version_id,kind,initial_observed,status,stage,cached_digest,error,receipt_id)
    VALUES(${task.run_id},${task.paper_id},${task.options.versionId??null},${task.stage==='illustrations'&&action==='start'?'illustrations':'full'},${initialObserved},${task.status},${task.stage},${task.coverage?.cached_digest===true},${task.error},${task.receipt_id})
    ON CONFLICT(run_id) DO UPDATE SET status=EXCLUDED.status,stage=EXCLUDED.stage,
    cached_digest=paper_reading_runs.cached_digest OR EXCLUDED.cached_digest,error=EXCLUDED.error,receipt_id=EXCLUDED.receipt_id,updated_at=now(),
    finished_at=CASE WHEN EXCLUDED.status IN ('ready','failed','unavailable') THEN now() ELSE NULL END`;
  await db`INSERT INTO paper_reading_events(run_id,stage,status,action,error,receipt_id)
    VALUES(${task.run_id},${task.stage},${task.status},${action},${task.error},${task.receipt_id})`;
}
export async function supersedeReadingRun(task:PaperReadingTask,db:Db){
  await recordReadingTask(task,'snapshot_before_replace',db);
  if(task.status==='ready')return;
  await db`UPDATE paper_reading_runs SET status='superseded',finished_at=now(),updated_at=now() WHERE run_id=${task.run_id}`;
  await db`INSERT INTO paper_reading_events(run_id,stage,status,action) VALUES(${task.run_id},${task.stage},'superseded','replace')`;
}
export async function readingHistory(paperId:string,db:Db=sql){
  return db`SELECT e.* FROM paper_reading_events e JOIN paper_reading_runs r USING(run_id) WHERE r.paper_id=${paperId} ORDER BY e.id`;
}
