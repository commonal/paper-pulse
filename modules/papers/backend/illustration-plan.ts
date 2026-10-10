import { createHash } from "node:crypto";
import { z } from "zod";
import type { Paper, PaperBlock, PaperDigest, PaperIllustration, PaperMaterial } from "../types.ts";

export const MAX_ILLUSTRATIONS=6;
export const ILLUSTRATION_VERSION = "paper-illustrations-v4";
export const VISUAL_ILLUSTRATION_VERSION='paper-illustrations-vision-v4';
export const bodyCheckSchema=z.object({claim_id:z.string().min(1),verdict:z.enum(['consistent','conflict','not_assessable']),
  figure_ids:z.array(z.string().min(1)).max(MAX_ILLUSTRATIONS),reason:z.string().trim().min(1).max(600)});
// Concision is a writing target, not a validity gate: Dropout's complete table had 14 short observations.
// Provider response/token limits and per-item length bound size; factual accuracy still requires visual review.
// Caption/background paragraphs can exceed a short visual observation; preserve them for review rather than crop facts.
export const visualReadingSchema=z.object({kind:z.enum(['chart','table','diagram','other']),observations:z.array(z.string().trim().min(1).max(350)).min(1),text_context:z.array(z.string().trim().min(1).max(1000)).max(6).default([]),unreadable:z.array(z.string().trim().min(1).max(200)).max(6),conflicts:z.array(z.string().trim().min(1).max(200)).max(6)});
export type VisualReading=z.infer<typeof visualReadingSchema>;
export const illustrationSchema = z.object({
  block_id: z.string().min(1), after_claim_id: z.string().min(1), title: z.string().trim().min(1).max(80),
  selection_reason: z.string().trim().min(1).max(220), reading_guide: z.string().trim().min(1).max(350),
  takeaway: z.string().trim().min(1).max(350), caveat: z.string().trim().min(1).max(250),
  evidence_block_ids: z.array(z.string().min(1)).min(1).max(8),
});
export const illustrationPlanSchema = z.object({ selections: z.array(illustrationSchema).max(MAX_ILLUSTRATIONS), reason: z.string().trim().min(1).max(500) });
export const visualPlanSchema=illustrationPlanSchema.extend({selections:z.array(illustrationSchema.extend({visual_reading:visualReadingSchema})).max(MAX_ILLUSTRATIONS)});
export const illustrationReviewSchema = z.object({
  publishable: z.boolean(), blockers: z.array(z.string()).max(8),
  checks: z.array(z.object({ block_id: z.string(), verdict: z.enum(["supported", "corrected", "rejected"]),
    reason: z.string().max(2000), quotes: z.array(z.object({ block_id: z.string(), quote: z.string().trim().min(1).max(900) })).max(6) })).max(MAX_ILLUSTRATIONS),
  final: illustrationPlanSchema,
});
export type IllustrationPlan = z.infer<typeof illustrationPlanSchema>;
export type IllustrationReview = z.infer<typeof illustrationReviewSchema>;
export const illustrationQuoteReviewSchema=illustrationReviewSchema.extend({checks:z.array(illustrationReviewSchema.shape.checks.element.omit({quotes:true}).extend({quote_ids:z.array(z.string().min(1)).max(6)})).max(MAX_ILLUSTRATIONS)});
export const visualReviewSchema=illustrationQuoteReviewSchema.extend({checks:z.array(illustrationQuoteReviewSchema.shape.checks.element.extend({visual_consistent:z.boolean(),visual_reason:z.string().trim().min(1).max(1000)})).max(MAX_ILLUSTRATIONS),final:visualPlanSchema});
export function compileIllustrationReview(review:z.infer<typeof illustrationQuoteReviewSchema>,catalog:{block_id:string;quotes:{quote_id:string;text:string}[]}[]):IllustrationReview{
  const quotes=new Map(catalog.flatMap(block=>block.quotes.map(quote=>[quote.quote_id,{block_id:block.block_id,quote:quote.text}] as const)));
  const checks=review.checks.map(check=>({block_id:check.block_id,verdict:check.verdict,reason:check.reason,quotes:check.quote_ids.map(id=>{const quote=quotes.get(id);if(!quote)throw new Error('图表核查引用了未知原文片段 '+id);return quote;})}));
  const final={...review.final,selections:review.final.selections.map(item=>({...item,evidence_block_ids:[...new Set([...item.evidence_block_ids,...(checks.find(check=>check.block_id===item.block_id)?.quotes.map(q=>q.block_id)??[])])]}))};
  return illustrationReviewSchema.parse({...review,checks,final});
}

