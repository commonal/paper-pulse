// Enqueue an explicit reread through the default workflow. Paid calls execute in the worker.
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sql, closeDb } from "@aihot/backend/db";
import { REPO_ROOT } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { coveredMaterial, PAPER_SKILL_VERSION } from "../modules/papers/backend/skill-reading.ts";
import { materialByPaperId } from "../modules/papers/backend/material.ts";
import { digestByPaperId } from "../modules/papers/backend/digest.ts";
import { enqueuePaperDigest } from "../modules/papers/backend/queue.ts";

const { values } = parseArgs({ options: { paper: { type: "string" }, "visual-notes": { type: "string" }, "review-corrections": { type: "string" } } });
const id = z.uuid().parse(values.paper);
try {
  const material = await materialByPaperId(id);
  if (!material) throw new Error("论文正文不存在");
  const input = coveredMaterial(material);
  const notes = values["visual-notes"] ? z.array(z.object({ blockId: z.string(), page: z.number().int().positive(),
    pdfSha256: z.string().regex(/^[a-f0-9]{64}$/), text: z.string().trim().min(1).max(2000) })).max(10)
    .parse(JSON.parse(await readFile(values["visual-notes"], "utf8"))) : [];
  const folder = path.join(REPO_ROOT, ".data/eval/paper-reading", id);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "baseline.json"), JSON.stringify({ digest: await digestByPaperId(id), material }, null, 2), { flag: "wx" })
    .catch(error => { if (error.code !== "EEXIST") throw error; });
  const corrections = values["review-corrections"] ? z.object({ receiptId: z.number().int().positive(), changes: z.array(z.object({
    claimId: z.string().min(1), reason: z.string().trim().min(1).max(600),
    claim: z.object({ text: z.string().trim().min(1).max(800), evidence_block_ids: z.array(z.string().min(1)).max(8) }).optional(),
    quotes: z.array(z.object({ block_id: z.string().min(1), quote: z.string().trim().min(1).max(1200) })).max(8),
  })).max(40) }).parse(JSON.parse(await readFile(values["review-corrections"], "utf8"))) : undefined;
  const queued = await enqueuePaperDigest(id, { reread:true, visualNotes:notes, reviewCorrections:corrections });
  console.log(JSON.stringify({ queued, paperId: id, skillVersion: PAPER_SKILL_VERSION, inputChars: input.coverage.input_chars,
    includedBlocks: input.coverage.included_blocks, visualNotes: notes.length, expectedModelCalls: {reading:2,illustrations:"0–2"}, artifacts: folder }));
} finally { await stopBoss(); await closeDb(); }
