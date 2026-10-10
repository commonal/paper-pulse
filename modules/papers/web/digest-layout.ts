import type { PaperBlock, PaperDigestSection, PaperIllustration } from "../types.ts";

/** A repeated source keeps its number throughout the article; unavailable sources are not clickable. */
export function citationNumbers(sections: PaperDigestSection[], blocks: PaperBlock[], illustrations: PaperIllustration[] = []) {
  const available = new Set(blocks.map(block => block.id));
  const numbers = new Map<string, number>();
  for (const section of sections) for (const claim of section.claims) {
    if (claim.support === "not_stated") continue;
    for (const id of claim.evidence_block_ids) if (available.has(id) && !numbers.has(id)) numbers.set(id, numbers.size + 1);
  }
  for (const visual of illustrations) for (const id of visual.evidence_block_ids ?? []) {
    if (available.has(id) && !numbers.has(id)) numbers.set(id, numbers.size + 1);
  }
  return numbers;
}
