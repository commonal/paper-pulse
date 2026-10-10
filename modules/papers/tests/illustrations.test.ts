import { stub, tag } from "../../../tests/setup.ts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { paperIllustrationQueue, enqueuePaperIllustrations } from "../backend/queue.ts";
import { illustrationState, savedPaperIllustrations } from "../backend/illustrations.ts";
import { illustrationSignature } from "../backend/illustration-plan.ts";
import type { Paper, PaperMaterial, PaperDigest } from "../types.ts";

let reject = false; let stale = false;let invalidQuote=false;let reviewReason='原文支持';
const provider = await stub(async (_hit, request) => {
  const user = JSON.parse(JSON.parse(request.body).messages[1].content);
  const id = user.candidates[0].block_id;
  const plan = { selections: [{ block_id: id, after_claim_id: "e1", title: "表1｜主实验结果", selection_reason: "直接支持主要结论。",
    reading_guide: "看准确率列和评估条件。", takeaway: "留出集上的准确率为90%。", caveat: "不能推广到所有数据集。", evidence_block_ids: [id] }], reason: "主要结果最值得展示。" };
  if (user.draft && stale) await sql`UPDATE paper_digests SET sections='[]'::jsonb WHERE paper_id=${user.paper.id}`;
  const result = user.draft ? { publishable: !reject, blockers: reject ? ["指标条件无法确认"] : [],
    checks: [{ block_id: id, verdict: "supported", reason: reviewReason, quote_ids: [invalidQuote?'unknown-fragment':id+':text:0'] }], final: plan } : plan;
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 100, completion_tokens: 200 } };
});
process.env.LLM_BASE_URL = provider.url; process.env.LLM_API_KEY = "test-key"; process.env.LLM_MODEL = "fixture";
config.modelCallsEnabled = true;
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

async function fixture(withVisual = true) {
  const id = randomUUID();
  const [paper] = await sql<Paper[]>`INSERT INTO papers (id,title,source_url,pdf_data,pdf_sha256) VALUES (${id},'Auto illustration',${`https://example.org/${tag()}`},${Buffer.from('%PDF-1.4 fixture')},'current') RETURNING *`;
  paper.has_pdf = true;
  const blocks = [{ id: "t1", kind: withVisual ? "table" : "text", text: "Accuracy is 90% on the held-out dataset.", caption: "Table 1: Results.", page: 2, bbox: [100, 100, 900, 400], locator: "fixture", section_path: ["Experiments"] }];
  const [material] = await sql<PaperMaterial[]>`INSERT INTO paper_materials (paper_id,status,parser,blocks) VALUES (${id},'ready','mineru_api',${sql.json(blocks)}) RETURNING *`;
  const sections = [{ id: "experiments", title: "实验", claims: [{ id: "e1", text: "留出集准确率90%。", support: "direct", evidence_block_ids: ["t1"] }] }];
  const [digest] = await sql<PaperDigest[]>`INSERT INTO paper_digests (paper_id,status,sections,material_updated_at) VALUES (${id},'ready',${sql.json(sections)},${material.updated_at}) RETURNING *`;
  const old = [{ block_id: "t1", after_claim_id: "e1", title: "旧图表", explanation: "已存在的解释" }];
  await sql`INSERT INTO paper_illustrations (paper_id,status,input_signature,selections,prompt_version)
    VALUES (${id},'ready',${illustrationSignature(paper, material, digest)},${sql.json(old)},'old-version')`;
  return { id, paper, material, digest };
}

test("worker自动初选、解释和原文核查，原子保存，并在再次执行时零额外请求", async () => {
  const { id } = await fixture(); const before = provider.hits();
  const result = await paperIllustrationQueue.run([{ paperId: id }]) as { status: string }[];
  assert.equal(result[0]!.status, "ready"); assert.equal(provider.hits() - before, 2);
  const row = (await illustrationState(id))!;
  assert.equal(row.selections[0]!.reading_guide, "看准确率列和评估条件。");
  const [receipt] = await sql`SELECT status,request FROM receipts WHERE id=${row.receipt_id}`;
  assert.equal(receipt.status, "completed"); assert.equal(receipt.request.paperIllustrations.checks.length, 1);
  await paperIllustrationQueue.run([{ paperId: id }]);
  assert.equal(provider.hits() - before, 2);
  await sql`UPDATE receipts SET status='failed' WHERE id=${row.receipt_id}`;
  await sql`UPDATE paper_illustrations SET status='failed' WHERE paper_id=${id}`;
  await enqueuePaperIllustrations(id);
  await paperIllustrationQueue.run([{ paperId: id }]);
  assert.equal(provider.hits() - before, 2);
  assert.equal((await illustrationState(id))!.status, "ready");
  assert.equal(await enqueuePaperIllustrations(id), false);
  assert.equal(provider.hits() - before, 2);
  await sql`UPDATE receipts SET status='failed' WHERE subject=${`paper:${id}`} AND purpose='paper_illustrations_select'`;
  await sql`UPDATE paper_illustrations SET status='failed' WHERE paper_id=${id}`;
  await enqueuePaperIllustrations(id);
  await paperIllustrationQueue.run([{paperId:id}]);
  assert.equal(provider.hits()-before,2);
});

