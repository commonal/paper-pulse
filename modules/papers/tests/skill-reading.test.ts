import { stub, tag } from "../../../tests/setup.ts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { coveredMaterial, validateReadingReview, PAPER_SKILL_VERSION } from "../backend/skill-reading.ts";
import { normalizeMineruContent } from "../backend/mineru.ts";
import { paperDigestQueue, enqueuePaperDigest } from "../backend/queue.ts";
import type { PaperBlock, PaperMaterial } from "../types.ts";

const text = "The experiment reports an accuracy of 90% on the held-out dataset.";
const block: PaperBlock = { id: "b1", kind: "text", text, section_path: ["Experiments"], locator: "fixture:1", page: 1 };
const material: PaperMaterial = { paper_id: "test", status: "ready", parser: "fixture", markdown: text, blocks: [block], error: null, receipt_id: null, updated_at: new Date().toISOString() };
const sectionIds = ["summary", "problem", "method", "experiments", "limitations"];
const draft = (id: string) => ({ title_zh: "检索方法的实验评估", summary_zh: "研究检索方法并评估其准确率。", sections: sectionIds.map((key, i) => ({ id: key,
  title: ["一句话结论", "研究问题", "核心方法", "实验设置与结果", "局限与边界"][i]!,
  claims: [{ id: `claim-${key}`, text: "留出数据集上的准确率为90%。", support: "direct" as const, evidence_block_ids: [id] }],
})) });
const review = (id: string) => ({ publishable: true, blockers: [], final: draft(id), checks: sectionIds.map(key => ({ claim_id: `claim-${key}`,
  verdict: "supported" as const, reason: "原文给出了相应指标和条件。", quotes: [{ block_id: id, quote: text }] })) });
let rejectReview = false;
let quoteMismatch = false;
const requests: Record<string, any>[] = [];
const provider = await stub((_hit, request) => {
  const body = JSON.parse(request.body); requests.push(body);
  const user = JSON.parse(body.messages[1].content);
  const id = user.material ? user.material.match(/\[([^ |]+) \|/)![1] : user.source_evidence[0].block_id;
  const result = user.draft ? { ...review(id), publishable: !rejectReview, blockers: rejectReview ? ["关键数字没有依据"] : [] } : draft(id);
  if ("checks" in result) { for (const check of result.checks) (check as any).quote_ids = [`${id}:text:0`]; if (quoteMismatch) (result.checks[0] as any).quote_ids = ["unknown-quote"]; }
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 100, completion_tokens: 200 } };
});
process.env.LLM_BASE_URL = provider.url;
process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "test-model";
config.modelCallsEnabled = true;
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

test("MinerU text_level 标题被保留，重新归一化不会改变原有证据ID", () => {
  const items = [{ type: "text", text: "4 EXPERIMENTS", text_level: 2, page_idx: 3 }, { type: "text", text, page_idx: 3 }];
  const blocks = normalizeMineruContent(items, "paper", {});
  assert.equal(blocks[0]!.kind, "heading");
  assert.deepEqual(blocks[1]!.section_path, ["4 EXPERIMENTS"]);
  const before = normalizeMineruContent(items.map(item => ({ ...item, text_level: undefined })), "paper", {});
  assert.deepEqual(blocks.map(item => item.id), before.map(item => item.id));
});

test("覆盖检查明确省略参考文献，保留正文和附录，不静默裁剪过长材料", () => {
  const input = coveredMaterial({ ...material, blocks: [block, { ...block, id: "ref", section_path: ["REFERENCES"] }, { ...block, id: "appendix", section_path: ["A.1 EXTRA RESULTS"], page: 20 }] });
  assert.deepEqual(input.coverage.omitted_bibliography_ids, ["ref"]);
  assert.ok(input.blockIds.has("appendix")); assert.equal(input.coverage.truncated, false);
  assert.throws(() => coveredMaterial({ ...material, blocks: [{ ...block, text: "x".repeat(180_001) }] }), /不能静默裁剪/);
});

