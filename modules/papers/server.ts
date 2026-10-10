import { z } from "zod";
import { defineServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import { adminHandler } from "../../apps/api/src/routes/admin-auth.ts";
import { createPaper, detail, listPapers, pdfById } from "./backend/store.ts";
import {addNote,editNote,noteById} from './backend/notes.ts';
import { enqueuePaperDigest, enqueuePaperMaterial, enqueuePaperIllustrations, paperDigestQueue, paperMaterialQueue, paperIllustrationQueue } from "./backend/queue.ts";
import { discoverySettings, listDiscoveryPlans, paperDiscoverySchedule, paperDiscoveryRecoverySchedule, paperTrends, recentCandidates, updateDiscoveryPlan, updateDiscoverySettings } from "./backend/discovery.ts";
import {todayReading} from './backend/daily-status.ts';
import { paperImpactResults, paperImpactSchedule,startImpactReading,paperImpactQueue,refreshPaperImpact } from "./backend/impact.ts";
import { paperRecoverySchedule } from "./backend/recovery.ts";
import { resumeReadingTask } from "./backend/queue.ts";
import {HOT_DIRECTION,directionFor,type PlanPreferences,type DiscoveryPlan} from './directions.ts';
import {previewDirections} from './backend/preview.ts';
import {CANDIDATE_DIRECTIONS,type CandidateFilters} from './candidates.ts';
import {collectPaper,removeCollection} from './backend/collection.ts';
import {identifyImport,getImportPreview,enqueueIdentityOcr,paperIdentityQueue,paperIdentityRecoverySchedule} from './backend/identity.ts';
import {addPaperVersion,selectPaperVersion,versionPdf} from './backend/versions.ts';
import {enqueueReviewRepair} from './backend/review-repair.ts';
import {evaluationDashboard,enqueueQualityEvaluation,paperQualityQueue,paperQualityRecoverySchedule,resumeQualityEvaluation} from './backend/quality-evaluation.ts';

const preferencesSchema=z.object({mode:z.enum(['preset','custom']),topicIds:z.array(z.string()).max(3),priority:z.boolean(),precision:z.enum(['precise','broad']),
  extraKeywords:z.array(z.string().trim().min(1).max(60)).max(10),excludedKeywords:z.array(z.string().trim().min(1).max(60)).max(10)});
const planPatchSchema=z.object({enabled:z.boolean().optional(),categories:z.array(z.string().regex(/^[a-z-]+\.[A-Z0-9]{2,4}$/)).min(1).max(20).optional(),
  keywords:z.array(z.string().trim().min(1).max(80)).max(20).optional(),preferences:preferencesSchema.optional()});
function validPreferences(id:string,preferences:PlanPreferences|undefined){
  if(!preferences)return;
  const direction=directionFor(id);
  if(preferences.mode==='preset'&&!direction&&id!==HOT_DIRECTION.id)throw Object.assign(new Error('该方向没有可用的预设模板'),{statusCode:400});
  if(new Set(preferences.topicIds).size!==preferences.topicIds.length||preferences.topicIds.some(topic=>!direction?.topics.some(t=>t.id===topic)))throw Object.assign(new Error('细分主题不属于当前方向'),{statusCode:400});
}

export default defineServerModule({ name: "papers", queues: [paperMaterialQueue, paperDigestQueue, paperIllustrationQueue,paperImpactQueue,paperIdentityQueue,paperQualityQueue], schedules: [paperDiscoverySchedule,paperDiscoveryRecoverySchedule, paperImpactSchedule, paperRecoverySchedule,paperIdentityRecoverySchedule,paperQualityRecoverySchedule], http(app) {
  const id = (s: unknown) => z.uuid().parse(s);
  const missing = (reply: import("fastify").FastifyReply) => reply.code(404).send({ detail: "论文或笔记不存在" });
  const requestedVersion=(query:unknown)=>z.object({version:z.uuid().optional()}).parse(query).version;
  const evaluationDays=(query:unknown)=>z.object({days:z.coerce.number().int().min(1).max(365).default(30)}).parse(query).days;
  app.get('/api/admin/papers/evaluation',adminHandler(async req=>evaluationDashboard(evaluationDays(req.query))));
  app.get('/api/admin/papers/evaluation/report',adminHandler(async(req,reply)=>reply.type('application/json; charset=utf-8')
    .header('Content-Disposition','attachment; filename="paper-evaluation.json"').send(await evaluationDashboard(evaluationDays(req.query)))));
  app.post('/api/admin/papers/quality-evaluations',adminHandler(async(req,reply)=>{
    const input=z.object({paperId:z.uuid(),versionId:z.uuid().optional()}).parse(req.body);
    return reply.code(202).send(await enqueueQualityEvaluation(input.paperId,input.versionId));
  }));
  app.post('/api/admin/papers/quality-evaluations/:id/resume',adminHandler(async(req,reply)=>reply.code(202).send(await resumeQualityEvaluation(id((req.params as {id:string}).id)))));
  app.get("/api/admin/papers", adminHandler(async (req) => {
    const { q,status,digest,mine,tag,direction } = z.object({ q: z.string().max(200).default(""),status:z.enum(['','active','unread','reading','done']).default(''),digest:z.enum(['','ready']).default(''),mine:z.enum(['','true']).default(''),tag:z.string().max(40).default(''),direction:z.string().max(100).default('') }).parse(req.query);
    return { papers: await listPapers(q,status,digest==='ready',mine==='true',tag,direction) };
  }));
  app.get("/api/admin/papers/today", adminHandler(async () => todayReading()));
  app.get("/api/admin/papers/candidates", adminHandler(async req => {
    const input=z.object({direction:z.string().refine(v=>!v||CANDIDATE_DIRECTIONS.some(d=>d.id===v)).default(''),q:z.string().trim().max(200).default(''),
      reading:z.enum(['','pending','ready']).default(''),page:z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1)}).parse(req.query);
    return recentCandidates(input as CandidateFilters);
  }));
  app.get("/api/admin/papers/trends", adminHandler(async () => ({ trends: await paperTrends() })));
  app.get('/api/admin/papers/impact',adminHandler(async req=>{
    const input=z.object({direction:z.string().refine(v=>!v||directionFor(v)||v===HOT_DIRECTION.id).default(''),q:z.string().trim().max(200).default(''),
      reading:z.enum(['','pending','ready']).default(''),page:z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
      age:z.enum(['','older','recent']).default(''),venue:z.string().max(300).default('')}).parse(req.query);
    return paperImpactResults(input);
  }));
  app.post('/api/admin/papers/impact/:id/read',{bodyLimit:29000000},adminHandler(async(req,reply)=>{
    const impactId=z.string().regex(/^W\d+$/).parse((req.params as {id:string}).id);
    const {pdfBase64}=z.object({pdfBase64:z.string().max(28000000).optional()}).parse(req.body??{});
    return reply.code(202).send(await startImpactReading(impactId,pdfBase64));
  }));
  app.post('/api/admin/papers/impact/refresh',adminHandler(async()=>refreshPaperImpact()));
  app.post('/api/admin/papers/impact/:id/save',adminHandler(async req=>{
    const impactId=z.string().regex(/^W\d+$/).parse((req.params as {id:string}).id);
    return startImpactReading(impactId,undefined,false);
  }));
  app.get("/api/admin/papers/plans", adminHandler(async () => ({ plans: await listDiscoveryPlans(), settings: await discoverySettings() })));
  app.post('/api/admin/papers/plans/preview',adminHandler(async(req,reply)=>{
    const input=z.object({plans:z.array(planPatchSchema.extend({id:z.string().min(1).max(100)})).max(9),days:z.number().int().min(1).max(14)}).parse(req.body);
    if(new Set(input.plans.map(p=>p.id)).size!==input.plans.length)return reply.code(400).send({detail:'关注方向重复'});
    const saved=await sql<DiscoveryPlan[]>`SELECT * FROM paper_discovery_plans`;
    const plans:DiscoveryPlan[]=[];
    for(const patch of input.plans){const plan=saved.find(p=>p.id===patch.id);if(!plan)return reply.code(404).send({detail:'没有找到这个关注方向'});
      validPreferences(patch.id,patch.preferences);plans.push({...plan,...patch});}
    return previewDirections(plans,input.days);
  }));
  app.patch("/api/admin/papers/plans/:id", adminHandler(async (req, reply) => {
    const input = planPatchSchema.refine(value=>Object.keys(value).length>0).parse(req.body);
    const planId=z.string().min(1).max(100).parse((req.params as {id:string}).id);validPreferences(planId,input.preferences);
    const row = await updateDiscoveryPlan(planId, input);
    return row ?? reply.code(404).send({ detail: "没有找到这个关注计划" });
  }));
  app.patch("/api/admin/papers/settings", adminHandler(async (req, reply) => {
    const settings = z.object({ daily_limit: z.number().int().min(1).max(3), hot_limit: z.number().int().min(0).max(1), candidate_days: z.number().int().min(1).max(14) })
      .refine((value) => value.hot_limit <= value.daily_limit, "热点名额不能大于每日上限").parse(req.body);
    return await updateDiscoverySettings(settings) ?? reply.code(500).send({ detail: "无法保存设置" });
  }));
  app.post('/api/admin/papers/import-preview',{bodyLimit:29_000_000},adminHandler(async req=>identifyImport(req.body)));
  app.get('/api/admin/papers/import-preview/:id',adminHandler(async(req,reply)=>(await getImportPreview(id((req.params as {id:string}).id)))??missing(reply)));
  app.post('/api/admin/papers/import-preview/:id/ocr',adminHandler(async(req,reply)=>{await enqueueIdentityOcr(id((req.params as {id:string}).id));return reply.code(202).send({queued:true});}));
  app.post("/api/admin/papers", { bodyLimit: 29_000_000 }, adminHandler(async (req, reply) => {
    const paper = await createPaper(req.body);
    return reply.code(201).send(paper);
  }));
  app.post('/api/admin/papers/:id/collection',adminHandler(async req=>collectPaper(id((req.params as {id:string}).id),req.body)));
  app.delete('/api/admin/papers/:id/collection',adminHandler(async req=>{await removeCollection(id((req.params as {id:string}).id));return {removed:true};}));
  app.get("/api/admin/papers/:id", adminHandler(async (req, reply) => {
    return await detail(id((req.params as { id: string }).id),requestedVersion(req.query)) ?? missing(reply);
  }));
  app.post('/api/admin/papers/:id/versions',{bodyLimit:29_000_000},adminHandler(async req=>addPaperVersion(id((req.params as {id:string}).id),req.body)));
  app.post('/api/admin/papers/:id/review-repair',adminHandler(async(req,reply)=>reply.code(202).send(await enqueueReviewRepair(id((req.params as {id:string}).id),req.body))));
  app.post('/api/admin/papers/:id/versions/:versionId/select',adminHandler(async req=>{
    const p=req.params as {id:string;versionId:string};const b=z.object({expectedVersionId:z.uuid().optional(),read:z.boolean().default(false)}).parse(req.body??{});
    return selectPaperVersion(id(p.id),id(p.versionId),b.expectedVersionId,b.read);
  }));
  app.post("/api/admin/papers/:id/material", adminHandler(async (req, reply) => {
    const {versionId}=z.object({versionId:z.uuid().optional()}).parse(req.body??{});
    const paper = await detail(id((req.params as { id: string }).id));
    if (!paper) return missing(reply);
    if(paper.reading_task && ["waiting","failed","unavailable"].includes(paper.reading_task.status))await resumeReadingTask(paper.paper.id,undefined,versionId);
    else await enqueuePaperMaterial(paper.paper.id,undefined,versionId);
    return reply.code(202).send({ status: "queued" });
  }));
  app.post("/api/admin/papers/:id/digest", adminHandler(async (req, reply) => {
    const paper = await detail(id((req.params as { id: string }).id));
    if (!paper) return missing(reply);
    if (paper.material?.status !== "ready") return reply.code(409).send({ detail: "正文材料尚未准备好" });
    const { reread,versionId } = z.object({ reread:z.boolean().default(false),versionId:z.uuid().optional() }).parse(req.body ?? {});
    if(!reread && paper.reading_task && ["waiting","failed","unavailable"].includes(paper.reading_task.status)) await resumeReadingTask(paper.paper.id,undefined,versionId);
    else await enqueuePaperDigest(paper.paper.id,{reread,versionId});
    return reply.code(202).send({ status: "queued" });
  }));
  app.post("/api/admin/papers/:id/illustrations", adminHandler(async (req, reply) => {
    const {versionId}=z.object({versionId:z.uuid().optional()}).parse(req.body??{});
    const paper = await detail(id((req.params as { id: string }).id));
    if (!paper) return missing(reply);
    if (paper.digest?.status !== "ready" || paper.material?.status !== "ready") return reply.code(409).send({ detail: "需要先完成正文解析和论文解读" });
    if(paper.reading_task && ["queued","running","waiting"].includes(paper.reading_task.status)
      && !["illustrations","complete"].includes(paper.reading_task.stage)) return reply.code(409).send({detail:"全文精读尚在处理，请先完成当前任务"});
    await enqueuePaperIllustrations(paper.paper.id,undefined,versionId);
    return reply.code(202).send({ status: "queued" });
  }));
  app.get("/api/admin/papers/:id/notes.md", adminHandler(async (req, reply) => {
    const d = await detail(id((req.params as { id: string }).id),requestedVersion(req.query)); if (!d) return missing(reply);
    const markdown = `# ${d.paper.title}\n\n原文：${d.paper.source_url}\n版本：${d.paper.version}\n\n`
      + d.notes.map(n => `## ${n.title}\n\n${n.page ? `出处：PDF 第 ${n.page} 页\n\n` : ""}${n.markdown}`).join("\n\n---\n\n");
    return reply.type("text/markdown; charset=utf-8").header("Content-Disposition", 'attachment; filename="paper-notes.md"').send(markdown);
  }));
  app.patch("/api/admin/papers/:id/status", adminHandler(async (req, reply) => {
    const status = z.object({ status: z.enum(["unread", "reading", "done"]) }).parse(req.body).status;
    const rows = await sql`UPDATE papers SET status = ${status} WHERE id = ${id((req.params as { id: string }).id)} RETURNING id`;
    return rows.length ? { ok: true } : missing(reply);
  }));
  app.get("/api/admin/papers/:id/pdf", adminHandler(async (req, reply) => {
    const version=requestedVersion(req.query),paperId=id((req.params as {id:string}).id);
    const pdf=version?(await versionPdf(paperId,version))?.pdf_data:await pdfById(paperId);
    if (!pdf) return missing(reply);
    return reply.type("application/pdf").header("Content-Disposition", 'inline; filename="paper.pdf"')
      .header("X-Content-Type-Options", "nosniff").send(pdf);
  }));
  app.post("/api/admin/papers/:id/notes", adminHandler(async (req, reply) => {
    const note = await addNote(id((req.params as { id: string }).id), req.body);
    return note ? reply.code(201).send(note) : missing(reply);
  }));
  app.get('/api/admin/papers/:id/notes/:noteId',adminHandler(async(req,reply)=>{
    const p=req.params as {id:string;noteId:string};return await noteById(id(p.id),id(p.noteId))??missing(reply);
  }));
  app.patch("/api/admin/papers/:id/notes/:noteId", adminHandler(async (req, reply) => {
    const p = req.params as { id: string; noteId: string };
    return await editNote(id(p.id), id(p.noteId), req.body) ?? missing(reply);
  }));
} });