test('完整的较长审校说明保留真实引文，重新核查复用已保存回答',async()=>{
  const {id}=await fixture();const before=provider.hits();reviewReason='核查指标、对照与条件。'.repeat(60);
  try{
    await paperIllustrationQueue.run([{paperId:id}]);const state=(await illustrationState(id))!;
    assert.equal(state.status,'ready');assert.equal(provider.hits()-before,2);
    const [receipt]=await sql`SELECT request FROM receipts WHERE id=${state.receipt_id}`;
    assert.ok(receipt.request.paperIllustrations.checks[0].reason.length>500);
    assert.equal(receipt.request.paperIllustrations.checks[0].quotes[0].quote,'Accuracy is 90% on the held-out dataset.');
    await sql`UPDATE receipts SET status='failed' WHERE id=${state.receipt_id}`;
    await sql`UPDATE paper_illustrations SET status='failed' WHERE paper_id=${id}`;
    await enqueuePaperIllustrations(id);await paperIllustrationQueue.run([{paperId:id}]);
    assert.equal((await illustrationState(id))!.status,'ready');assert.equal(provider.hits()-before,2);
  }finally{reviewReason='原文支持';}
});

test("旧版图表显式升级入队后可轮询，旧布局保留而已完成新版不重复入队", async () => {
  const { id } = await fixture();
  assert.equal(await enqueuePaperIllustrations(id), true);
  const row=(await illustrationState(id))!;
  assert.equal(row.status, "queued"); assert.equal(row.selections[0]!.title, "旧图表");
});

test("原文核查失败时保留已展示的图表及完整文章，不发布初稿", async () => {
  const { id } = await fixture(); reject = true;
  try {
    const result = await paperIllustrationQueue.run([{ paperId: id }]) as { status: string }[];
    assert.equal(result[0]!.status, "failed");
    const row = (await illustrationState(id))!;
    assert.equal(row.selections[0]!.title, "旧图表");
    const [digest] = await sql`SELECT status FROM paper_digests WHERE paper_id=${id}`;
    assert.equal(digest.status, "ready");
  } finally { reject = false; }
});

test("预算等待持久化且保留旧图表，没有可靠候选时不发送任何模型请求", async () => {
  const { id } = await fixture(); const before = provider.hits();
  await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;
  try {
    const result = await paperIllustrationQueue.run([{ paperId: id }]) as { status: string }[];
    assert.equal(result[0]!.status, "waiting"); assert.equal((await illustrationState(id))!.status, "queued");
    assert.equal((await illustrationState(id))!.selections[0]!.title, "旧图表");
    assert.equal(provider.hits(), before);
  } finally { await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`; }
  const empty = await fixture(false);
  await paperIllustrationQueue.run([{ paperId: empty.id }]);
  assert.equal(provider.hits(), before); assert.equal((await illustrationState(empty.id))!.status, "unavailable");
});

test('图表核查只能选择给定原文片段，未知编号被拦截并保留旧图表',async()=>{
  const {id}=await fixture();invalidQuote=true;
  try{await paperIllustrationQueue.run([{paperId:id}]);const state=(await illustrationState(id))!;assert.equal(state.status,'failed');assert.ok(state.error!.includes('未知原文片段'));assert.equal(state.selections[0].title,'旧图表');}
  finally{invalidQuote=false;}
});

test("核查期间正文解读改变时不发布，读取也不会显示旧输入的图表", async () => {
  const { id, paper, material, digest } = await fixture(); stale = true;
  try {
    const result = await paperIllustrationQueue.run([{ paperId: id }]) as { status: string }[];
    assert.equal(result[0]!.status, "failed");
    assert.equal((await illustrationState(id))!.selections[0]!.title, "旧图表");
    assert.equal(await savedPaperIllustrations(paper, material, { ...digest, sections: [] }), null);
  } finally { stale = false; }
});
