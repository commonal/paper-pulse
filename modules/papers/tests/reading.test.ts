import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildApp } from "../../../apps/api/src/app.ts";
import { installModules } from "@aihot/backend/modules";
import { config } from "@aihot/backend/config";
import papers from "../server.ts";
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { paperMaterialQueue } from "../backend/queue.ts";
import { paperTrends, runPaperDiscovery, todayQueue } from "../backend/discovery.ts";
import { paperImpactResults, runPaperImpactDiscovery } from "../backend/impact.ts";
import { zipSync, strToU8 } from "fflate";
import { parsePdfWithMineru } from "../backend/mineru.ts";
import {DIRECTIONS,HOT_DIRECTION} from '../directions.ts';
after(async () => { await stopBoss(); await closeDb(); });

test("论文、原文与私人笔记闭环，以及输入和并发边界", async () => {
  const previous = config.devAdmin;
  config.devAdmin = { displayName: "Paper test" };
  installModules([papers]); const app = await buildApp(); await app.ready();
  const headers = { "x-csrf-token": "dev" };
  let paperId = ""; let localId = "";
  try {
    const pdf = Buffer.from("%PDF-1.4\nfixture for storage test\n%%EOF");
    const input = { title: "Reading test", sourceUrl: "https://example.org/paper/v1", version: "v1", pdfBase64: pdf.toString("base64") };
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/papers", payload: input })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/papers", headers, payload: { ...input, sourceUrl: "javascript:alert(1)" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/papers", headers, payload: { ...input, pdfBase64: Buffer.from("not a pdf").toString("base64") } })).statusCode, 400);
    const created = await app.inject({ method: "POST", url: "/api/admin/papers", headers, payload: input });
    assert.equal(created.statusCode, 201); const paper = created.json(); paperId = paper.id;
    assert.equal(paper.pdf_sha256, createHash("sha256").update(pdf).digest("hex"));
    const local = await app.inject({ method: "POST", url: "/api/admin/papers", headers, payload: { title: "Local PDF", sourceUrl: "", version: "local", pdfBase64: pdf.toString("base64") } });
    assert.equal(local.statusCode, 201); localId = local.json().id; assert.equal(localId,paper.id,'相同 PDF 复用已有论文'); assert.equal(local.json().has_pdf, true);
    const repeated=await app.inject({ method: "POST", url: "/api/admin/papers", headers, payload: { ...input, sourceUrl: input.sourceUrl + "#page=2" } });
    assert.equal(repeated.statusCode,201);assert.equal(repeated.json().id,paper.id);
    const base = `/api/admin/papers/${paper.id}`;
    const read = await app.inject(base + "/pdf"); assert.equal(read.statusCode, 200); assert.deepEqual(read.rawPayload, pdf);
    assert.equal((await app.inject({ method: "POST", url: base + "/notes", headers, payload: { title: "Page", markdown: "text", page: 0 } })).statusCode, 400);
    const added = await app.inject({ method: "POST", url: base + "/notes", headers, payload: { title: "Method", markdown: "**理解**\n<script>alert(1)</script>\n[bad](javascript:alert(2))", page: 3 } });
    assert.equal(added.statusCode, 201); const note = added.json();
    assert.equal(note.version, "v1"); assert.equal(note.pdf_sha256, paper.pdf_sha256);
    assert.ok(note.html.includes("<strong>理解</strong>")); assert.ok(!note.html.includes("<script")); assert.ok(!note.html.includes('href="javascript:'));
    const update = { title: "Method updated", markdown: "已核对原文", page: 4, revision: 1 };
    assert.equal((await app.inject({ method: "PATCH", url: base + "/notes/" + note.id, headers, payload: update })).statusCode, 200);
    assert.equal((await app.inject({ method: "PATCH", url: base + "/notes/" + note.id, headers, payload: update })).statusCode, 409);
    assert.equal((await app.inject({ method: "PATCH", url: base + "/status", headers, payload: { status: "reading" } })).statusCode, 200);
    const d = (await app.inject(base)).json(); assert.equal(d.notes[0].revision, 2); assert.equal(d.notes[0].page, 4); assert.equal(d.paper.status, "reading");
    const exported = await app.inject(base + "/notes.md");
    assert.equal(exported.statusCode, 200); assert.match(exported.headers["content-disposition"]!, /attachment/);
    assert.match(exported.body, /已核对原文/); assert.match(exported.body, /PDF 第 4 页/);
    assert.equal((await app.inject("/api/admin/papers/not-a-uuid")).statusCode, 400);
    config.devAdmin = null;
    for (const url of ["/api/admin/papers", base, base + "/pdf", base + "/notes.md"]) assert.equal((await app.inject(url)).statusCode, 401);
  } finally {
    const { sql } = await import("@aihot/backend/db");
    if (paperId || localId) await sql`DELETE FROM papers WHERE id IN (${paperId || null}, ${localId || null})`;
    config.devAdmin = previous; installModules([]); await app.close();
  }
});

test("arXiv 导入预览只返回元数据，不提前创建论文", async () => {
  const previous = config.devAdmin; const previousFetch = globalThis.fetch;
  config.devAdmin = { displayName: "Paper preview test" };
  globalThis.fetch = (async () => new Response(`<?xml version="1.0"?><feed><entry>
    <id>https://arxiv.org/abs/2401.00001v2</id><title> A Test Paper </title>
    <published>2024-01-01T00:00:00Z</published><summary> A short abstract. </summary>
    <author><name>First Author</name></author><author><name>Second Author</name></author>
  </entry></feed>`, { status: 200, headers: { "content-type": "application/atom+xml" } })) as typeof fetch;
  installModules([papers]); const app = await buildApp(); await app.ready();
  try {
    const response = await app.inject({ method: "POST", url: "/api/admin/papers/import-preview", headers: { "x-csrf-token": "dev" },payload:{input:'https://arxiv.org/abs/2401.00001v2'} });
    assert.equal(response.statusCode, 200);
    const {source_url,pdf_url,title,authors,published,abstract,version,source_kind}=response.json().result.candidates[0];
    assert.deepEqual({source_url,pdf_url,title,authors,published,abstract,version,source_kind}, {
      source_url: "https://arxiv.org/abs/2401.00001v2", pdf_url: "https://arxiv.org/pdf/2401.00001v2",
      title: "A Test Paper", authors: "First Author, Second Author", published: "2024-01-01",
      abstract: "A short abstract.", version: "v2", source_kind: "arxiv",
    });
  } finally { globalThis.fetch = previousFetch; config.devAdmin = previous; installModules([]); await app.close(); }
});

test("API 将论文解析持久化入队，worker 处理后保留正文证据块", async () => {
  const previous = config.devAdmin; const previousFetch = globalThis.fetch;
  config.devAdmin = { displayName: "Paper material test" };
  const html = `<article><section class="ltx_section"><h2 class="ltx_title_section">Method</h2>
    <p class="ltx_p">The first paragraph describes the method and its inputs.</p>
    <p class="ltx_p">The second paragraph explains the training procedure in detail.</p>
    <p class="ltx_p">The third paragraph reports the evaluation protocol and result.</p></section></article>`;
  globalThis.fetch = (async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
  installModules([papers]); const app = await buildApp(); await app.ready(); let paperId = "";
  try {
    const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF");
    const created = await app.inject({ method: "POST", url: "/api/admin/papers", headers: { "x-csrf-token": "dev" }, payload: {
      title: "Material test", sourceUrl: "https://arxiv.org/abs/2401.00002v1", version: "v1", pdfBase64: pdf.toString("base64"),
    } });
    assert.equal(created.statusCode, 201); paperId = created.json().id;
    const queued = await app.inject({ method: "POST", url: `/api/admin/papers/${paperId}/material`, headers: { "x-csrf-token": "dev" }, payload: {} });
    assert.equal(queued.statusCode, 202); assert.deepEqual(queued.json(), { status: "queued" });
    const result = await paperMaterialQueue.run([{ paperId }]);
    assert.match(JSON.stringify(result), /digest_queued/);
    const material = (await app.inject(`/api/admin/papers/${paperId}`)).json().material;
    assert.equal(material.status, "ready"); assert.equal(material.parser, "arxiv-html-lite"); assert.equal(material.blocks.length, 3);
    assert.match(material.markdown, /evaluation protocol/); assert.equal((await app.inject(`/api/admin/papers/${paperId}`)).json().material.status, "ready");
  } finally {
    globalThis.fetch = previousFetch; const { sql } = await import("@aihot/backend/db"); if (paperId) await sql`DELETE FROM papers WHERE id = ${paperId}`;
    config.devAdmin = previous; installModules([]); await app.close();
  }
});

test("arXiv 自动发现按计划去重、每日限额入队并保存趋势计数", async () => {
  const previous = config.devAdmin; const previousFetch = globalThis.fetch;
  config.devAdmin = { displayName: "Paper discovery test" };
  const ids = ["2601.90001v1", "2601.90002v1", "2601.90003v1", "2601.90004v1"];
  let entries = ids.map((id, i) => {
    const title = ["Retrieval Augmented Generation for Search", "A Multimodal Vision Language Model", "Generative Recommendation with Large Language Models", "Learning with AI Systems"][i];
    const category = ["cs.IR", "cs.CV", "cs.AI", "cs.LG"][i];
    return `<entry><id>http://arxiv.org/abs/${id}</id><title>${title}</title><published>2026-10-05T00:00:00Z</published><summary>Evidence-based methods and evaluation results.</summary><author><name>Author ${i + 1}</name></author><category term="${category}"/></entry>`;
  }).join("");
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>42</opensearch:totalResults>${entries}</feed>`, {
      status: 200, headers: { "content-type": "application/atom+xml" },
    });
  }) as typeof fetch;
  installModules([papers]); const app = await buildApp(); await app.ready();
  try {
    const headers = { "x-csrf-token": "dev" };
    const plans = await app.inject({ url: "/api/admin/papers/plans" });
    assert.equal(plans.statusCode, 200);
    assert.deepEqual(plans.json().plans.map((plan: { id: string }) => plan.id).sort(), [HOT_DIRECTION.id,...DIRECTIONS.map(d=>d.id)].sort());
    const quota = await app.inject({ method: "PATCH", url: "/api/admin/papers/settings", headers, payload: { daily_limit: 3, hot_limit: 1, candidate_days: 7 } });
    assert.equal(quota.statusCode, 200);
    const summary = await runPaperDiscovery(new Date(),{requestIntervalMs:0});
    assert.equal(summary.plans.length, 4);
    assert.equal(calls.length, 8);
    assert.ok(calls.every((url) => url.includes("export.arxiv.org/api/query")));
    assert.equal(summary.selected, 3);
    const { sql: candidateDb } = await import("@aihot/backend/db");
    const [unselected] = await candidateDb`SELECT count(*)::int AS count FROM paper_materials m JOIN papers p ON p.id = m.paper_id
      WHERE p.arxiv_id LIKE '2601.9000%' AND m.status = 'unavailable'`;
    assert.equal(unselected.count, 1, "discovered candidates must not masquerade as queued paid work");
    const queue = await todayQueue();
    assert.equal(queue.length, 3);
    const queueRows = queue as unknown as Array<{ paper_id: string; source_kind: string }>;
    assert.equal(new Set(queueRows.map((row) => row.paper_id)).size, 3);
    assert.equal(queueRows.filter((row) => row.source_kind === "hot").length, 1);
    assert.equal(queueRows.filter((row) => row.source_kind === "personal").length, 2);
    const trends = await paperTrends();
    assert.equal(trends.length, 4);
    const trendRows = trends as unknown as Array<{ recent_count: number | null; previous_count: number | null }>;
    assert.ok(trendRows.every((row) => row.recent_count !== null && row.previous_count !== null));
    const { sql } = await import("@aihot/backend/db");
    entries = entries.replace("2601.90001v1", "2601.90001v2");
    const repeated = await runPaperDiscovery(new Date(),{requestIntervalMs:0,refresh:true});
    assert.equal(repeated.selected, 0, "same candidates must not re-enter the queue during the candidate window");
    assert.equal(calls.length, 16);
    const latest = await sql<{ count: number; version: string }[]>`SELECT count(*)::int AS count, max(version) FILTER (WHERE arxiv_id = '2601.90001') AS version FROM papers WHERE arxiv_id LIKE '2601.9000%'`;
    assert.equal(latest[0]!.count, 4, "new arXiv versions reuse the stable paper identity");
    assert.equal(latest[0]!.version, "v1",'发现新版不覆盖当前阅读版本');
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_versions v JOIN papers p ON p.id=v.paper_id WHERE p.arxiv_id='2601.90001' AND v.label='v2'`)[0].n,1);
    await sql`DELETE FROM papers WHERE arxiv_id LIKE '2601.9000%'`;
  } finally {
    globalThis.fetch = previousFetch; config.devAdmin = previous; installModules([]); await app.close();
  }
});

