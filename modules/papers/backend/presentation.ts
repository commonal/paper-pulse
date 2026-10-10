import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, type Db } from "@aihot/backend/db";
import type { Paper, PaperDigestStatus } from "../types.ts";
import {withPaperMetadata} from './collection.ts';

const chinese = (max: number) => z.string().trim().min(2).max(max).refine(value => /\p{Script=Han}/u.test(value), "需要中文内容");
export const presentationSchema = z.object({ title_zh: chinese(500), summary_zh: chinese(240) });
export const PRESENTATION_INSTRUCTION = "title_zh 是忠实、自然的中文标题译名，保留方法名和必要缩写；summary_zh 用一至两句自然中文说明研究的问题、方法和主要发现，建议 80 至 140 字、最多 240 字，不堆叠实验数字，让非该方向的读者也能判断论文讲什么。只依据所提供的材料，不夸大结论。不要把分类、关键词或推荐理由当成简介。";
const PROMPT_VERSION = "paper-presentation-v1";

type Presentation = z.infer<typeof presentationSchema> & { status: PaperDigestStatus; source_signature: string; updated_at: string };
export function presentationSignature(paper: Pick<Paper, "title" | "abstract" | "version">) {
  return createHash("sha256").update(JSON.stringify([paper.title, paper.abstract, paper.version])).digest("hex");
}

export async function savePaperPresentation(paper: Paper, content: z.infer<typeof presentationSchema>, model: string, receiptId: number, db: Db, promptVersion = PROMPT_VERSION) {
  await db`INSERT INTO paper_presentations (paper_id, status, title_zh, summary_zh, source_signature, model, prompt_version, receipt_id)
    VALUES (${paper.id}, 'ready', ${content.title_zh}, ${content.summary_zh}, ${presentationSignature(paper)}, ${model}, ${promptVersion}, ${receiptId})
    ON CONFLICT (paper_id) DO UPDATE SET status = 'ready', title_zh = EXCLUDED.title_zh, summary_zh = EXCLUDED.summary_zh,
      source_signature = EXCLUDED.source_signature, model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version,
      receipt_id = EXCLUDED.receipt_id, error = NULL, updated_at = now()`;
}

/** Readers only see display text for the metadata revision that produced it. */
export async function withPaperPresentations<T extends Paper>(papers: T[]): Promise<T[]> {
  if (!papers.length) return papers;
  const rows = await sql<(Presentation & { paper_id: string; prompt_version: string; conclusion: string | null })[]>`SELECT pp.paper_id, pp.status, pp.title_zh, pp.summary_zh, pp.source_signature, pp.updated_at, pp.prompt_version,
    (SELECT section->'claims'->0->>'text' FROM jsonb_array_elements(d.sections) section WHERE section->>'id' = 'summary' LIMIT 1) AS conclusion
    FROM paper_presentations pp LEFT JOIN paper_digests d ON d.paper_id = pp.paper_id AND d.status = 'ready'
    WHERE pp.paper_id IN ${sql(papers.map(p => p.id))}`;
  const byId = new Map(rows.map(row => [row.paper_id, row]));
  return withPaperMetadata(papers.map(paper => {
    const value = byId.get(paper.id);
    const matching = value?.source_signature === presentationSignature(paper);
    const summary = value?.prompt_version === PROMPT_VERSION && value.conclusion && value.conclusion.length <= 240 ? value.conclusion : value?.summary_zh;
    return { ...paper, title_zh: matching && value.status === "ready" ? value.title_zh : null,
      summary_zh: matching && value.status === "ready" ? summary : null,
      presentation_status: matching ? value.status : "unavailable" };
  }));
}