export function illustrationSignature(paper: Paper, material: PaperMaterial, digest: PaperDigest) {
  return createHash("sha256").update(JSON.stringify([paper.id, paper.title, paper.version, paper.pdf_sha256,
    material.parser, new Date(material.updated_at).toISOString(), digest.sections])).digest("hex");
}
export function validIllustrationBox(block: PaperBlock) {
  const box = block.bbox;
  return !!box && box.length === 4 && box.every(Number.isFinite) && box[0] >= 0 && box[1] >= 0
    && box[2] <= 1000 && box[3] <= 1000 && box[2] > box[0] && box[3] > box[1];
}
export function illustrationCandidates(paper: Paper, material: PaperMaterial, digest: PaperDigest, rawItems: unknown = []) {
  if (!paper.has_pdf || !paper.pdf_sha256 || material.parser !== "mineru_api" || material.status !== "ready" || digest.status !== "ready"
    || !digest.material_updated_at || new Date(digest.material_updated_at).getTime() !== new Date(material.updated_at).getTime()) return [];
  return material.blocks.filter(block => (block.kind === "figure" || block.kind === "table") && block.page && validIllustrationBox(block)
    && /^(?:Figure|Fig\.?|Table|图|表)\s*\d+\b/i.test(block.caption ?? "")).map(block => {
      const result = { ...block };
      // The real Figure 6 was split into a captionless left panel and a captioned right panel.
      // Recover only adjacent same-row, same-page image siblings from the already-paid parse, never guess page width.
      const index = /#\/(\d+)$/.exec(block.locator)?.[1];
      if (block.kind === "figure" && index && Array.isArray(rawItems)) {
        let n = Number(index) - 1;
        while (n >= 0) {
          const item = rawItems[n--];
          const caption = item?.image_caption ?? item?.chart_caption ?? item?.caption;
          const captionText = (Array.isArray(caption) ? caption.join(" ") : caption)?.trim() ?? "";
          if (!item || !["image", "chart", "figure"].includes(item.type) || Number(item.page_idx) + 1 !== block.page
            || (captionText && !/^\([a-z]\)/i.test(captionText))) break;
          const sibling = { ...block, bbox: item.bbox };
          if (!validIllustrationBox(sibling)) break;
          const [x0, y0, x1, y1] = sibling.bbox!; const b = result.bbox!;
          const sameRow = Math.abs(y0 - b[1]) <= 25 && Math.abs(y1 - b[3]) <= 25 && x1 <= b[0] && b[0] - x1 <= 60;
          const aboveRow = y1 <= b[1] && b[1] - y1 <= 60 && x0 <= b[2] && x1 >= b[0];
          const overlapping = x0 <= b[2] && x1 >= b[0] && y0 <= b[3] && y1 >= b[1];
          if (!sameRow && !aboveRow && !overlapping) break;
          result.bbox = [Math.min(x0, b[0]), Math.min(y0, b[1]), Math.max(x1, b[2]), Math.max(y1, b[3])];
        }
      }
      return result;
    });
}
export function illustrationAnchors(digest: PaperDigest) {
  return digest.sections.filter(section => ["problem", "method", "experiments", "limitations"].includes(section.id))
    .flatMap(section => section.claims.map(claim => ({ id: claim.id, section: section.id, text: claim.text })));
}
export function validateIllustrationPlan(plan: IllustrationPlan, candidates: PaperBlock[], digest: PaperDigest, blocks: PaperBlock[]) {
  const sources = new Set(blocks.map(block => block.id)); const visualIds = new Set(candidates.map(block => block.id));
  const claims = illustrationAnchors(digest);
  const seen = new Set<string>();
  for (const visual of plan.selections) {
    const claim = claims.find(claim => claim.id === visual.after_claim_id);
    if (!visualIds.has(visual.block_id)) throw new Error("选中的图表没有可靠的原文定位");
    if (seen.has(visual.block_id)) throw new Error("图表重复");
    if (!claim) throw new Error("图表必须插入已有研究问题、方法、实验或局限段落");
    if (!visual.evidence_block_ids.includes(visual.block_id) || visual.evidence_block_ids.some(id => !sources.has(id))) throw new Error("图下解释引用了未知出处或遗漏图表自身");
    seen.add(visual.block_id);
  }
}
const normalized = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
export function validateIllustrationReview(review: IllustrationReview, draft: IllustrationPlan, candidates: PaperBlock[], digest: PaperDigest, blocks: PaperBlock[]): PaperIllustration[] {
  if (!review.publishable || review.blockers.length) throw new Error(`图表核查未通过：${review.blockers.join("；")}`);
  validateIllustrationPlan(review.final, candidates, digest, blocks);
  const draftIds = new Set(draft.selections.map(item => item.block_id));
  const checks = new Map(review.checks.map(check => [check.block_id, check]));
  if (checks.size !== review.checks.length || checks.size !== draftIds.size || [...checks.keys()].some(id => !draftIds.has(id))) throw new Error("核查没有逐张覆盖初选图表");
  const finalIds = new Set(review.final.selections.map(item => item.block_id));
  for (const [id, check] of checks) if ((check.verdict === "rejected") === finalIds.has(id)) throw new Error("核查判定与最终图表不一致");
  const byId = new Map(blocks.map(block => [block.id, block]));
  return review.final.selections.map(item => {
    if (!draftIds.has(item.block_id)) throw new Error("核查偷偷增加了未经初选的图表");
    const check = checks.get(item.block_id)!;
    if (!check.quotes.length) throw new Error("图表解释没有原文核查摘录");
    for (const q of check.quotes) {
      const source = byId.get(q.block_id);
      if (!source || !normalized(q.quote) || !item.evidence_block_ids.includes(q.block_id)
        || ![source.text, source.caption ?? ""].some(text => normalized(text).includes(normalized(q.quote)))) throw new Error("图表核查摘录不存在于对应原文");
    }
    return { ...item, bbox: candidates.find(block => block.id === item.block_id)!.bbox,
      explanation: `${item.reading_guide} ${item.takeaway} ${item.caveat}` };
  });
}
