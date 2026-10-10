import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { sql, type Db } from "@aihot/backend/db";
import { ModelOutputError,MODELS } from "@aihot/backend/providers/llm";
import { config } from "@aihot/backend/config";
import { ProviderRejectedError } from "@aihot/backend/providers/receipts";
import { paperById } from "./store.ts";
import { materialByPaperId, parsePaperMaterial,DailyPdfTooLargeError } from "./material.ts";
import { digestByPaperId } from "./digest.ts";
import { generateSkillReading } from "./skill-reading.ts";
import { generatePaperIllustrations, illustrationState } from "./illustrations.ts";
import { illustrationSignature, ILLUSTRATION_VERSION,VISUAL_ILLUSTRATION_VERSION } from "./illustration-plan.ts";
import { readingTask, startReadingTask, moveReadingTask, ReadingSupersededError } from "./reading-task.ts";
import { paperTaskFailure, paperTaskWaits } from "./task-errors.ts";
import type { ReadingOptions, ReadingStage } from "../types.ts";
import {ensureCurrentVersion} from './versions.ts';
import {inspectDailyPaper,excludeLongDailyPaper,excludeOversizedDailyPdf} from './daily-length.ts';
import {DAILY_MAX_PDF_PAGES} from '../daily.ts';

type PaperTask = { paperId: string; runId?: string };
async function taskFor(job: PaperTask, stage: ReadingStage) {
  const task = await readingTask(job.paperId);
  if (job.runId && task?.run_id !== job.runId) throw new ReadingSupersededError();
  return task ?? await startReadingTask(job.paperId, stage);
}
async function taskFailed(job: PaperTask, runId: string, error: unknown) {
  if (error instanceof ReadingSupersededError) return { paperId: job.paperId, status: "superseded" };
  const task = await readingTask(job.paperId);
  if (task?.run_id !== runId) return { paperId: job.paperId, status: "superseded" };
  const failure = paperTaskFailure(error);
  if(!config.modelCallsEnabled && ["reading","review","illustrations"].includes(task.stage)) {
    await moveReadingTask(job.paperId,runId,task.stage,"waiting",{error:"模型调用未启用，等待服务配置恢复。"});
    return {paperId:job.paperId,status:"waiting"};
  }
  await moveReadingTask(job.paperId, runId, task.stage, paperTaskWaits(error) ? "waiting" : "failed",
    { error: failure.error, ...(failure.receipt_id ? { receiptId: failure.receipt_id } : {}) });
  if (paperTaskWaits(error)) return { paperId: job.paperId, status: "waiting", ...failure };
  if (error instanceof ModelOutputError || (error instanceof ProviderRejectedError && !error.retryable)
    || (error as {code?:string})?.code==='conflict' || task.stage === "coverage") return { paperId: job.paperId, status: "failed", ...failure };
  throw error;
}

export const paperMaterialQueue = defineQueue<PaperTask>({
  name: "papers.material", options: { policy: "short", retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 },
  worker: { batchSize: 1 }, async run(jobs) {
    const results = [];
    for (const job of jobs) {
      const paper = await paperById(job.paperId);
      if (!paper) { results.push({ paperId: job.paperId, status: "missing" }); continue; }
      let task;
      try { task = await taskFor(job, "material"); }
      catch (error) { if (error instanceof ReadingSupersededError) { results.push({paperId:job.paperId,status:"superseded"}); continue; } throw error; }
      try {
        if (task.status === "ready" && task.stage === "complete") { results.push({paperId:job.paperId,status:"ready"}); continue; }
        await moveReadingTask(job.paperId, task.run_id, "material", "running");
        if(task.options.daily){
          let inspection;
          try{inspection=await inspectDailyPaper(paper);}catch(error){
            if(!(error instanceof DailyPdfTooLargeError))throw error;
            await excludeOversizedDailyPdf(job.paperId,task.run_id,error.message);
            results.push({paperId:job.paperId,status:'excluded_pdf_size'});continue;
          }
          if(inspection.pages>DAILY_MAX_PDF_PAGES){
            if(!await excludeLongDailyPaper(job.paperId,inspection,new Date(),task.run_id))
              await moveReadingTask(job.paperId,task.run_id,'material','unavailable',{action:'exclude_length',error:`原文 ${inspection.pages} 页，超过自动日更 ${DAILY_MAX_PDF_PAGES} 页上限（含附录）。`});
            results.push({paperId:job.paperId,status:'excluded_length',pages:inspection.pages});continue;
          }
        }
        let material = await materialByPaperId(job.paperId);
        if (material?.status !== "ready") material = await parsePaperMaterial(paper);
        if (material.status === "ready") {
          await moveReadingTask(job.paperId, task.run_id, "coverage", "queued");
          await enqueueOn(paperDigestQueue, { paperId: job.paperId, runId: task.run_id }, { singletonKey: job.paperId });
          results.push({ paperId: job.paperId, status: "digest_queued" });
        } else {
          await moveReadingTask(job.paperId, task.run_id, "material", material.status === "failed" ? "failed" : "unavailable", {error:material.error});
          results.push({ paperId: job.paperId, status: material.status });
        }
      } catch (error) { results.push(await taskFailed(job, task.run_id, error)); }
    }
    return results;
  },
});

