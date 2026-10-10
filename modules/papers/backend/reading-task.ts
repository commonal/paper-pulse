import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import type { PaperReadingTask, ReadingOptions, ReadingStage, ReadingStatus } from "../types.ts";
import {ensureCurrentVersion} from './versions.ts';
import {recordReadingTask,supersedeReadingRun} from './reading-history.ts';

export class ReadingSupersededError extends Error {
  constructor() { super("论文阅读任务已被新的任务替代"); }
}
export async function readingTask(paperId: string, db: Db = sql) {
  const [row] = await db<PaperReadingTask[]>`SELECT * FROM paper_reading_tasks WHERE paper_id=${paperId}`;
  return row ?? null;
}
export async function startReadingTask(paperId: string, stage: ReadingStage, options: ReadingOptions = {}, db: Db = sql):Promise<PaperReadingTask> {
  if(db===sql)return sql.begin(tx=>startReadingTask(paperId,stage,options,tx));
  const versionId=await ensureCurrentVersion(paperId,db);
  if(options.versionId&&options.versionId!==versionId)throw Object.assign(new Error('当前原文已改变，请刷新后再启动精读'),{code:'conflict'});
  const previous=await readingTask(paperId,db);
  if(previous)await supersedeReadingRun(previous,db);
  const [row] = await db<PaperReadingTask[]>`INSERT INTO paper_reading_tasks (paper_id,run_id,status,stage,options)
    VALUES (${paperId},${randomUUID()},'queued',${stage},${db.json({...options,versionId} as never)}) ON CONFLICT (paper_id) DO UPDATE SET
    run_id=EXCLUDED.run_id,status='queued',stage=EXCLUDED.stage,options=EXCLUDED.options,coverage=NULL,receipt_id=NULL,error=NULL,updated_at=now() RETURNING *`;
  await recordReadingTask(row!,'start',db,true);
  return row!;
}
export async function moveReadingTask(paperId: string, runId: string, stage: ReadingStage, status: ReadingStatus,
  extra: { receiptId?: number | null; error?: string | null; coverage?: Record<string, unknown>;action?:string } = {}, db: Db = sql):Promise<PaperReadingTask> {
  if(db===sql)return sql.begin(tx=>moveReadingTask(paperId,runId,stage,status,extra,tx));
  const [row] = await db<PaperReadingTask[]>`UPDATE paper_reading_tasks SET stage=${stage},status=${status},
    receipt_id=CASE WHEN ${extra.receiptId !== undefined} THEN ${extra.receiptId ?? null} ELSE receipt_id END,
    coverage=CASE WHEN ${extra.coverage !== undefined} THEN ${db.json((extra.coverage ?? {}) as never)} ELSE coverage END,
    error=${extra.error ?? null},updated_at=now() WHERE paper_id=${paperId} AND run_id=${runId} RETURNING *`;
  if (!row) throw new ReadingSupersededError();
  await recordReadingTask(row as PaperReadingTask,extra.action??'transition',db);
  return row as PaperReadingTask;
}
export async function assertReadingTask(paperId: string, runId: string, db: Db) {
  const [row] = await db`SELECT t.run_id,t.options->>'versionId' AS version_id,p.active_version_id FROM paper_reading_tasks t
    JOIN papers p ON p.id=t.paper_id WHERE t.paper_id=${paperId} FOR UPDATE OF p,t`;
  if (row?.run_id !== runId||(row?.version_id&&row.version_id!==row.active_version_id)) throw new ReadingSupersededError();
}
