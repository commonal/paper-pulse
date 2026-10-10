import { createHash } from "node:crypto";
import { load } from "cheerio";
import { sql } from "@aihot/backend/db";
import { credential } from "@aihot/backend/config";
import type { PaperBlock, PaperMaterial, PaperParseStatus } from "../types.ts";
import { arxivId } from "./store.ts";
import { parsePdfWithMineru } from "./mineru.ts";
import { paperTaskFailure, paperTaskWaits } from "./task-errors.ts";
import {guardedFetch} from '@aihot/backend/lib/http-fetch';

const MAX_HTML_BYTES = 24 * 1024 * 1024;
const MAX_BLOCKS = 4000;
const MAX_TEXT = 1_000_000;
export const MAX_PDF_BYTES=20*1024*1024;
export class DailyPdfTooLargeError extends Error{
  constructor(){super('原文 PDF 超过现有解析流程的 20 MB 上限');}
}

function clean(value: string): string { return value.replace(/\s+/g, " ").trim(); }

function parseArxivHtml(sourceId: string, html: string): { markdown: string; blocks: PaperBlock[] } {
  const $ = load(html);
  const blocks: PaperBlock[] = [];
  let total = 0;
  $("p.ltx_p").each((index, element) => {
    if (blocks.length >= MAX_BLOCKS || total >= MAX_TEXT) return false;
    const text = clean($(element).text());
    if (text.length < 12) return;
    const sectionPath = $(element).parents("section.ltx_section").toArray().reverse().map((section) => {
      const title = clean($(section).children("h2.ltx_title_section, h3.ltx_title_section, h4.ltx_title_section").first().text());
      return title;
    }).filter(Boolean);
    const id = $(element).attr("id") || `paragraph-${index + 1}`;
    blocks.push({ id: `arxiv-${id}`, kind: "text", text, section_path: sectionPath, locator: `html#${id}` });
    total += text.length;
    return;
  });
  if (blocks.length < 3) throw new Error("arXiv HTML 正文过短或结构不完整");
  const markdown = blocks.map((block) => `${block.section_path.length ? `### ${block.section_path.join(" / ")}\n\n` : ""}${block.text}`).join("\n\n");
  return { markdown, blocks };
}

async function fetchArxivHtml(sourceUrl: string): Promise<string> {
  const id = arxivId(sourceUrl);
  const response = await fetch(`https://arxiv.org/html/${id}`, {
    headers: { accept: "text/html", "user-agent": "paper-pulse/0.1" }, signal: AbortSignal.timeout(30_000),
  });
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || (length && length > MAX_HTML_BYTES)) throw new Error("arXiv HTML 暂不可用");
  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) throw new Error("arXiv HTML 超过处理上限");
  return html;
}

export async function materialByPaperId(paperId: string): Promise<PaperMaterial | null> {
  const [row] = await sql<PaperMaterial[]>`SELECT paper_id, status, parser, markdown, blocks, error, receipt_id, updated_at FROM paper_materials WHERE paper_id = ${paperId}`;
  return row ?? null;
}

async function localPdfByPaperId(paperId: string): Promise<Buffer | null> {
  const [row] = await sql<{ pdf_data: Buffer | null }[]>`SELECT pdf_data FROM papers WHERE id = ${paperId}`;
  return row?.pdf_data ?? null;
}

