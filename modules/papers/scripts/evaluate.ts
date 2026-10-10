import {parseArgs} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {MODELS} from '@aihot/backend/providers/llm';
import {evaluationDashboard,enqueueQualityEvaluation} from '../backend/quality-evaluation.ts';
import {enqueuePaperDigest} from '../backend/queue.ts';
import {readingTask} from '../backend/reading-task.ts';
import {PAPER_SKILL_VERSION} from '../backend/skill-reading.ts';
import {summarizeReadingRuns,type ReadingRun,type ReadingEvent} from '../evaluation.ts';

const {values}=parseArgs({options:{report:{type:'boolean'},quality:{type:'string'},prepare:{type:'string'},start:{type:'string'},manifest:{type:'string'},status:{type:'boolean'},out:{type:'string'}}});
interface Sample {paperId:string;title:string;versionId:string;pdfSha256:string|null;materialHash:string;digestHash:string;sampleId:string;runId?:string;startedAt?:string}
interface Manifest {id:string;createdAt:string;model:string;vision:boolean;skillVersion:string;scope:string;samples:Sample[];notes:{id:string;revision:number;hash:string}[]}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function save(file:string,data:unknown,exclusive=false){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(data,null,2),exclusive?{flag:'wx'}:undefined);}
try{
  if(values.prepare){
    const ids=z.array(z.uuid()).min(1).max(3).parse(values.prepare.split(','));if(new Set(ids).size!==ids.length)throw new Error('样本重复');
    const manifest:Manifest={id:randomUUID(),createdAt:new Date().toISOString(),model:MODELS.default.model,vision:!!MODELS.default.vision,skillVersion:PAPER_SKILL_VERSION,
      scope:'已解析正文复用，覆盖检查→全新Skill精读→全新原文核查→重新选图→视觉解释与核查；不是PDF冷启动解析测试。',samples:[],notes:[]};
    for(const id of ids){
      const [p]=await sql`SELECT p.id,p.title,p.active_version_id,p.pdf_sha256,m.blocks,m.status,d.sections,d.status AS digest_status FROM papers p JOIN paper_materials m ON m.paper_id=p.id JOIN paper_digests d ON d.paper_id=p.id WHERE p.id=${id}`;
      const task=await readingTask(id);if(!p||p.status!=='ready'||p.digest_status!=='ready'||!p.active_version_id)throw new Error('样本没有完整正文、解读或版本');
      if(task&&['queued','running','waiting'].includes(task.status))throw new Error('样本仍有未完成任务，不能重跑覆盖');
      manifest.samples.push({paperId:id,title:p.title,versionId:p.active_version_id,pdfSha256:p.pdf_sha256,materialHash:hash(p.blocks),digestHash:hash(p.sections),sampleId:randomUUID()});
    }
    manifest.notes=[...await sql<Manifest['notes']>`SELECT id,revision,md5(markdown) AS hash FROM paper_notes WHERE paper_id=ANY(${ids}) ORDER BY id`];
    const file=values.out??path.join('.data/eval/reading-benchmark',manifest.id,'manifest.json');await save(file,manifest,true);console.log(JSON.stringify({manifest:file,samples:manifest.samples.map(s=>({title:s.title,paperId:s.paperId}))}));
  }else if(values.start!==undefined){
    if(!values.manifest)throw new Error('需要 --manifest');
    const manifest=JSON.parse(await readFile(values.manifest,'utf8')) as Manifest;
    const index=z.coerce.number().int().min(0).max(manifest.samples.length-1).parse(values.start),s=manifest.samples[index]!;
    if(s.runId)throw new Error('样本已启动，请读取原run_id，不能以重跑替代首次结果');
    if(manifest.model!==MODELS.default.model||manifest.vision!==!!MODELS.default.vision||manifest.skillVersion!==PAPER_SKILL_VERSION)throw new Error('模型或Skill配置与冻结批次不一致');
    const task=await readingTask(s.paperId);if(task&&['queued','running','waiting'].includes(task.status))throw new Error('样本已有未完成任务');
    const [p]=await sql`SELECT p.active_version_id,p.pdf_sha256,m.blocks FROM papers p JOIN paper_materials m ON m.paper_id=p.id WHERE p.id=${s.paperId}`;
    if(p?.active_version_id!==s.versionId||p.pdf_sha256!==s.pdfSha256||hash(p.blocks)!==s.materialHash)throw new Error('冻结的原文或材料已改变');
    await enqueuePaperDigest(s.paperId,{versionId:s.versionId,reread:true,evaluationSampleId:s.sampleId});
    s.runId=(await readingTask(s.paperId))!.run_id;s.startedAt=new Date().toISOString();await save(values.manifest,manifest);
    console.log(JSON.stringify({paperId:s.paperId,runId:s.runId,scope:manifest.scope}));
  }else if(values.status){
    if(!values.manifest)throw new Error('需要 --manifest');
    const manifest=JSON.parse(await readFile(values.manifest,'utf8')) as Manifest,ids=manifest.samples.flatMap(s=>s.runId?[s.runId]:[]);
    const runs=await sql<ReadingRun[]>`SELECT r.*,p.title FROM paper_reading_runs r JOIN papers p ON p.id=r.paper_id WHERE r.run_id=ANY(${ids}) ORDER BY r.started_at`;
    const events=await sql<ReadingEvent[]>`SELECT * FROM paper_reading_events WHERE run_id=ANY(${ids}) ORDER BY id`;
    const notes=await sql<Manifest['notes']>`SELECT id,revision,md5(markdown) AS hash FROM paper_notes WHERE id=ANY(${manifest.notes.map(n=>n.id)}) ORDER BY id`;
    const report={manifest,generatedAt:new Date().toISOString(),metrics:summarizeReadingRuns(runs,events),runs:[...runs],events:[...events],notesPreserved:JSON.stringify([...notes])===JSON.stringify(manifest.notes)};
    if(values.out)await save(values.out,report);console.log(JSON.stringify({metrics:report.metrics,runs:runs.map(r=>({title:r.title,runId:r.run_id,status:r.status,stage:r.stage,error:r.error})),notesPreserved:report.notesPreserved}));
  }else if(values.quality){console.log(JSON.stringify(await enqueueQualityEvaluation(z.uuid().parse(values.quality))));}
  else if(values.report){const report=await evaluationDashboard();const file=values.out??'.data/eval/paper-quality/report.json';await save(file,report);console.log(JSON.stringify({report:file,metrics:report.metrics,quality:report.quality.map(q=>({title:q.title,status:q.status,id:q.id}))}));}
  else throw new Error('使用 --report、--quality <论文ID>、--prepare <1–3个论文ID>，或 --manifest <路径> --start <0–2>/--status');
}finally{await stopBoss();await closeDb();}