export const paperDigestQueue = defineQueue<PaperTask>({
  name: "papers.digest", options: { policy: "short", retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 },
  worker: { batchSize: 1 }, async run(jobs) {
    const results = [];
    for (const job of jobs) {
      const paper = await paperById(job.paperId);
      if (!paper) { results.push({paperId:job.paperId,status:"missing"}); continue; }
      let task;
      try { task = await taskFor(job, "coverage"); }
      catch (error) { if (error instanceof ReadingSupersededError) { results.push({paperId:job.paperId,status:"superseded"}); continue; } throw error; }
      try {
        if (task.status === "ready" && task.stage === "complete") { results.push({paperId:job.paperId,status:"ready"}); continue; }
        const [material, previous] = await Promise.all([materialByPaperId(job.paperId), digestByPaperId(job.paperId)]);
        if (material?.status !== "ready") {
          await moveReadingTask(job.paperId, task.run_id, "material", "queued");
          await enqueueOn(paperMaterialQueue, { paperId:job.paperId, runId:task.run_id }, {singletonKey:job.paperId});
          results.push({paperId:job.paperId,status:"material_queued"}); continue;
        }
        const currentDigest = previous?.status === "ready" && previous.material_updated_at
          && new Date(previous.material_updated_at).getTime() === new Date(material.updated_at).getTime();
        if(task.options.reviewRepair){
          await (await import('./review-repair.ts')).repairFailedReading(job.paperId,task.run_id,task.options.reviewRepair);
        }else if (!currentDigest || task.options.reread || !paper.title_zh) {
          await generateSkillReading(job.paperId, task.options.visualNotes, task.options.reviewCorrections, task.run_id);
        } else {
          await moveReadingTask(job.paperId, task.run_id, "illustrations", "queued", {
            coverage: { cached_digest:true, prompt_version:previous.prompt_version, parser:material.parser }, receiptId:previous.receipt_id });
        }
        if (!await enqueuePaperIllustrations(job.paperId, task.run_id)) await moveReadingTask(job.paperId, task.run_id, "complete", "ready");
        results.push({paperId:job.paperId,status:"ready"});
      } catch (error) { results.push(await taskFailed(job, task.run_id, error)); }
    }
    return results;
  },
});