test("核查必须覆盖每个主张，原文摘录真实且属于最终引用", () => {
  assert.equal(validateReadingReview(review("b1"), draft("b1"), [block]).length, 5);
  const missing = review("b1"); missing.checks.pop();
  assert.throws(() => validateReadingReview(missing, draft("b1"), [block]), /重复或缺失/);
  const fake = review("b1"); fake.checks[0]!.quotes[0]!.quote = "Accuracy is 99%.";
  assert.throws(() => validateReadingReview(fake, draft("b1"), [block]), /不存在于原文/);
  const unrelated = review("b1"); unrelated.checks[0]!.quotes[0]!.block_id = "other";
  assert.throws(() => validateReadingReview(unrelated, draft("b1"), [block, { ...block, id: "other" }]), /未对应最终引用/);
});

async function runReading(id: string, reviewCorrections?: import("../types.ts").ReadingOptions["reviewCorrections"]) { await enqueuePaperDigest(id,{reread:true,reviewCorrections}); return paperDigestQueue.run([{paperId:id}]); }
async function paper() {
  const id = randomUUID();
  await sql`INSERT INTO papers (id,title,source_url) VALUES (${id},'Skill pilot fixture',${`https://example.org/${tag()}`})`;
  await sql`INSERT INTO paper_materials (paper_id,status,parser,blocks) VALUES (${id},'ready','fixture',${sql.json([{ ...block, id }])})`;
  await sql`INSERT INTO paper_digests (paper_id,status,sections,prompt_version) VALUES (${id},'ready',${sql.json(draft(id).sections)},'previous-version')`;
  return id;
}

test("worker执行精读和原文核查两阶段，成功后保存到现有解读及双语展示", async () => {
  const id = await paper(); const hits = provider.hits();
  await runReading(id);
  const [digest] = await sql`SELECT status,prompt_version,receipt_id FROM paper_digests WHERE paper_id=${id}`;
  assert.equal(digest.status, "ready"); assert.equal(digest.prompt_version, PAPER_SKILL_VERSION);
  assert.equal(provider.hits() - hits, 2);
  const [receipt] = await sql`SELECT status,purpose FROM receipts WHERE id=${digest.receipt_id}`;
  assert.equal(receipt.status, "completed"); assert.equal(receipt.purpose, "paper_skill_review");
  const [presentation] = await sql`SELECT status,title_zh FROM paper_presentations WHERE paper_id=${id}`;
  assert.equal(presentation.status, "ready"); assert.equal(presentation.title_zh, "检索方法的实验评估");
  const input = JSON.parse(requests.at(-1)!.messages[1].content);
  assert.ok(input.draft); assert.match(JSON.stringify(input.source_evidence), /90%/);
  // A complete answer once rejected by an older schema can be revalidated without paying again.
  await sql`UPDATE receipts SET status='failed' WHERE subject=${`paper:${id}`} AND purpose='paper_skill_read'`;
  const beforeRecovery = provider.hits();
  await runReading(id);
  assert.equal(provider.hits(), beforeRecovery);
  const [recovered] = await sql`SELECT status FROM receipts WHERE subject=${`paper:${id}`} AND purpose='paper_skill_read'`;
  assert.equal(recovered.status, "completed");
});