test("MinerU 适配器完成上传、轮询、解包与定位块归一化", async () => {
  const previousToken = process.env.MINERU_API_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.MINERU_API_TOKEN = "test-mineru-token";
  const { sql } = await import("@aihot/backend/db");
  const [previousBudget] = await sql<{ per_minute: number; per_hour: number; per_day: number; note: string }[]>`SELECT per_minute, per_hour, per_day, note FROM budgets WHERE service = 'mineru'`;
  await sql`INSERT INTO budgets (service, per_minute, per_hour, per_day, note) VALUES ('mineru', 0, 0, 0, 'test')
    ON CONFLICT (service) DO UPDATE SET per_minute = 0, per_hour = 0, per_day = 0, note = 'test'`;
  const sourceId = `paper-${Date.now()}`;
  const archive = zipSync({
    "paper_content_list.json": strToU8(JSON.stringify([
      { type: "title", text: "Method", page_idx: 1, text_level: 1, bbox: [1, 2, 3, 4] },
      { type: "text", text: "The experiment compares two settings.", page_idx: 1 },
      { type: "table", table_body: "<table><tr><td>93.2</td></tr></table>", page_idx: 2 },
    ])),
    "full.md": strToU8("# Method\n\nThe experiment compares two settings."),
    "images/figure-1.png": new Uint8Array([1, 2, 3]),
  });
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/v4/file-urls/batch")) return new Response(JSON.stringify({ code: 0, data: { batch_id: "batch-1", file_urls: ["https://upload.test/file"] } }), { status: 200 });
    if (url === "https://upload.test/file") return new Response(null, { status: 200 });
    if (url.endsWith("/v4/extract-results/batch/batch-1")) return new Response(JSON.stringify({ code: 0, data: { extract_result: [{ file_name: `paper-${sourceId}.pdf`, state: "done", full_zip_url: "https://result.test/archive.zip" }] } }), { status: 200 });
    if (url === "https://result.test/archive.zip") return new Response(archive, { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    await assert.rejects(() => parsePdfWithMineru({ pdf: Buffer.from("%PDF-1.4 fixture"), sourceId, sourceUrl: "https://arxiv.org/abs/2401.00001" }), /Budget for mineru exhausted/);
    assert.equal(calls.length, 0, "zero MinerU budget must stop before any network request");
    await sql`UPDATE budgets SET per_minute = 5, per_hour = 20, per_day = 100 WHERE service = 'mineru'`;
    const result = await parsePdfWithMineru({ pdf: Buffer.from("%PDF-1.4 fixture"), sourceId, sourceUrl: "https://arxiv.org/abs/2401.00001" });
    assert.equal(result.blocks.length, 3);
    assert.equal(result.blocks[0].kind, "heading");
    assert.equal(result.blocks[0].page, 2);
    assert.deepEqual(result.blocks[0].bbox, [1, 2, 3, 4]);
    assert.equal(result.blocks[2].kind, "table");
    assert.match(result.blocks[2].table_html!, /93\.2/);
    assert.match(result.blocks[0].locator, /^mineru:content_list\.json/);
    assert.ok(result.receiptId > 0);
    const receipt = await sql<{ status: string; service: string }[]>`SELECT status, service FROM receipts WHERE id = ${result.receiptId}`;
    assert.deepEqual(receipt[0], { status: "completed", service: "mineru" });
    assert.equal(calls.filter((call) => call.startsWith("GET ")).length, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.MINERU_API_TOKEN; else process.env.MINERU_API_TOKEN = previousToken;
    await sql`DELETE FROM receipts WHERE service = 'mineru' AND subject = ${`paper:${sourceId}`}`;
    if (previousBudget) await sql`UPDATE budgets SET per_minute = ${previousBudget.per_minute}, per_hour = ${previousBudget.per_hour}, per_day = ${previousBudget.per_day}, note = ${previousBudget.note} WHERE service = 'mineru'`;
    else await sql`DELETE FROM budgets WHERE service = 'mineru'`;
  }
});

test("OpenAlex 影响力候选只收录 CCF A 来源并保留引用口径", async () => {
  const previousFetch = globalThis.fetch;
  const { sql } = await import("@aihot/backend/db");
  const id = "W998877665544";
  await sql`DELETE FROM paper_impact_candidates WHERE openalex_id = ${id}`;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); calls.push(url);
    return new Response(JSON.stringify({ results: [{
      id: `https://openalex.org/${id}`, doi: "https://doi.org/10.1234/example", title: "Retrieval systems for language models",
      publication_year: 2022, publication_date: "2022-06-01", cited_by_count: 87,
      cited_by_percentile_year: { min: 0.9, max: 0.95 },
      authorships: [{ author: { display_name: "Example Author" } }],
      primary_location: { landing_page_url: "https://example.org/paper", source: {
        display_name: "Conference on Neural Information Processing Systems", type: "conference", homepage_url: "https://neurips.cc",
      } }, open_access: { oa_url: "https://example.org/open.pdf" },
    }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const status = await runPaperImpactDiscovery();
    assert.equal(status?.state, "ready");
    assert.equal(status?.candidate_count, 2, 'unrelated results returned by a source must not be attributed to every direction');
    assert.equal(calls.length, 4);
    assert.ok(calls.every(url=>{const u=new URL(url);return u.searchParams.get('sort')==='cited_by_count:desc'&&u.searchParams.get('per_page')==='100'&&u.searchParams.get('filter')!.includes('from_publication_date:1900-01-01');}));
    const data = await paperImpactResults();
    const candidate = (data.candidates as unknown as Array<{ openalex_id: string; citation_count: number; ccf_rank: string; ccf_area: string; plan_ids: string[] }>).find((item) => item.openalex_id === id);
    assert.equal(candidate?.citation_count, 87);
    assert.equal(candidate?.ccf_rank, "A");
    assert.equal(candidate?.ccf_area, "人工智能");
    assert.deepEqual(candidate?.plan_ids.sort(),['hot-ai','personal-rag']);
    await sql`DELETE FROM paper_impact_candidates WHERE openalex_id = ${id}`;
  } finally {
    globalThis.fetch = previousFetch;
    await sql`DELETE FROM paper_impact_candidates WHERE openalex_id = ${id}`;
  }
});