export const paperIllustrationQueue = defineQueue<PaperTask>({
  name: "papers.illustrations", options: { policy: "short", retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 },
  worker: { batchSize:1 }, async run(jobs) {
    const results=[];
    for (const job of jobs) {
      if (!await paperById(job.paperId)) { results.push({paperId:job.paperId,status:"missing"}); continue; }
      let task;
      try { task = await taskFor(job, "illustrations"); }
      catch (error) { if(error instanceof ReadingSupersededError){results.push({paperId:job.paperId,status:"superseded"});continue;}throw error; }
      try {
        if (task.status === "ready" && task.stage === "complete") { results.push({paperId:job.paperId,status:"ready"}); continue; }
        await moveReadingTask(job.paperId, task.run_id, "illustrations", "running");
        const state=await generatePaperIllustrations(job.paperId, task.run_id);
        if(!state){
          await moveReadingTask(job.paperId,task.run_id,"coverage","queued");
          await enqueueOn(paperDigestQueue,{paperId:job.paperId,runId:task.run_id},{singletonKey:job.paperId});
          results.push({paperId:job.paperId,status:"digest_queued"});continue;
        }
        await moveReadingTask(job.paperId, task.run_id, "complete", "ready", {receiptId:state?.receipt_id});
        results.push({paperId:job.paperId,status:state?.status??"unavailable"});
      } catch(error){results.push(await taskFailed(job,task.run_id,error));}
    }
    return results;
  },
});

export async function enqueuePaperMaterial(paperId: string, tx?: Db,versionId?:string,daily=false) {
  const db=tx??sql;
  const task=await startReadingTask(paperId,"material",{versionId,...(daily?{daily:true}:{})},db);
  await db`UPDATE paper_materials SET status='queued',error=NULL,updated_at=now() WHERE paper_id=${paperId} AND status<>'ready'`;
  return Boolean(await enqueueOn(paperMaterialQueue,{paperId,runId:task.run_id},{singletonKey:paperId},tx));
}
export async function enqueuePaperDigest(paperId: string, options: ReadingOptions = {}) {
  const task=await startReadingTask(paperId,"coverage",options);
  return Boolean(await enqueueOn(paperDigestQueue,{paperId,runId:task.run_id},{singletonKey:paperId}));
}
export async function resumeReadingTask(paperId: string,tx?:Db,versionId?:string,automatic=false):Promise<boolean> {
  if(!tx)return sql.begin(db=>resumeReadingTask(paperId,db,versionId,automatic));
  const current=await ensureCurrentVersion(paperId,tx);
  if(versionId&&versionId!==current)throw Object.assign(new Error('当前原文已改变，请刷新后再恢复精读'),{code:'conflict'});
  const task=await readingTask(paperId,tx);
  if(!task)return false;
  await moveReadingTask(paperId,task.run_id,task.stage,"queued",{action:automatic?'resume_auto':'resume_manual'},tx);
  const queue=task.stage==="material"?paperMaterialQueue:task.stage==="illustrations"?paperIllustrationQueue:paperDigestQueue;
  return Boolean(await enqueueOn(queue,{paperId,runId:task.run_id},{singletonKey:paperId},tx));
}
export async function enqueuePaperIllustrations(paperId: string, runId?: string,versionId?:string) {
  const [paper,material,digest,previous]=await Promise.all([paperById(paperId),materialByPaperId(paperId),digestByPaperId(paperId),illustrationState(paperId)]);
  if(!paper||!material||digest?.status!=="ready")return false;
  if(versionId&&paper.active_version_id!==versionId)throw Object.assign(new Error('当前原文已改变，请刷新后再处理图表'),{code:'conflict'});
  const signature=illustrationSignature(paper,material,digest);
  const targetVersion=MODELS.default.vision?VISUAL_ILLUSTRATION_VERSION:ILLUSTRATION_VERSION;
  const sampleId=runId?(await readingTask(paperId))?.options.evaluationSampleId:undefined;
  if(!sampleId && previous && ["ready","unavailable"].includes(previous.status) && previous.input_signature===signature && previous.prompt_version===targetVersion)return false;
  const task=runId?await moveReadingTask(paperId,runId,"illustrations","queued"):await startReadingTask(paperId,"illustrations",{versionId});
  await sql`INSERT INTO paper_illustrations (paper_id,status,input_signature) VALUES (${paperId},'queued',${signature})
    ON CONFLICT (paper_id) DO UPDATE SET status='queued',
    selections=CASE WHEN paper_illustrations.input_signature=EXCLUDED.input_signature THEN paper_illustrations.selections ELSE '[]'::jsonb END,
    input_signature=EXCLUDED.input_signature,error=NULL,updated_at=now()`;
  await enqueueOn(paperIllustrationQueue,{paperId,runId:task.run_id},{singletonKey:paperId});
  return true;
}
