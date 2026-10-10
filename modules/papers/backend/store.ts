import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { sql,type Db } from "@aihot/backend/db";
import {requestArxiv} from './arxiv-request.ts';
import {saveCollection} from './collection.ts';
import {collectionInput} from '../collection.ts';
import {identityText} from '../identity.ts';
import type { Note, Paper, PaperDetail, PaperSourcePreview } from "../types.ts";
import { withPaperPresentations } from "./presentation.ts";
import { savedPaperIllustrations } from "./illustrations.ts";
import { readingTask } from "./reading-task.ts";
import {withReadingWaits,withTaskWait} from './wait-status.ts';
import {ensureCurrentVersion,listVersions,archivedVersion,withReadableVersions} from './versions.ts';
import {illustrationSignature,VISUAL_ILLUSTRATION_VERSION} from './illustration-plan.ts';
import {presentationSignature} from './presentation.ts';
import {MODELS} from '@aihot/backend/providers/llm';
import {notesForVersion,noteContext} from './notes.ts';

// Remote reading is handled by the worker; source preview only reads arXiv metadata.
const link = z.string().trim().max(2000).refine((s) => {
  try { const u = new URL(s); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
}, "请输入 http 或 https 链接");
const optionalLink = z.union([z.literal(""), link]).default("");
const sourceInput = z.union([z.literal(""), link, z.string().regex(/^urn:paper-pulse:local:[0-9a-f-]{36}$/i)]).default("");
export const PaperInput = z.object({
  title: z.string().trim().min(1).max(500), authors: z.string().trim().max(2000).default(""),
  published: z.string().max(10).refine((s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s), "日期格式为 YYYY-MM-DD").default(""),
  topic: z.string().trim().max(100).default(""), abstract: z.string().trim().max(20000).default(""),
  sourceUrl: sourceInput, pdfUrl: optionalLink, codeUrl: optionalLink,
  version: z.string().trim().min(1).max(100).default("未标注"),
  pdfBase64: z.string().max(28_000_000).optional(),
  doi:z.string().trim().max(300).default('').transform(normalizePaperDoi),
  collection:collectionInput.default({read:false}),
  previewId:z.uuid().optional(),identityKey:z.string().max(500).optional(),
});
export function normalizePaperDoi(value:string){
  const doi=value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').trim().toLowerCase();
  if(doi&&!/^10\.\d{4,9}\/[^\s?#]+$/.test(doi))throw Object.assign(new Error('DOI 格式无效'),{statusCode:400});
  return doi;
}
export async function lockPaperIdentity(db:Db,keys:(string|null)[]){
  for(const key of [...new Set(keys.filter((v):v is string=>!!v))].sort())await db`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
const conflict = (message: string) => Object.assign(new Error(message), { code: "conflict" });
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const fields = sql`id, title, authors, published, topic, abstract, source_url, pdf_url, code_url, arxiv_id, version, status,active_version_id,
  (pdf_data IS NOT NULL) AS has_pdf, pdf_sha256, created_at,
  coalesce((SELECT status FROM paper_materials WHERE paper_id = papers.id), 'unavailable') AS parse_status,
  coalesce((SELECT status FROM paper_digests WHERE paper_id = papers.id), 'unavailable') AS digest_status,
  (SELECT status FROM paper_reading_tasks WHERE paper_id=papers.id) AS reading_status,
  (SELECT stage FROM paper_reading_tasks WHERE paper_id=papers.id) AS reading_stage,
  (SELECT error FROM paper_reading_tasks WHERE paper_id=papers.id) AS reading_error,
  (SELECT updated_at FROM paper_reading_tasks WHERE paper_id=papers.id) AS reading_updated_at`;

export async function createPaper(input: unknown): Promise<Paper> {
  const b = PaperInput.parse(input);
  let pdf: Buffer | null = null;
  if (b.pdfBase64 !== undefined) {
    pdf=decodePaperPdf(b.pdfBase64);
  }
  const selection=b.previewId?await (await import('./identity.ts')).resolveImportSelection(b.previewId,b.identityKey??'',pdf):null;
  if(selection){
    pdf=selection.pdf;
    if(b.doi&&selection.candidate.doi&&b.doi!==selection.candidate.doi)throw conflict('DOI 已改变，请重新查询核验后保存');
  }
  const source = new URL(b.sourceUrl || selection?.candidate.source_url || `urn:paper-pulse:local:${randomUUID()}`); source.hash = "";
  const hash = pdf ? createHash("sha256").update(pdf).digest("hex") : null;
  const stableArxivId = (() => { try { return arxivId(source.href).replace(/v\d+$/i, ""); } catch { return null; } })();
  const doi=b.doi||selection?.candidate.doi||(['doi.org','dx.doi.org'].includes(source.hostname)?normalizePaperDoi(source.pathname.slice(1)):'');
  const candidate=selection?.candidate;
  const unchanged=candidate&&identityText(candidate.title)===identityText(b.title)&&identityText(candidate.authors)===identityText(b.authors)
    &&source.href===candidate.source_url;
  const identityStatus=candidate?.source_kind==='existing'?(candidate.metadata.identity_status??'unverified'):candidate?.match==='local'?'unverified':!unchanged?'user_modified':candidate?.match==='matched'?'matched':candidate?.match==='record'?'record_found':'user_confirmed';
  const identityChecks=candidate?.source_kind==='existing'?(candidate.metadata.identity_checks??['同一 PDF 已收录；本次只对照文件哈希，没有重新核验书目信息']):candidate?.checks;
  const metadata={source:'manual',date_precision:b.published?'day':'unknown',identity_status:'unverified',...(candidate?.metadata??{}),
    ...(candidate?{identity_status:identityStatus,identity_checks:identityStatus==='user_modified'?['导入信息经过手动修改，原预览匹配结果不作为当前身份核验依据']:identityChecks,
      identity_checked_at:candidate.metadata.identity_checked_at??new Date().toISOString()}: {})};
  const paperId=await sql.begin(async tx=>{
    await lockPaperIdentity(tx,[source.href,stableArxivId,doi||null,hash]);
    const matches=await tx<{id:string;has_pdf:boolean;pdf_sha256:string|null;doi:string|null}[]>`SELECT id,(pdf_data IS NOT NULL) AS has_pdf,pdf_sha256,doi FROM papers WHERE source_url=${source.href}
      OR (${stableArxivId}::text IS NOT NULL AND (arxiv_id=${stableArxivId} OR (arxiv_id IS NULL AND source_url LIKE ${`https://arxiv.org/abs/${stableArxivId}%`})))
      OR (${doi!==''} AND (doi=${doi} OR id IN (SELECT paper_id FROM paper_impact_candidates WHERE lower(doi)=${doi} AND paper_id IS NOT NULL)))
      OR (${hash}::text IS NOT NULL AND pdf_sha256=${hash}) ORDER BY created_at`;
    if(new Set(matches.map(p=>p.id)).size>1)throw conflict('标识符或 PDF 对应多条已有论文，请先核对记录');
    let pid=matches[0]?.id;
    if(selection&&b.collection.read&&!pdf&&!stableArxivId&&!pid)throw conflict('DOI 身份已查询，但尚无可解析全文；请上传 PDF 或选择仅保存');
    if(pid){
      if(doi&&matches[0]?.doi&&matches[0].doi!==doi)throw conflict('该论文已有不同的 DOI，请核对身份后再导入');
      if(pdf&&matches[0]?.has_pdf&&matches[0].pdf_sha256!==hash)throw conflict('已有不同版本的 PDF，请打开已有论文；本次不会覆盖原文或解读');
      if(pdf&&!matches[0]?.has_pdf)await tx`UPDATE papers SET pdf_data=${pdf},pdf_sha256=${hash} WHERE id=${pid}`;
      if(doi)await tx`UPDATE papers SET doi=coalesce(doi,${doi}) WHERE id=${pid}`;
      if(candidate&&unchanged)await tx`UPDATE papers SET metadata=metadata||${tx.json(metadata)} WHERE id=${pid}`;
    }else{
      const [created]=await tx<{id:string}[]>`INSERT INTO papers
        (id,title,authors,published,topic,abstract,source_url,pdf_url,code_url,arxiv_id,version,pdf_data,pdf_sha256,doi,metadata)
        VALUES (${randomUUID()},${b.title},${b.authors},${b.published},${b.topic},${b.abstract},${source.href},${b.pdfUrl},${b.codeUrl},${stableArxivId},${b.version},${pdf},${hash},${doi||null},${tx.json(metadata)}) RETURNING id`;
      pid=created!.id;
    }
    await tx`INSERT INTO paper_materials(paper_id,status) VALUES(${pid},'unavailable') ON CONFLICT(paper_id) DO NOTHING`;
    await tx`INSERT INTO paper_digests(paper_id,status) VALUES(${pid},'unavailable') ON CONFLICT(paper_id) DO NOTHING`;
    if(selection?.material){const material=selection.material;await tx`UPDATE paper_materials SET status='ready',parser=${material.parser},markdown=${material.markdown},
      blocks=${tx.json(material.blocks as never)},receipt_id=${material.receiptId},error=NULL,updated_at=now() WHERE paper_id=${pid} AND status<>'ready'`;}
    await ensureCurrentVersion(pid,tx);
    const collected=await tx`SELECT paper_id FROM paper_collection WHERE paper_id=${pid}`;
    await saveCollection(pid,collected.length?{read:b.collection.read}:b.collection,tx);
    if(b.previewId)await tx`UPDATE paper_import_previews SET pdf_data=NULL WHERE id=${b.previewId}`;
    return pid;
  });
  return (await paperById(paperId))!;
}

export function decodePaperPdf(base64:string){
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw bad('PDF 编码无效');
  const pdf=Buffer.from(base64,'base64');
  if(pdf.length>20*1024*1024||pdf.subarray(0,5).toString()!=='%PDF-')throw bad('只支持 20 MB 以内的 PDF 文件');
  return pdf;
}

const ARXIV_SOURCE = /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([^/?#]+?)(?:\.pdf)?$/i;
const arxivParser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, trimValues: true });

export function arxivId(url: string): string {
  const match = ARXIV_SOURCE.exec(url.trim());
  if (!match || !/^(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?$/i.test(match[1])) {
    throw bad("目前只支持解析 arXiv abs 或 pdf 链接");
  }
  return match[1];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Resolve stable metadata for the import preview; it does not create a paper. */
export async function resolvePaperSource(input: unknown): Promise<PaperSourcePreview> {
  const url = link.parse(input);
  const id = arxivId(url);
  let response: Response;
  try {
    response = await requestArxiv(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {
      headers: { accept: "application/atom+xml" }, signal: AbortSignal.timeout(8_000),
    });
  } catch { throw bad("暂时无法读取 arXiv 元数据，请稍后重试"); }
  if (!response.ok) throw bad(`arXiv 元数据读取失败（HTTP ${response.status}）`);
  const xml = await response.text();
  if (xml.length > 2_000_000) throw bad("arXiv 元数据响应过大");
  let parsed: any;
  try { parsed = arxivParser.parse(xml); } catch { throw bad("arXiv 元数据格式无法解析"); }
  const raw = parsed?.feed?.entry;
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (!entry) throw bad("没有找到对应的 arXiv 论文");
  const rawAuthors = Array.isArray(entry.author) ? entry.author : [entry.author];
  const authors = rawAuthors.map((author: any) => text(author?.name)).filter(Boolean).join(", ");
  const published = text(entry.published).slice(0, 10);
  const returnedId=text(entry.id)?arxivId(text(entry.id)):id;
  if(returnedId.replace(/v\d+$/i,'')!==id.replace(/v\d+$/i,'')||(/v\d+$/i.test(id)&&returnedId!==id))throw bad('arXiv 返回的论文或版本与请求不一致');
  const version = returnedId.match(/v\d+$/i)?.[0]??'arXiv 版本未标注';
  return { source_url:`https://arxiv.org/abs/${returnedId}`, pdf_url:`https://arxiv.org/pdf/${returnedId}`, title: text(entry.title), authors,
    published: /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : "", abstract: text(entry.summary),
    version, source_kind: "arxiv" };
}
export async function listPapers(query = "", status = "", digestReady = false, mine=false,tag='',direction=''): Promise<Paper[]> {
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const papers = await sql<Paper[]>`SELECT ${fields}, (SELECT count(*)::int FROM paper_notes n WHERE n.paper_id = papers.id) AS note_count
    FROM papers WHERE (${status===""} OR status=${status} OR (${status==="active"} AND status IN ('reading','done')))
      AND (${!mine} OR EXISTS (SELECT 1 FROM paper_collection c WHERE c.paper_id=papers.id
        AND (${tag===''} OR ${tag}=ANY(c.tags)) AND (${direction===''} OR ${direction}=ANY(c.directions))))
      AND (${!digestReady} OR EXISTS (SELECT 1 FROM paper_digests d WHERE d.paper_id=papers.id AND d.status='ready')
        OR EXISTS(SELECT 1 FROM paper_versions v WHERE v.paper_id=papers.id AND v.snapshot->'digest'->>'status'='ready'))
      AND (title ILIKE ${pattern} OR authors ILIKE ${pattern} OR topic ILIKE ${pattern}
      OR abstract ILIKE ${pattern} OR doi ILIKE ${pattern}
      OR (${mine} AND EXISTS(SELECT 1 FROM paper_collection c WHERE c.paper_id=papers.id AND (c.reason ILIKE ${pattern} OR array_to_string(c.tags,' ') ILIKE ${pattern})))
      OR (${digestReady} AND EXISTS(SELECT 1 FROM paper_versions v WHERE v.paper_id=papers.id AND v.snapshot->'digest'->>'status'='ready'
        AND (v.snapshot->'paper'->>'title' ILIKE ${pattern} OR v.snapshot->'presentation'->>'title_zh' ILIKE ${pattern} OR v.snapshot->'presentation'->>'summary_zh' ILIKE ${pattern})))
      OR id IN (SELECT paper_id FROM paper_presentations WHERE status = 'ready' AND (title_zh ILIKE ${pattern} OR summary_zh ILIKE ${pattern})))
    ORDER BY CASE WHEN ${mine} THEN (SELECT pinned FROM paper_collection WHERE paper_id=papers.id) END DESC NULLS LAST,
      CASE WHEN ${mine} THEN (SELECT saved_at FROM paper_collection WHERE paper_id=papers.id) END DESC NULLS LAST,
      CASE WHEN ${digestReady} THEN coalesce((SELECT updated_at FROM paper_digests WHERE paper_id=papers.id AND status='ready'),
        (SELECT max((snapshot->'digest'->>'updated_at')::timestamptz) FROM paper_versions WHERE paper_id=papers.id AND snapshot->'digest'->>'status'='ready')) END DESC NULLS LAST,
      created_at DESC LIMIT 200`;
  const enriched=await withReadingWaits(await withPaperPresentations(papers));
  return digestReady?withReadableVersions(enriched):enriched;
}
export async function paperById(id: string): Promise<Paper | null> {
  const [paper] = await sql<Paper[]>`SELECT ${fields} FROM papers WHERE id = ${id}`;
  return paper ? (await withReadingWaits(await withPaperPresentations([paper])))[0]! : null;
}
export async function detail(id: string,versionId?:string): Promise<PaperDetail | null> {
  let paper = await paperById(id); if (!paper) return null;
  const versions=await listVersions(id),saved=versionId?await archivedVersion(id,versionId):null;
  if(saved){
    const active=paper;
    paper={...active,...saved.paper,id,status:active.status,collection:active.collection,active_version_id:active.active_version_id,
      has_pdf:versions.find(v=>v.id===versionId)?.has_pdf??false,pdf_sha256:saved.paper.pdf_sha256};
    const translated=saved.presentation?.status==='ready'&&saved.presentation.source_signature===presentationSignature(paper);
    paper.title_zh=translated?saved.presentation!.title_zh:null;paper.summary_zh=translated?saved.presentation!.summary_zh:null;
    const notes=await notesForVersion(paper,versionId);
    const visual=saved.illustrations&&saved.material&&saved.digest&&saved.illustrations.input_signature===illustrationSignature(paper,saved.material,saved.digest)?saved.illustrations:null;
    return {paper,note_context:noteContext(versionId,saved.digest,visual?.selections??[]),illustration_mode:MODELS.default.vision?'vision':'text',notes,material:saved.material,digest:saved.digest,illustrations:visual?.selections??[],illustration_status:visual?.status??'unavailable',
      reading_task:saved.task,versions,viewing_version_id:versionId,is_current_version:false};
  }
  const notes=await notesForVersion(paper,paper.active_version_id);
  const { materialByPaperId } = await import("./material.ts");
  const { digestByPaperId } = await import("./digest.ts");
  const [material, digest] = await Promise.all([materialByPaperId(id), digestByPaperId(id)]);
  const visuals = await savedPaperIllustrations(paper, material, digest);
  return { paper,note_context:noteContext(paper.active_version_id,digest,visuals?.selections??[]),illustration_mode:MODELS.default.vision?'vision':'text',illustration_upgrade_available:!!MODELS.default.vision&&visuals?.status==='ready'&&visuals.prompt_version!==VISUAL_ILLUSTRATION_VERSION,notes, material, digest,
    illustrations: visuals?.selections ?? [], illustration_status: visuals?.status ?? "unavailable", illustration_error: visuals?.error ?? null,
    reading_task:await withTaskWait(await readingTask(id)),versions,viewing_version_id:paper.active_version_id,is_current_version:true };
}
export async function pdfById(id: string): Promise<Buffer | null> {
  const [row] = await sql<{ pdf_data: Buffer | null }[]>`SELECT pdf_data FROM papers WHERE id = ${id}`;
  return row?.pdf_data ?? null;
}
