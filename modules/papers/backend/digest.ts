import { sql } from "@aihot/backend/db";
import { z } from "zod";
import type { PaperDigest, PaperDigestClaim, PaperDigestSection } from "../types.ts";
import { presentationSchema } from "./presentation.ts";

export const DIGEST_SECTIONS = [
  { id: "summary", title: "一句话结论" }, { id: "problem", title: "研究问题" },
  { id: "method", title: "核心方法" }, { id: "experiments", title: "实验设置与结果" },
  { id: "limitations", title: "局限与边界" },
];

const claimSchema = z.object({
  id: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(800),
  support: z.enum(["direct", "synthesis", "not_stated"]),
  evidence_block_ids: z.array(z.string().trim().min(1).max(200)).max(8),
});
const sectionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(100),
  claims: z.array(claimSchema).min(1).max(16),
});
export const digestSchema = presentationSchema.extend({ sections: z.array(sectionSchema).length(5) });

export async function digestByPaperId(paperId: string): Promise<PaperDigest | null> {
  const [row] = await sql<PaperDigest[]>`SELECT paper_id, status, model, prompt_version, sections,
    material_updated_at, receipt_id, error, updated_at FROM paper_digests WHERE paper_id = ${paperId}`;
  return row ?? null;
}

export function validateSections(raw: z.infer<typeof digestSchema>, allowed: Set<string>): PaperDigestSection[] {
  const claimIds = new Set<string>();
  const sectionIds = new Set<string>();
  return raw.sections.map((section) => {
    if (!DIGEST_SECTIONS.some((required) => required.id === section.id && required.title === section.title)) throw new Error(`AI 解读包含未知章节 ${section.id}`);
    if (sectionIds.has(section.id)) throw new Error(`AI 解读包含重复章节 ${section.id}`);
    sectionIds.add(section.id);
    const claims: PaperDigestClaim[] = section.claims.map((claim) => {
      if (claimIds.has(claim.id)) throw new Error(`AI 解读包含重复主张 ${claim.id}`);
      claimIds.add(claim.id);
      const evidence = [...new Set(claim.evidence_block_ids)];
      if (claim.support !== "not_stated" && evidence.length === 0) throw new Error(`主张 ${claim.id} 缺少证据块`);
      if (evidence.some((id) => !allowed.has(id))) throw new Error(`主张 ${claim.id} 引用了不存在的证据块`);
      return { ...claim, evidence_block_ids: evidence };
    });
    return { ...section, claims };
  });
}
