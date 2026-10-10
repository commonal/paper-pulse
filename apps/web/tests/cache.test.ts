// Run after `npm run build -w @aihot/web`. Real production server/router, synthetic HTTP API only.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CATEGORY_KEYS } from "@aihot/contracts/taxonomy";
import {dailyFixture,planFixtures} from './paper-fixtures.ts';
import {dailyMessage} from '../../../modules/papers/daily.ts';
import type {Paper} from '../../../modules/papers/types.ts';
import {readingWait,requestBudget} from '../../../modules/papers/waiting.ts';
import {candidateFilters} from '../../../modules/papers/candidates.ts';
import {impactFilters} from '../../../modules/papers/impact.ts';

let web: ChildProcess;
let origin: string;
let logs = "";
let deadline: number;
let metaDelayMs = 0;
const apiCookies: Array<string | undefined> = [];
const paperReads: string[] = [];
let daily=dailyFixture();
let todayPapers:Paper[]=[];
let historicalReady=true;
let visualFixture=true;
const api = createServer((req, res) => {
  const url = new URL(req.url!, "http://api.local");
  apiCookies.push(req.headers.cookie);
  res.setHeader("Content-Type", "application/json");
  if(url.pathname==='/api/admin/papers/plans'&&req.headers.cookie==='paper-session=test')return res.end(JSON.stringify({plans:planFixtures(),settings:{daily_limit:3,hot_limit:1,candidate_days:7}}));
  if(url.pathname==='/api/admin/me'&&req.headers.cookie==='paper-session=test')return res.end(JSON.stringify({csrf:'test',displayName:'test'}));
  if(url.pathname==='/api/admin/papers/visual-fixture'&&req.headers.cookie==='paper-session=test'){
    paperReads.push(url.pathname+url.search);
    return res.end(JSON.stringify({paper:{id:'visual-fixture',title:'Visual paper',authors:'Author',published:'2026-10-08',topic:'RAG',abstract:'',source_url:'',pdf_url:'',code_url:'',version:'v1',status:'unread',has_pdf:true,pdf_sha256:'pdf',active_version_id:'current',created_at:'2026-10-08'},
      is_current_version:url.searchParams.get('version')!=='old',viewing_version_id:url.searchParams.get('version')??'current',illustration_mode:'vision',versions:[],notes:[],
      reading_task:{status:'ready',stage:'complete',updated_at:'2026-10-09',options:{},coverage:{}},digest:{status:'ready',sections:[{id:'experiments',title:'实验',claims:[{id:'e1',text:'实验结论',support:'direct',evidence_block_ids:['img']}]}]},
      material:{status:'ready',parser:'mineru_api',blocks:[{id:'img',text:'Result table.',page:1,section_path:['Experiments'],kind:'table',bbox:[100,100,900,500]}]},illustration_status:'ready',
      illustrations:[{block_id:'img',after_claim_id:'e1',title:'主结果表',reading_guide:'查看列标题',takeaway:'作者报告的结果',caveat:'仅限该设置',evidence_block_ids:['img'],
        ...(visualFixture?{input_basis:'vision',visual_reading:{kind:'table',observations:['原图可见模型与准确率两列'],text_context:['正文补充了实验设置'],unreadable:['图中未标置信区间'],conflicts:[]}}:{})}]}));
  }
  if(url.pathname==='/api/admin/papers/version-fixture'&&req.headers.cookie==='paper-session=test'){
    paperReads.push(url.pathname+url.search);
    return res.end(JSON.stringify({paper:{id:'version-fixture',title:'Historical paper',authors:'Author',published:'2026-10-08',topic:'RAG',abstract:'',source_url:'',pdf_url:'',code_url:'',version:'v1',status:'unread',has_pdf:true,pdf_sha256:'old',active_version_id:'current',created_at:'2026-10-08'},
      versions:[{id:'old',label:'旧原文',kind:'preprint',has_pdf:true,has_reading:historicalReady,is_current:false},{id:'current',label:'当前原文',kind:'published',has_pdf:true,has_reading:false,is_current:true}],
      viewing_version_id:'old',is_current_version:false,notes:[],material:historicalReady?{status:'ready',parser:'mineru_api',blocks:[]}:null,
      digest:historicalReady?{status:'ready',sections:[]}:null,illustration_status:'failed',illustration_error:'test',reading_task:null}));
  }
  if(url.pathname==='/api/admin/papers/repair-fixture'&&req.headers.cookie==='paper-session=test'){
    paperReads.push(url.pathname+url.search);
    const sections=['summary','problem','method','experiments','limitations'].map((id,i)=>({id,title:['一句话结论','研究问题','核心方法','实验设置与结果','局限与边界'][i],claims:[{id,text:'待核查论文结论',support:id==='limitations'?'not_stated':'direct',evidence_block_ids:['source']}]}));
    const manuscript={title_zh:'论文核查测试',summary_zh:'核对论文结论和证据边界。',sections};
    return res.end(JSON.stringify({paper:{id:'repair-fixture',title:'Repair paper',authors:'Author',published:'2026-10-08',topic:'RAG',abstract:'',source_url:'',pdf_url:'',code_url:'',version:'v1',status:'unread',has_pdf:true,pdf_sha256:'pdf',active_version_id:'current',created_at:'2026-10-08'},
      viewing_version_id:url.searchParams.get('version')??'current',is_current_version:url.searchParams.get('version')!=='old',versions:[],notes:[],digest:{status:'unavailable',sections:[]},material:{status:'ready',parser:'fixture',blocks:[{id:'source',text:'Original conclusion evidence.',page:10,section_path:['Conclusion'],kind:'text'}]},
      reading_task:{status:'failed',stage:'review',updated_at:'2026-10-09T04:00:00Z',options:{reviewRepair:{receiptId:17,inputSignature:'a'.repeat(64),instructions:[{claimId:'limitations',text:'保留此前的修订建议'}]}},coverage:{included_blocks:10,reviewFailure:{receiptId:17,draftReceiptId:16,inputSignature:'a'.repeat(64),versionId:'current',skillVersion:'test',createdAt:'2026-10-09',draft:manuscript,review:{publishable:true,blockers:[],final:manuscript,checks:sections.map(s=>({claim_id:s.id,verdict:'supported',reason:'原文未报告，需区分证据类型。',quote_ids:['source:text:0']}))},issues:[{claimId:'limitations',message:'证据边界与核查不一致'}]}}}}));
  }
  if(url.pathname==='/api/admin/papers/impact'&&req.headers.cookie==='paper-session=test'){
    paperReads.push(url.pathname+url.search);return res.end(JSON.stringify({filters:impactFilters(url.searchParams),total:25,pageSize:24,
      status:{state:'ready',candidate_count:25,query_start:'1900-01-01',query_end:'2026-10-08',captured_at:'2026-10-08T00:00:00Z'},
      directions:[{id:'',title:'全部',count:25},{id:'personal-rag',title:'RAG 与信息检索',count:25}],venues:[{venue_name:'SIGIR',candidate_count:25}],
      candidates:[{openalex_id:'W123',title:'Classic retrieval fixture',authors:'Author',publication_year:2002,citation_count:5000,venue_name:'SIGIR',ccf_rank:'A',ccf_area:'数据库/内容检索',
        doi_url:'https://example.org',openalex_url:'https://openalex.org/W123',open_access_url:'',plan_ids:['personal-rag'],paper:null}]}));
  }
  if(url.pathname==='/api/admin/papers/candidates'&&req.headers.cookie==='paper-session=test'){
    paperReads.push(url.pathname+url.search);
    return res.end(JSON.stringify({filters:candidateFilters(url.searchParams),total:25,pageSize:24,days:7,
      directions:[{id:'',title:'全部',count:25},{id:'personal-rag',title:'RAG 与信息检索',count:25}],
      candidates:[{id:'00000000-0000-4000-8000-000000000001',paper_id:'00000000-0000-4000-8000-000000000001',title:'RAG candidate fixture',abstract:'A search method',authors:'Author',published:'2026-10-08',version:'v1',
        first_discovered_at:'2026-10-08T00:00:00Z',selected_date:null,digest_status:'unavailable',directions:[{id:'personal-rag',title:'RAG 与信息检索'}],
        matches:[{plan_id:'hot-ai',plan_title:'AI 热点发现',kind:'hot',reason:'热点论文'}]}]}));
  }
  if (["/api/admin/papers", "/api/admin/papers/today"].includes(url.pathname) && req.headers.cookie === "paper-session=test") {
    paperReads.push(url.pathname + url.search);
    return res.end(JSON.stringify(url.pathname.endsWith('/today')?{papers:todayPapers,daily}:{papers:[]}));
  }
  if (url.pathname === "/api/site/meta") {
    const respond = () => res.end(JSON.stringify({ changelogVersion: "2026-09-28T12:00" }));
    return metaDelayMs ? setTimeout(respond, metaDelayMs) : respond();
  }
  if (url.pathname === "/api/site/timeline") {
    const filters = { channel: "all", category: url.searchParams.get("category"), tag: null };
    res.setHeader("X-Accel-Expires", `@${deadline}`);
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30");
    return res.end(JSON.stringify({ filters, cards: [], nextCursor: null, dayCounts: [], hot: null }));
  }
  if (url.pathname === "/api/site/hot") return res.end(JSON.stringify({ entries: [] }));
  if (url.pathname === "/api/site/echo-client") return res.end(JSON.stringify({ forwarded: req.headers["x-forwarded-for"], real: req.headers["x-real-ip"] }));
  if (url.pathname === "/api/site/download") {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="article.md"');
    return res.end("# Article");
  }
  if (url.pathname === "/api/site/items/long-lived") return res.end(JSON.stringify({ id: "long-lived", title: "t" }));
  if (url.pathname === "/api/site/contact") return res.end(JSON.stringify({ wechatQr: "/qr.png", feishuQr: "/qr.png" }));
  if (url.pathname === "/api/site/stories/merged") {
    res.statusCode = 308;
    return res.end(JSON.stringify({ mergedInto: "surviving-story" }));
  }
  res.statusCode = url.pathname.startsWith("/api/admin/") ? 401 : 404;
  res.end(JSON.stringify({ code: "not_found" }));
});