async function fetchArxivPdf(sourceUrl: string,checkDailySize=false): Promise<Buffer | null> {
  const id = arxivId(sourceUrl);
  const response = await fetch(`https://arxiv.org/pdf/${id}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_PDF_BYTES){await response.body?.cancel();if(checkDailySize)throw new DailyPdfTooLargeError();return null;}
  const pdf = Buffer.from(await response.arrayBuffer());
  if(pdf.length>MAX_PDF_BYTES&&checkDailySize)throw new DailyPdfTooLargeError();
  return pdf.length <= MAX_PDF_BYTES && pdf.subarray(0, 5).toString() === "%PDF-" ? pdf : null;
}

async function saveLocalPdf(paperId: string, pdf: Buffer) {
  const hash = createHash("sha256").update(pdf).digest("hex");
  await sql`UPDATE papers SET pdf_data = coalesce(pdf_data, ${pdf}), pdf_sha256 = coalesce(pdf_sha256, ${hash}) WHERE id = ${paperId}`;
}

export async function ensureArxivPdf(paper:{id:string;source_url:string},checkDailySize=false):Promise<Buffer|null>{
  let pdf=await localPdfByPaperId(paper.id);
  if(!pdf&&/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i.test(paper.source_url)){
    pdf=await fetchArxivPdf(paper.source_url,checkDailySize);
    if(pdf)await saveLocalPdf(paper.id,pdf);
  }
  return pdf;
}

async function saveStatus(paperId: string, status: PaperParseStatus, values: { parser?: string; markdown?: string; blocks?: PaperBlock[]; error?: string | null; receipt_id?: number | null } = {}) {
  const [row] = await sql<PaperMaterial[]>`INSERT INTO paper_materials (paper_id, status, parser, markdown, blocks, error, receipt_id)
    VALUES (${paperId}, ${status}, ${values.parser ?? ""}, ${values.markdown ?? ""}, ${sql.json((values.blocks ?? []) as never)}, ${values.error ?? null}, ${values.receipt_id ?? null})
    ON CONFLICT (paper_id) DO UPDATE SET status = EXCLUDED.status, parser = EXCLUDED.parser, markdown = EXCLUDED.markdown,
      blocks = EXCLUDED.blocks, error = EXCLUDED.error, receipt_id = EXCLUDED.receipt_id, updated_at = now()
    RETURNING paper_id, status, parser, markdown, blocks, error, receipt_id, updated_at`;
  return row!;
}

export async function parsePaperMaterial(paper: { id: string; source_url: string }): Promise<PaperMaterial> {
  const hasMineruToken = Boolean(credential("integrations", "MINERU_API_TOKEN"));
  const useMineru = hasMineruToken && process.env.MINERU_CALLS_ENABLED === "true";
  await saveStatus(paper.id, "parsing", { parser: useMineru ? "mineru_api" : "arxiv-html-lite", error: null });
  try {
    let pdf = await ensureArxivPdf(paper);
    if(!pdf){
      const [candidate]=await sql<{pdf_url:string|null;open_access_url:string;doi_url:string}[]>`SELECT pdf_url,open_access_url,doi_url FROM paper_impact_candidates WHERE paper_id=${paper.id} LIMIT 1`;
      if(candidate){
        const {impactFulltext}=await import('./impact.ts');
        const fulltext=impactFulltext(candidate);
        if(fulltext){
          let pdfUrl=fulltext.pdfUrl;
          if('landing' in fulltext){
            const page=await guardedFetch(pdfUrl,{timeoutMs:20000,maxBytes:2*1024*1024});
            if(page.status!==200)throw new Error('论文来源页暂时不可用，请上传原文 PDF');
            const $=load(page.text());const links=$('a[href]').toArray().flatMap(el=>{try{return [new URL($(el).attr('href')!,page.url)];}catch{return [];}})
              .filter(u=>u.origin===new URL(page.url).origin&&/\.pdf$/i.test(u.pathname));
            if(!links.length)throw new Error('论文来源页没有提供开放 PDF，请上传原文 PDF');
            pdfUrl=links[0]!.href;
          }
          const response=await guardedFetch(pdfUrl,{timeoutMs:30000,maxBytes:20*1024*1024,headers:{accept:'application/pdf'}});
          if(response.status!==200||response.body.subarray(0,5).toString()!=='%PDF-')throw new Error('开放全文地址未返回有效 PDF，请在高引论文列表上传原文 PDF 后重试');
          pdf=response.body;await saveLocalPdf(paper.id,pdf);
        }
      }
    }
    if (useMineru) {
      if (!pdf) return await saveStatus(paper.id, "unavailable", { parser: "mineru_api", error: "没有可供 MinerU 解析的本地 PDF" });
      const parsed = await parsePdfWithMineru({ pdf, sourceId: paper.id, sourceUrl: paper.source_url });
      return saveStatus(paper.id, "ready", { parser: "mineru_api", markdown: parsed.markdown, blocks: parsed.blocks, receipt_id: parsed.receiptId, error: null });
    }
    if (!/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i.test(paper.source_url)) {
      return await saveStatus(paper.id, "unavailable", { parser: "", error: hasMineruToken ? "MinerU 外部调用未启用，且当前论文不是 arXiv 来源" : "未配置 MINERU_API_TOKEN，且当前论文不是 arXiv 来源" });
    }
    const parsed = parseArxivHtml(arxivId(paper.source_url), await fetchArxivHtml(paper.source_url));
    return saveStatus(paper.id, "ready", { parser: "arxiv-html-lite", markdown: parsed.markdown, blocks: parsed.blocks, error: "未配置 MINERU_API_TOKEN，当前使用 arXiv HTML 轻量回退" });
  } catch (error) {
    const parser = useMineru ? "mineru_api" : "arxiv-html-lite";
    await saveStatus(paper.id, paperTaskWaits(error) ? "queued" : "failed", { parser, ...paperTaskFailure(error) });
    throw error;
  }
}