test('精确重放保留有真实原文依据的人工简介校订，拒绝不匹配的原文，不新增付费请求',async()=>{
  const id=await paper();await runReading(id);
  const [presentation]=await sql`SELECT summary_zh,receipt_id FROM paper_presentations WHERE paper_id=${id}`;
  const correction={field:'summary_zh',previous:presentation.summary_zh,accepted:'在留出数据集上，原文报告准确率90%。',reason:'逐字核对原文实验条件',blockId:id,quote:text};
  await sql`UPDATE receipts SET request=request||${sql.json({paperPresentationCorrection:correction})}::jsonb WHERE id=${presentation.receipt_id}`;
  const before=provider.hits();await runReading(id);assert.equal(provider.hits(),before);
  assert.equal((await sql`SELECT summary_zh FROM paper_presentations WHERE paper_id=${id}`)[0].summary_zh,correction.accepted);
  await sql`UPDATE receipts SET request=request||${sql.json({paperPresentationCorrection:{...correction,quote:'A fabricated finding.'}})}::jsonb WHERE id=${presentation.receipt_id}`;
  const result=await runReading(id) as {status:string}[];assert.equal(result[0]!.status,'failed');assert.equal(provider.hits(),before);
  assert.equal((await sql`SELECT summary_zh FROM paper_presentations WHERE paper_id=${id}`)[0].summary_zh,correction.accepted);
});

test("核查失败保留原有ready解读，不将初稿发布或自动付费修复", async () => {
  const id = await paper(); const hits = provider.hits(); rejectReview = true;
  try {
    const result = await runReading(id) as { status: string }[];
    assert.equal(result[0]!.status, "failed");
    const [digest] = await sql`SELECT status,prompt_version FROM paper_digests WHERE paper_id=${id}`;
    assert.equal(digest.status, "ready"); assert.equal(digest.prompt_version, "previous-version");
    assert.equal(provider.hits() - hits, 2);
    const [receipt] = await sql`SELECT status FROM receipts WHERE subject=${`paper:${id}`} AND purpose='paper_skill_review'`;
    assert.equal(receipt.status, "failed");
  } finally { rejectReview = false; }
});

test("预算熔断保留旧页面内容，且不会发出模型请求", async () => {
  const id = await paper(); const hits = provider.hits();
  await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;
  try {
    const result = await runReading(id) as { status: string }[];
    assert.equal(result[0]!.status, "waiting"); assert.equal(provider.hits(), hits);
    const [digest] = await sql`SELECT status,prompt_version FROM paper_digests WHERE paper_id=${id}`;
    assert.equal(digest.status, "ready"); assert.equal(digest.prompt_version, "previous-version");
  } finally { await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`; }
});

test("人工摘录校订只复用相同输入的核查回执，仍校验原文且不新增付费调用", async () => {
  const id = await paper(); quoteMismatch = true;
  try {
    await runReading(id);
    const [receipt] = await sql`SELECT id,status FROM receipts WHERE subject=${`paper:${id}`} AND purpose='paper_skill_review'`;
    assert.equal(receipt.status, "failed");
    const before = provider.hits();
    await runReading(id, {
      receiptId: receipt.id, changes: [{ claimId: "claim-summary", reason: "已核查原文并恢复逐字摘录和指标条件",
        claim: { text: "准确率90%，评估条件为留出数据集。", evidence_block_ids: [id] }, quotes: [{ block_id: id, quote: text }] }],
    });
    assert.equal(provider.hits(), before);
    const [digest] = await sql`SELECT status,prompt_version FROM paper_digests WHERE paper_id=${id}`;
    assert.equal(digest.status, "ready"); assert.equal(digest.prompt_version, PAPER_SKILL_VERSION);
    const [accepted] = await sql`SELECT request,response FROM receipts WHERE id=${receipt.id}`;
    assert.equal(accepted.request.paperReadingReview.quoteCorrections.receiptId, receipt.id);
    assert.equal(JSON.parse(accepted.response.choices[0].message.content).checks[0].quote_ids[0], "unknown-quote");
    await runReading(id);
    assert.equal(provider.hits(), before);
    const [replayed] = await sql`SELECT status,error FROM receipts WHERE id=${receipt.id}`;
    assert.equal(replayed.status, "completed");
    assert.equal(replayed.error, null);
    const [published] = await sql`SELECT sections FROM paper_digests WHERE paper_id=${id}`;
    assert.equal(published.sections[0].claims[0].text, "准确率90%，评估条件为留出数据集。");
  } finally { quoteMismatch = false; }
});