before(async () => {
  deadline = Math.floor(Date.now() / 1000) + 20;
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", TRUST_PROXY: "false", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`web did not start: ${logs}`)), 15_000);
    web.on("exit", () => { clearTimeout(timeout); reject(new Error(`web exited: ${logs}`)); });
    web.stderr!.on("data", (chunk) => { logs += String(chunk); });
    web.stdout!.on("data", (chunk) => {
      logs += String(chunk);
      const match = logs.match(/"msg":"web started","port":(\d+)/);
      if (match) {
        origin = `http://127.0.0.1:${match[1]}`;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});

after(async () => {
  if (web && web.exitCode === null) {
    web.kill("SIGTERM");
    await once(web, "exit");
  }
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

test("public route subsets produce the same complete navigation data; filters still differ", async () => {
  const answers = await Promise.all(["", "?_routes=root", "?_routes=routes%2Fhome", "?_routes=unknown"].map(async (query) => {
    const res = await fetch(`${origin}/news/featured.data${query}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Cache-Control")!, /^public,/);
    assert.equal(res.headers.get("X-Accel-Expires"), `@${deadline}`);
    assert.doesNotMatch(res.headers.get("Cache-Control")!, /stale/);
    const body = await res.text();
    assert.ok(body.includes("root") && body.includes("routes/home"));
    return body;
  }));
  assert.ok(answers.every((body) => body === answers[0]));
  const category = CATEGORY_KEYS.at(-1)!;
  const filtered = await fetch(`${origin}/news/featured.data?category=${category}&_routes=root`);
  const body = await filtered.text();
  assert.ok(body.includes(category));
  assert.notEqual(body, answers[0]);
});

test("navigation streams are plain text for download managers, including errors and actions", async () => {
  for (const [pathname, method, status] of [
    ["/news/featured.data?_routes=root", "GET", 200],
    ["/about.data", "HEAD", 200],
    ["/items/missing.data", "GET", 404],
    ["/story/merged.data", "GET", 202],
    ["/admin/sources.data?_routes=admin-layout", "GET", 202],
    ["/hot.data", "POST", 405],
  ] as const) {
    const res = await fetch(origin + pathname, { method });
    assert.equal(res.status, status, pathname);
    assert.equal(res.headers.get("Content-Type"), "text/plain; charset=utf-8", pathname);
    assert.equal(res.headers.get("Content-Disposition"), null, pathname);
    const body = await res.text();
    if (method === "HEAD") assert.equal(body, "");
    else assert.ok(body.length > 0, pathname);
  }
  const html = await fetch(origin + "/about");
  assert.match(html.headers.get("Content-Type")!, /^text\/html/);
  await html.text();
  const json = await fetch(origin + "/api/site/echo-client");
  assert.match(json.headers.get("Content-Type")!, /^application\/json/);
  await json.text();
  const download = await fetch(origin + "/api/site/download");
  assert.equal(download.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(download.headers.get("Content-Disposition"), 'attachment; filename="article.md"');
  assert.equal(await download.text(), "# Article");
});

test("HTML and navigation share freshness; cookies do not personalize public results", async () => {
  const html = await fetch(`${origin}/news/featured`);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("X-Accel-Expires"), `@${deadline}`);
  assert.match(await html.text(), /精选/);
  const plain = await fetch(`${origin}/about.data`);
  const signedIn = await fetch(`${origin}/about.data?_routes=root`, { headers: { cookie: "admin_session=private; reader=returning" } });
  assert.match(plain.headers.get("Cache-Control")!, /^public,/);
  assert.match(plain.headers.get("X-Accel-Expires")!, /^@\d+$/);
  assert.equal(plain.headers.get("Cache-Control"), "public, max-age=300, s-maxage=300, must-revalidate");
  assert.equal(Date.parse(plain.headers.get("Date")!) / 1000 + 300, Number(plain.headers.get("X-Accel-Expires")!.slice(1)));
  assert.equal(signedIn.headers.get("Set-Cookie"), null);
  assert.equal(await signedIn.text(), await plain.text());
  assert.ok(apiCookies.every((cookie) => !cookie));
});

test("missing routes cannot be hidden by a root-only request; errors and redirects stay uncached", async () => {
  for (const pathname of ["/items/missing.data?_routes=root", "/does-not-exist.data?_routes=root", "/items/missing"]) {
    const res = await fetch(origin + pathname);
    assert.equal(res.status, 404, pathname);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.equal(res.headers.get("X-Accel-Expires"), "0");
    await res.text();
  }
  for (const [pathname, target] of [["/story/merged.data?_routes=root", "/story/surviving-story"], ["/news/featured.data?q=search&_routes=root", "/all?q=search"]]) {
    const res = await fetch(origin + pathname);
    assert.equal(res.status, 202);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.match(await res.text(), new RegExp(target.replace("?", "\\?")));
  }
});

test("admin data and actions never become public cache entries", async () => {
  const admin = await fetch(`${origin}/admin/sources.data?_routes=admin-layout`);
  assert.equal(admin.status, 202);
  assert.equal(admin.headers.get("Cache-Control"), "private, no-store");
  assert.equal(admin.headers.get("X-Accel-Expires"), "0");
  assert.match(await admin.text(), /api\/auth\/login/);
  const action = await fetch(`${origin}/hot.data`, { method: "POST" });
  assert.equal(action.status, 405);
  assert.equal(action.headers.get("Cache-Control"), "private, no-store");
  assert.equal(action.headers.get("X-Accel-Expires"), "0");
  await action.text();
});

test("browser freshness shares the selected deadline, including slow sibling loaders", async () => {
  const savedDeadline = deadline;
  try {
    deadline = Math.floor(Date.now() / 1000) + 20;
    for (const pathname of ["/news/featured", "/news/featured.data?_routes=routes%2Fhome"]) {
      const res = await fetch(origin + pathname);
      const cc = res.headers.get("Cache-Control")!;
      const browser = Number(cc.match(/(?:^|,)\s*max-age=(\d+)/)![1]);
      const shared = Number(cc.match(/(?:^|,)\s*s-maxage=(\d+)/)![1]);
      assert.ok(browser > 0 && browser === shared);
      assert.ok(Date.parse(res.headers.get("Date")!) / 1000 + browser <= deadline);
      assert.equal(res.headers.get("X-Accel-Expires"), `@${deadline}`);
      assert.match(cc, /must-revalidate/);
      assert.doesNotMatch(cc, /stale/);
      await res.text();
    }
    // The selected loader initially grants a positive TTL, but root metadata finishes after it.
    deadline = Math.floor(Date.now() / 1000) + 2;
    metaDelayMs = 2300;
    await Promise.all(["/news/featured", "/news/featured.data?_routes=routes%2Fhome"].map(async (pathname) => {
      const res = await fetch(origin + pathname);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Cache-Control"), "no-cache");
      assert.equal(res.headers.get("X-Accel-Expires"), "0");
      await res.text();
    }));
  } finally {
    deadline = savedDeadline;
    metaDelayMs = 0;
  }
});

test("a shared cache may keep an item page longer than browsers", async () => {
  const res = await fetch(`${origin}/items/long-lived.data`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=300, s-maxage=600, must-revalidate");
  await res.text();
});

test("browser caching preserves noindex and private sign-in responses", async () => {
  const feedback = await fetch(origin + "/feedback");
  assert.equal(feedback.status, 200);
  assert.match(await feedback.text(), /name="robots" content="noindex/);
  assert.equal(feedback.headers.get("Cache-Control"), "public, max-age=300, s-maxage=300, must-revalidate");
  const login = await fetch(origin + "/admin/login");
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("Cache-Control"), "private, no-store");
  assert.equal(login.headers.get("X-Robots-Tag"), "noindex, nofollow");
  await login.text();
});

test("a visitor cannot name its own address to the api without a trusted proxy in front", async () => {
  const res = await fetch(`${origin}/api/site/echo-client`, { headers: { "X-Forwarded-For": "6.6.6.6", "X-Real-IP": "6.6.6.6" } });
  assert.deepEqual(await res.json(), { forwarded: "127.0.0.1", real: "127.0.0.1" });
});

// PaperPulse's homepage is a private workspace; it cannot inherit news shared-cache rules.
test("paper homepage and navigation stay private; signed-out readers are sent to sign-in", async () => {
  const signedOut = await fetch(origin + "/", { redirect: "manual" });
  assert.equal(signedOut.status, 302);
  assert.equal(signedOut.headers.get("Cache-Control"), "private, no-store");
  assert.match(signedOut.headers.get("Location")!, /api\/auth\/login/);
  for (const pathname of ["/", "/_.data?_routes=root"]) {
    const response = await fetch(origin + pathname, { headers: { cookie: "paper-session=test" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Accel-Expires"), "0");
    await response.text();
  }
});

test('daily update reasons render from saved status in HTML and navigation without starting work',async()=>{
  try{
    for(const state of ['scheduled','overdue','empty','discovery_failed','waiting'] as const){
      daily={...dailyFixture(),state};
      if(state==='waiting')daily.counts.budgetWaiting=1;
      for(const pathname of ['/','/_.data?_routes=root']){
        paperReads.length=0;
        const response=await fetch(origin+pathname,{headers:{cookie:'paper-session=test'}});
        assert.equal(response.status,200);
        assert.equal(response.headers.get('Cache-Control'),'private, no-store');
        const body=await response.text();
        assert.deepEqual(paperReads,['/api/admin/papers/today']);
        if(pathname==='/'){
          assert.ok(body.includes(dailyMessage(daily).title));
          assert.ok(body.includes('06:00'));
          assert.ok(body.includes('最近检索成功'));
          assert.ok(body.includes('10/08 06:01'));
          if(state==='waiting')assert.ok(body.includes('1 篇因服务请求预算不足'));
        }else assert.ok(body.includes(state));
      }
    }
  }finally{daily=dailyFixture();}
});

test('waiting paper cards explain actual capacity and the next recovery time without extra API work',async()=>{
  const now=new Date('2026-10-08T05:00:00Z');
  const starts=Array.from({length:14},(_,i)=>new Date(Date.parse('2026-10-07T06:00:00Z')+i*60000));
  const wait=readingWait('预算不足','reading',requestBudget('llm',{per_minute:4,per_hour:24,per_day:12},starts,now),now);
  todayPapers=[{id:'waiting-paper',title:'Waiting paper',authors:'Author',published:'2026-10-08',topic:'RAG',abstract:'abstract',source_url:'',pdf_url:'',code_url:'',version:'v1',status:'unread',has_pdf:false,pdf_sha256:null,created_at:now.toISOString(),reading_status:'waiting',reading_stage:'reading',reading_wait:wait}];
  try{
    paperReads.length=0;
    const response=await fetch(origin+'/',{headers:{cookie:'paper-session=test'}});
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    const body=await response.text();assert.ok(body.includes('模型请求额度等待'));assert.ok(body.includes('14/12'));assert.ok(body.includes('14:05'));assert.ok(body.includes('北京时间'));
    assert.deepEqual(paperReads,['/api/admin/papers/today']);
  }finally{todayPapers=[];}
});

test('candidate HTML and navigation forward all filters once, remain private and show category counts with pagination',async()=>{
  const query='?direction=personal-rag&q=RAG&reading=pending&page=2';
  for(const data of [false,true]){
    paperReads.length=0;
    const response=await fetch(origin+'/papers/candidates'+(data?'.data':'')+query,{headers:{cookie:'paper-session=test'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    const body=await response.text();assert.deepEqual(paperReads,['/api/admin/papers/candidates'+query]);
    assert.ok(body.includes('RAG candidate fixture'));
    if(!data){
      assert.ok(body.includes('aria-label="研究方向"'));assert.ok(body.includes('aria-current="page"'));assert.ok(body.includes('RAG 与信息检索'));
      assert.ok(body.includes('上一页'));assert.ok(body.includes('name="direction"'));assert.ok(body.includes('name="reading"'));assert.ok(body.includes('列表已去重'));
      assert.ok(body.includes('q=RAG&amp;reading=pending'));
    }
  }
  assert.equal((await fetch(origin+'/papers/candidates',{redirect:'manual'})).status,302);
});

test('high-citation SSR and single-fetch preserve filters and only read metadata; reading requires an explicit button',async()=>{
  const query='?direction=personal-rag&q=Classic&reading=pending&page=2&age=older&venue=SIGIR';
  for(const data of [false,true]){
    paperReads.length=0;const response=await fetch(origin+'/papers/impact'+(data?'.data':'')+query,{headers:{cookie:'paper-session=test'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    const body=await response.text();assert.ok(body.includes('Classic retrieval fixture'));assert.deepEqual(paperReads,['/api/admin/papers/impact'+query]);
    if(!data){assert.ok(body.includes('开始精读'));assert.ok(body.includes('上传原文 PDF'));assert.ok(body.includes('发表5年以上'));assert.ok(body.includes('上一页'));assert.ok(body.includes('CCF A 高引与经典论文'));}
  }
  assert.equal((await fetch(origin+'/papers/impact',{redirect:'manual'})).status,302);
});

test('direction settings render eight choices, topic controls and preview while remaining private',async()=>{
  const response=await fetch(origin+'/papers/settings',{headers:{cookie:'paper-session=test'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  const body=await response.text();
  for(const title of ['RAG 与信息检索','多模态大模型','大模型推荐','Agent 与工具使用','训练与对齐','推理与评测','高效训练与推理','代码与软件工程'])assert.ok(body.includes(title));
  assert.ok(body.includes('检索增强生成'));assert.ok(body.includes('预览匹配结果'));assert.ok(body.includes('高级自定义'));
  const out=await fetch(origin+'/papers/settings',{redirect:'manual'});assert.equal(out.status,302);
});

test("paper library and reading history keep their view and filters in HTML and single-fetch navigation", async () => {
  for (const [path, title, upstream] of [
    ["/papers/library", "已精读论文", "/api/admin/papers?q=&status=&digest=ready"],
    ["/papers/library?q=RAG", "已精读论文", "/api/admin/papers?q=RAG&status=&digest=ready"],
    ["/papers/history", "阅读记录", "/api/admin/papers?q=&status=active"],
    ["/papers/history?status=done&q=RAG", "阅读记录", "/api/admin/papers?q=RAG&status=done"],
    ["/papers/mine?q=RAG&tag=baseline&direction=personal-rag", "我的论文", "/api/admin/papers?mine=true&q=RAG&status=&digest=&tag=baseline&direction=personal-rag"],
  ]) {
    const url = new URL(path!, origin);
    for (const dataRequest of [false, true]) {
      const target = new URL(url);
      if (dataRequest) target.pathname += ".data";
      paperReads.length = 0;
      const response = await fetch(target, { headers: { cookie: "paper-session=test" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      const body = await response.text();
      assert.deepEqual(paperReads, [upstream]);
      if (!dataRequest) assert.ok(body.includes(`<h1>${title}</h1>`));
    }
  }
});

test('historical detail forwards its version, stays private and cannot start current-version reading from archived controls',async()=>{
  try{
    for(const ready of [true,false]){
      historicalReady=ready;
      for(const data of [false,true]){
        paperReads.length=0;
        const response=await fetch(origin+'/papers/version-fixture'+(data?'.data':'')+'?version=old',{headers:{cookie:'paper-session=test'}});
        assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
        const body=await response.text();assert.deepEqual(paperReads,['/api/admin/papers/version-fixture?version=old']);
        if(!data){assert.ok(body.includes('历史版本，可记笔记'));assert.ok(!body.includes('重试图表解读'));assert.ok(!body.includes('优化图表解读'));if(!ready)assert.ok(body.includes('切为当前版本后精读'));}
      }
    }
  }finally{historicalReady=true;}
});

test('review failure SSR locates text, source page and optional revision; historical views cannot submit repairs',async()=>{
  for(const version of ['current','old'])for(const data of [false,true]){
    paperReads.length=0;const response=await fetch(origin+'/papers/repair-fixture'+(data?'.data':'')+'?version='+version,{headers:{cookie:'paper-session=test'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(paperReads,['/api/admin/papers/repair-fixture?version='+version]);
    const body=await response.text();if(!data){for(const phrase of ['核查问题与修订','待核查论文结论','PDF 第 10 页','Original conclusion evidence.','修订建议','文字证据标记','保留此前的修订建议'])assert.ok(body.includes(phrase));
      assert.equal(body.includes('修订并继续核查'),version==='current');assert.ok(!body.includes('>继续处理</button>'));if(version==='current')assert.ok(body.includes('请先处理上方核查问题'));
    }
  }
});

test('figure source badges distinguish pixel inspection from text, and only current text figures offer a visual upgrade',async()=>{
  try{for(const visual of [false,true])for(const version of ['current','old']){
    visualFixture=visual;paperReads.length=0;const response=await fetch(origin+'/papers/visual-fixture?version='+version,{headers:{cookie:'paper-session=test'}});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(paperReads,['/api/admin/papers/visual-fixture?version='+version]);const html=await response.text();
    assert.equal(html.includes('已结合原图独立核查'),visual);assert.equal(html.includes('依据图注、表格文本和正文解读'),!visual);assert.equal(html.includes('结合原图重新解读'),!visual&&version==='current');
    if(visual)for(const text of ['查看图像观察与不确定之处','原图可见模型与准确率两列','图注与正文补充','无法从原图确认'])assert.ok(html.includes(text));
  }}finally{visualFixture=true;}
});
