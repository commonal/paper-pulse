import {createHash,randomUUID} from 'node:crypto';
import {sql} from '@aihot/backend/db';
import {defineQueue,type Scheduled} from '@aihot/backend/modules';
import {enqueueOn,getBoss} from '@aihot/backend/jobs/queue';
import {chatJson,MODELS,ModelOutputError,type ContentPart} from '@aihot/backend/providers/llm';
import {completeReceipt,rejectReceivedResponse} from '@aihot/backend/providers/receipts';
import {config} from '@aihot/backend/config';
import {paperTaskFailure,paperTaskWaits} from './task-errors.ts';
import {qualityJudgeSchema,compileQualityResult,QUALITY_RUBRIC_VERSION,qualityProfile,type QualityInput} from './quality-contract.ts';
import {renderFigureImages,figureImageMetadata} from './figure-images.ts';
import {summarizeReadingRuns,type ReadingRun,type ReadingEvent,type QualityEvaluationSummary} from '../evaluation.ts';
import {budgetAvailable} from './recovery.ts';
import {withTableRows} from './quality-sources.ts';

const conflict=(message:string)=>Object.assign(new Error(message),{code:'conflict'});
export async function resumeQualityEvaluation(id:string){
  return sql.begin(async db=>{
    const [row]=await db`SELECT id,status FROM paper_quality_evaluations WHERE id=${id} FOR UPDATE`;
    if(!row)throw conflict('评测不存在');
    if(['ready','running'].includes(row.status))return {id,status:row.status};
    await db`UPDATE paper_quality_evaluations SET status='queued',error=NULL,updated_at=now() WHERE id=${id}`;
    await enqueueOn(paperQualityQueue,{evaluationId:id},{singletonKey:id},db);
    return {id,status:'queued'};
  });
}
export async function enqueueQualityEvaluation(paperId:string,versionId?:string){
  // Freeze the reviewed article and source in a separate record. Never publish into paper_digests.
  const {detail}=await import('./store.ts');
  const {coveredMaterial,readingQuoteCatalog}=await import('./skill-reading.ts');
  const d=await detail(paperId,versionId);
  if(!d)throw conflict('论文不存在');
  if(d.digest?.status!=='ready'||d.material?.status!=='ready'||!d.viewing_version_id)throw conflict('需要已有可阅读解读、正文及原文版本才能评测');
  if(new Date(d.digest.material_updated_at??'').getTime()!==new Date(d.material.updated_at).getTime())throw conflict('解读与正文材料版本不一致，不能评分');
  const covered=coveredMaterial(d.material),claims=d.digest.sections.flatMap(s=>s.claims);
  const allowed=new Set(d.material.blocks.map(b=>b.id));
  const figures=d.illustrations??[];
  const figureBlocks=figures.map(i=>{const block=d.material!.blocks.find(b=>b.id===i.block_id);if(!block)throw conflict('图表的原文证据块缺失，不能评分');return {...block,bbox:i.bbox};});
  const input:QualityInput={paper:{id:paperId,title:d.paper.title,title_zh:d.paper.title_zh,summary_zh:d.paper.summary_zh,version:d.paper.version,pdf_sha256:d.paper.pdf_sha256},
    versionId:d.viewing_version_id,digest:d.digest,figures,figureBlocks,sources:withTableRows(readingQuoteCatalog(covered.blocks),covered.blocks),parser:d.material.parser,vision:!!MODELS.default.vision,
    hardChecks:{claims:claims.length,unknownEvidenceIds:[...new Set(claims.flatMap(c=>c.evidence_block_ids.filter(id=>!allowed.has(id))))],
      unreferencedDirectClaims:claims.filter(c=>c.support==='direct'&&!c.evidence_block_ids.length).map(c=>c.id),
      sourceBlocks:covered.blocks.length,sourceChars:covered.text.length,figures:figures.length,visualFigures:MODELS.default.vision?figureBlocks.length:0}};
  return enqueueQualitySnapshot(paperId,input);
}
export async function enqueueQualitySnapshot(paperId:string,input:QualityInput){
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return sql.begin(async db=>{
    const [row]=await db`INSERT INTO paper_quality_evaluations(id,paper_id,version_id,input_hash,rubric_version,input,status)
      VALUES(${randomUUID()},${paperId},${input.versionId},${hash},${QUALITY_RUBRIC_VERSION},${db.json(input as never)},'queued')
      ON CONFLICT(paper_id,version_id,input_hash,rubric_version) DO UPDATE SET input_hash=EXCLUDED.input_hash RETURNING id,status`;
    if(['queued','waiting','failed'].includes(row.status)){
      await db`UPDATE paper_quality_evaluations SET status='queued',error=NULL,updated_at=now() WHERE id=${row.id}`;
      await enqueueOn(paperQualityQueue,{evaluationId:row.id},{singletonKey:row.id},db);
    }
    return {id:row.id as string,status:['queued','waiting','failed'].includes(row.status)?'queued':row.status as string,reused:row.status==='ready'};
  });
}
export const paperQualityQueue=defineQueue<{evaluationId:string}>({name:'papers.quality',options:{policy:'short',retryLimit:2,retryDelay:60,retryBackoff:true,expireInSeconds:900},worker:{batchSize:1},async run(jobs){
  const results=[];
  for(const job of jobs){
    const [row]=await sql<{id:string;input:QualityInput;status:string;input_hash:string;rubric_version:string}[]>`SELECT id,input,status,input_hash,rubric_version FROM paper_quality_evaluations WHERE id=${job.evaluationId}`;
    if(!row||row.status==='ready'){results.push({id:job.evaluationId,status:row?.status??'missing'});continue;}
    await sql`UPDATE paper_quality_evaluations SET status='running',error=NULL,updated_at=now() WHERE id=${row.id}`;
    try{
      const input=row.input;
      const {system,numericAuditRequired}=qualityProfile(row.rubric_version);
      if(input.vision&&!MODELS.default.vision)throw conflict('评测冻结时启用了视觉，当前模型未声明视觉能力，请恢复配置后继续');
      let images:Awaited<ReturnType<typeof renderFigureImages>>=[];
      if(input.vision&&input.figureBlocks.length){
        const {versionPdf}=await import('./versions.ts');
        const pdf=await versionPdf(input.paper.id,input.versionId);
        if(!pdf?.pdf_data||pdf.pdf_sha256!==input.paper.pdf_sha256)throw conflict('评测绑定的原文版本不可用，不能换用当前PDF评分');
        images=await renderFigureImages(pdf.pdf_data,pdf.pdf_sha256,input.figureBlocks);
      }
      const {figureBlocks:_,calibration:__,...judgeInput}=input;
      const parts:ContentPart[]=[{type:'text',text:JSON.stringify({...judgeInput,rubricVersion:row.rubric_version,visual_assets:images.map(figureImageMetadata)})},
        ...images.flatMap(i=>[{type:'text' as const,text:`原图block_id=${i.blockId}，第${i.page}页。`},{type:'image_url' as const,image_url:{url:'data:image/png;base64,'+i.data.toString('base64')}}])];
      const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
      const [saved]=await sql`SELECT id,response,error FROM receipts WHERE purpose='paper_quality_evaluation' AND subject=${'paper-quality:'+row.id}
        AND status='failed' AND model=${MODELS.default.model} AND request->>'promptVersion'=${row.rubric_version}
        AND request->>'systemHash'=${hash(system)} AND request->>'userHash'=${hash(JSON.stringify(parts))}
        AND response->'choices'->0->>'finish_reason'='stop' ORDER BY id DESC LIMIT 1`;
      let recovered:{data:ReturnType<typeof qualityJudgeSchema.parse>;receiptId:number}|undefined;
      if(saved){
        try{
          const data=qualityJudgeSchema.parse(JSON.parse(saved.response.choices[0].message.content));
          compileQualityResult(data,input,MODELS.default.model,numericAuditRequired);
          recovered={data,receiptId:saved.id as number};
        }catch{/* Unknown, incomplete or mismatched source answers must not be published. */}
      }
      const reply=recovered??await chatJson({model:'default',purpose:'paper_quality_evaluation',subject:'paper-quality:'+row.id,promptVersion:row.rubric_version,
        system,user:parts,schema:qualityJudgeSchema,temperature:0,maxTokens:18000,timeoutMs:180000});
      let result;
      try{result=compileQualityResult(reply.data,input,MODELS.default.model,numericAuditRequired);}
      catch(error){await rejectReceivedResponse(reply.receiptId,String(error));throw new ModelOutputError(String(error),reply.receiptId);}
      await sql.begin(async db=>{
        await db`UPDATE paper_quality_evaluations SET status='ready',result=${db.json(result as never)},model=${MODELS.default.model},receipt_id=${reply.receiptId},error=NULL,updated_at=now() WHERE id=${row.id} AND input_hash=${row.input_hash}`;
        await completeReceipt(db,reply.receiptId,{paperQuality:{evaluationId:row.id,inputHash:row.input_hash,rubricVersion:row.rubric_version,versionId:input.versionId,images:images.map(figureImageMetadata),referenceRepairs:result.referenceRepairs,numericFormatRepairs:result.numericFormatRepairs,calibration:result.calibration},
          ...(recovered?{paperQualityRecovery:{previousError:saved.error,rawResponsePreserved:true}}:{})});
      });
      results.push({id:row.id,status:'ready'});
    }catch(error){
      const failure=paperTaskFailure(error),waiting=paperTaskWaits(error)||!config.modelCallsEnabled;
      await sql`UPDATE paper_quality_evaluations SET status=${waiting?'waiting':'failed'},error=${failure.error},receipt_id=COALESCE(${failure.receipt_id},receipt_id),updated_at=now() WHERE id=${row.id}`;
      results.push({id:row.id,status:waiting?'waiting':'failed'});
    }
  }
  return results;
}});
export async function recoverQualityEvaluations(){
  await getBoss();
  await sql`UPDATE paper_quality_evaluations e SET status='waiting',error='评测执行中断，等待恢复。',updated_at=now()
    WHERE status='running' AND updated_at<now()-interval '10 minutes' AND NOT EXISTS
    (SELECT 1 FROM pgboss.job j WHERE j.name='papers.quality' AND j.data->>'evaluationId'=e.id::text AND j.state IN ('created','retry','active'))`;
  if(!config.modelCallsEnabled||!await budgetAvailable('llm'))return 0;
  const rows=await sql`SELECT e.id FROM paper_quality_evaluations e LEFT JOIN receipts r ON r.id=e.receipt_id
    WHERE e.status IN ('queued','waiting') AND (e.receipt_id IS NULL OR r.status IN ('failed','received','completed'))
    AND NOT EXISTS(SELECT 1 FROM pgboss.job j WHERE j.name='papers.quality' AND j.data->>'evaluationId'=e.id::text AND j.state IN ('created','retry','active')) LIMIT 10`;
  for(const row of rows)await enqueueOn(paperQualityQueue,{evaluationId:row.id},{singletonKey:row.id});
  return rows.length;
}
export const paperQualityRecoverySchedule:Scheduled={name:'papers.quality-recovery',cron:'*/5 * * * *',missed:'skip',run:recoverQualityEvaluations};
export async function evaluationDashboard(days=30){
  const [runs,events,legacy,quality,papers,requests]=await Promise.all([
    sql<ReadingRun[]>`SELECT r.*,p.title FROM paper_reading_runs r JOIN papers p ON p.id=r.paper_id WHERE r.started_at>now()-${days}*interval '1 day' ORDER BY r.started_at DESC`,
    sql<ReadingEvent[]>`SELECT e.id,e.run_id,e.stage,e.status,e.action,e.error,e.receipt_id,e.recorded_at FROM paper_reading_events e JOIN paper_reading_runs r USING(run_id) WHERE r.started_at>now()-${days}*interval '1 day' ORDER BY e.id`,
    sql`SELECT t.*,p.title FROM paper_reading_tasks t JOIN papers p ON p.id=t.paper_id WHERE NOT EXISTS(SELECT 1 FROM paper_reading_runs r WHERE r.run_id=t.run_id) ORDER BY t.updated_at DESC`,
    sql<QualityEvaluationSummary[]>`SELECT e.id,e.paper_id,e.version_id,p.title,e.status,e.model,e.receipt_id,e.error,e.created_at,e.updated_at,e.input_hash,e.rubric_version,e.result,
      e.input->'digest'->'sections' AS assessed_sections,(e.input->'digest'->>'receipt_id')::bigint AS digest_receipt_id,e.input->'calibration'->>'label' AS calibration_label FROM paper_quality_evaluations e JOIN papers p ON p.id=e.paper_id ORDER BY e.created_at DESC LIMIT 100`,
    sql`SELECT p.id,p.title,p.active_version_id FROM papers p JOIN paper_digests d ON d.paper_id=p.id JOIN paper_materials m ON m.paper_id=p.id WHERE d.status='ready' AND m.status='ready' ORDER BY d.updated_at DESC LIMIT 100`,
    sql`SELECT r.purpose,a.status,count(*)::int AS n FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE a.origin='live' AND a.started_at>now()-${days}*interval '1 day' AND r.subject LIKE 'paper:%' GROUP BY r.purpose,a.status ORDER BY r.purpose,a.status`,
  ]);
  return {generatedAt:new Date().toISOString(),days,metrics:summarizeReadingRuns(runs,events),runs,events,legacy:[...legacy],quality,papers:[...papers],requests:[...requests]};
}
