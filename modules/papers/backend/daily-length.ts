import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {sql} from '@aihot/backend/db';
import {DAILY_MAX_PDF_PAGES,readingDate} from '../daily.ts';
import {ensureArxivPdf,MAX_PDF_BYTES,DailyPdfTooLargeError} from './material.ts';
import {assertReadingTask,moveReadingTask} from './reading-task.ts';

/** The inspection is local and keyed by the actual file, never by a mutable paper title or version label. */
export async function inspectPdfPages(pdf:Buffer){
  const hash=createHash('sha256').update(pdf).digest('hex');
  const [cached]=await sql<{page_count:number;inspected_at:Date}[]>`SELECT page_count,inspected_at FROM paper_pdf_inspections WHERE pdf_sha256=${hash}`;
  if(cached)return {hash,pages:cached.page_count,inspectedAt:cached.inspected_at.toISOString()};
  const worker=new Worker(new URL('./pdf-pages-worker.ts',import.meta.url),{workerData:new Uint8Array(pdf),resourceLimits:{maxOldGenerationSizeMb:128}});
  const pages=await new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('原文 PDF 页数检查超时'));},15000);
    const done=()=>clearTimeout(timer);
    worker.once('message',message=>{done();if(message.error)reject(new Error(message.error));else if(!Number.isInteger(message.pages)||message.pages<1)reject(new Error('原文 PDF 页数无效'));else resolve(message.pages);});
    worker.once('error',error=>{done();reject(error);});
    worker.once('exit',code=>{done();if(code!==0)reject(new Error('原文 PDF 页数检查进程失败'));});
  });
  const [saved]=await sql<{inspected_at:Date}[]>`INSERT INTO paper_pdf_inspections(pdf_sha256,page_count) VALUES(${hash},${pages}) ON CONFLICT(pdf_sha256) DO UPDATE SET page_count=EXCLUDED.page_count RETURNING inspected_at`;
  return {hash,pages,inspectedAt:saved!.inspected_at.toISOString()};
}
export async function inspectDailyPaper(paper:{id:string;source_url:string}){
  const pdf=await ensureArxivPdf(paper,true);
  // Automatic discovery uses arXiv PDFs. An unavailable PDF must not bypass the page gate through HTML.
  if(!pdf)throw new Error('自动日更需要先取得原文 PDF 并检查页数，尚未调用付费解析');
  if(pdf.length>MAX_PDF_BYTES)throw new DailyPdfTooLargeError();
  return inspectPdfPages(pdf);
}
/** Remove only the daily assignment; keep the PDF, material, notes and execution history. */
export async function excludeLongDailyPaper(paperId:string,inspection:{hash:string;pages:number;inspectedAt:string},now=new Date(),runId?:string){
  if(inspection.pages<=DAILY_MAX_PDF_PAGES)return false;
  const date=readingDate(now),reason=`原文共 ${inspection.pages} 页，超过自动日更 ${DAILY_MAX_PDF_PAGES} 页上限（含附录），已跳过并补选。`;
  const removed=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${'paper-daily-queue:'+date}))`;
    if(runId)await assertReadingTask(paperId,runId,tx);
    const rows=await tx`DELETE FROM paper_daily_queue q USING papers p WHERE q.paper_id=p.id AND q.paper_id=${paperId} AND q.queue_date=${date}::date AND p.pdf_sha256=${inspection.hash} RETURNING q.paper_id`;
    if(!rows.length)return false;
    await tx`INSERT INTO paper_daily_exclusions(queue_date,paper_id,pdf_sha256,reason) VALUES(${date}::date,${paperId},${inspection.hash},${reason}) ON CONFLICT DO NOTHING`;
    await tx`UPDATE paper_candidates SET selected_date=NULL WHERE paper_id=${paperId} AND selected_date=${date}::date`;
    if(runId)await moveReadingTask(paperId,runId,'material','unavailable',{action:'exclude_length',error:reason,coverage:{pdf_pages:inspection.pages,pdf_inspected_at:inspection.inspectedAt,daily_max_pdf_pages:DAILY_MAX_PDF_PAGES}},tx);
    return true;
  });
  if(removed)await (await import('./discovery.ts')).selectToday(now);
  return removed;
}

export async function excludeOversizedDailyPdf(paperId:string,runId:string,reason:string,now=new Date()){
  const date=readingDate(now);
  await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${'paper-daily-queue:'+date}))`;
    await assertReadingTask(paperId,runId,tx);
    await moveReadingTask(paperId,runId,'material','unavailable',{action:'exclude_pdf',error:'自动日更跳过：'+reason},tx);
    await tx`DELETE FROM paper_daily_queue WHERE paper_id=${paperId} AND queue_date=${date}::date`;
    await tx`UPDATE paper_candidates SET selected_date=NULL WHERE paper_id=${paperId} AND selected_date=${date}::date`;
  });
  return (await import('./discovery.ts')).selectToday(now);
}
