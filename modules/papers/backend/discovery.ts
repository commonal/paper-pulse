import { randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { sql } from "@aihot/backend/db";
import type { Db } from "@aihot/backend/db";
import type { Scheduled } from "@aihot/backend/modules";
import { enqueuePaperMaterial } from "./queue.ts";
import { arxivId } from "./store.ts";
import type { Paper } from "../types.ts";
import { withPaperPresentations } from "./presentation.ts";
import {DAILY_DISCOVERY,DAILY_MAX_PDF_PAGES,readingDate,discoveryTime} from '../daily.ts';
import {recordRun} from '@aihot/backend/jobs/queue';
import {requestArxiv,discoveryRetryAt} from './arxiv-request.ts';
export {discoveryRetryAt} from './arxiv-request.ts';
import {DIRECTIONS,HOT_DIRECTION,defaultPreferences,matchPlan,arxivExpression,type DiscoveryPlan,type PlanPreferences} from '../directions.ts';
import {selectCandidates,type SelectionCandidate} from './selection.ts';
import {withReadingWaits} from './wait-status.ts';
import {ensureCurrentVersion,saveDiscoveredVersion} from './versions.ts';
import {candidatePage,groupCandidates,type CandidateFilters,type CandidateRow} from '../candidates.ts';
export type {DiscoveryPlan} from '../directions.ts';
type ArxivItem = { id: string; title: string; authors: string; published: string; abstract: string; categories: string[] };

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
const text = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const stableId = (id: string) => id.replace(/v\d+$/i, "");
const currentVersion = (id: string) => id.match(/v\d+$/i)?.[0] ?? "v1";
const sqlDate = (compact: string) => new Date(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T00:00:00.000Z`);
const DEFAULT_PLANS=[{...HOT_DIRECTION,kind:'hot' as const,enabled:true},...DIRECTIONS.map(direction=>({...direction,kind:'personal' as const,enabled:['personal-rag','personal-multimodal','personal-llm-rec'].includes(direction.id)}))];

type DiscoveryOptions={refresh?:boolean;requestIntervalMs?:number};
type Progress={plan_id:string;phase:'recent'|'previous'|'done';status:'pending'|'waiting'|'ready'|'failed';attempts:number;recent_count:number|null;next_attempt_at:Date|null;error:string|null};
class ArxivFetchError extends Error {
  readonly status:number;
  readonly retryAfter:string|null;
  constructor(message:string,status:number,retryAfter:string|null=null){super(message);this.status=status;this.retryAfter=retryAfter;}
}

async function ensureDiscoveryDefaults() {
  for (const plan of DEFAULT_PLANS) await sql`INSERT INTO paper_discovery_plans (id, kind, title, enabled, categories, keywords,preferences)
    VALUES (${plan.id}, ${plan.kind}, ${plan.title},${plan.enabled}, ${plan.categories},'{}',${sql.json({...defaultPreferences()})}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO paper_discovery_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING`;
}

export async function listDiscoveryPlans(): Promise<DiscoveryPlan[]> {
  await ensureDiscoveryDefaults();
  return sql<DiscoveryPlan[]>`SELECT id, kind, title, enabled, categories, keywords, preferences,updated_at
    FROM paper_discovery_plans ORDER BY CASE kind WHEN 'hot' THEN 0 ELSE 1 END, title`;
}

export async function updateDiscoveryPlan(id: string, input: { enabled?: boolean; categories?: string[]; keywords?: string[];preferences?:PlanPreferences }): Promise<DiscoveryPlan | null> {
  const [row] = await sql<DiscoveryPlan[]>`UPDATE paper_discovery_plans SET
    enabled = coalesce(${input.enabled ?? null}, enabled),
    categories = coalesce(${input.categories ?? null}, categories),
    keywords = coalesce(${input.keywords ?? null}, keywords),preferences=coalesce(${input.preferences?sql.json({...input.preferences}):null},preferences), updated_at = now()
    WHERE id = ${id} RETURNING id, kind, title, enabled, categories, keywords,preferences, updated_at`;
  return row ?? null;
}

export async function discoverySettings() {
  await ensureDiscoveryDefaults();
  const [row] = await sql<{ daily_limit: number; hot_limit: number; candidate_days: number }[]>`
    SELECT daily_limit, hot_limit, candidate_days FROM paper_discovery_settings WHERE singleton = true`;
  return row ?? { daily_limit: 3, hot_limit: 1, candidate_days: 7 };
}

export async function updateDiscoverySettings(input: { daily_limit: number; hot_limit: number; candidate_days: number }) {
  const [row] = await sql<{ daily_limit: number; hot_limit: number; candidate_days: number }[]>`
    UPDATE paper_discovery_settings SET daily_limit = ${input.daily_limit}, hot_limit = ${input.hot_limit},
      candidate_days = ${input.candidate_days}, updated_at = now() WHERE singleton = true
    RETURNING daily_limit, hot_limit, candidate_days`;
  return row;
}

function queryFor(plan: DiscoveryPlan, start: string, end: string): string {
  return `${arxivExpression(plan)} AND submittedDate:[${start}0000 TO ${end}2359]`;
}

function list<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }

async function fetchPlan(plan: DiscoveryPlan, start: string, end: string,now:Date,intervalMs:number,attempt:number): Promise<{ items: Array<{
  id: string; title: string; authors: string; published: string; abstract: string; categories: string[];
}>; count: number }> {
  const query = new URLSearchParams({ search_query: queryFor(plan, start, end), start: "0", max_results: "100", sortBy: "submittedDate", sortOrder: "descending" });
  const response = await requestArxiv(`https://export.arxiv.org/api/query?${query}`, {
    headers: { accept: "application/atom+xml", "user-agent": "paper-pulse/0.1 (personal research reader)" },
    signal: AbortSignal.timeout(20_000),
  },now,intervalMs,attempt);
  if (!response.ok) throw new ArxivFetchError(`arXiv 元数据读取失败（HTTP ${response.status}）`,response.status,response.headers.get('retry-after'));
  const xml = await response.text();
  if (xml.length > 8_000_000) throw new Error("arXiv 元数据响应超过 8 MB 上限");
  const feed = parser.parse(xml)?.feed;
  if(!feed||!Number.isFinite(Number(feed.totalResults)))throw new ArxivFetchError('arXiv 元数据响应缺少有效 feed/totalResults',400);
  const items = list<Record<string, unknown>>(feed?.entry as Record<string, unknown> | Record<string, unknown>[] | undefined).flatMap((entry) => {
    const rawId = text(entry.id);
    let id = "";
    try { id = arxivId(rawId); } catch { return []; }
    const authors = list<Record<string, unknown>>(entry.author as Record<string, unknown> | Record<string, unknown>[] | undefined).map((author) => text(author.name)).filter(Boolean).join(", ");
    const categories = list<Record<string, unknown>>(entry.category as Record<string, unknown> | Record<string, unknown>[] | undefined).map((item) => text(item["@_term"])).filter(Boolean);
    const published = text(entry.published).slice(0, 10);
    return [{ id, title: text(entry.title), authors, published: /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : "", abstract: text(entry.summary), categories }];
  });
  const count = Number(feed.totalResults);
  return { items, count: Number.isFinite(count) ? Math.max(count, items.length) : items.length };
}

async function upsertPaper(tx: Db, item: { id: string; title: string; authors: string; published: string; abstract: string; categories: string[] }): Promise<string> {
  const arxivId = stableId(item.id);
  const version = currentVersion(item.id);
  const sourceUrl = `https://arxiv.org/abs/${item.id}`;
  const pdfUrl = `https://arxiv.org/pdf/${item.id}`;
  await tx`SELECT pg_advisory_xact_lock(hashtext(${arxivId}))`;
  let [existing] = await tx<{ id: string; version: string; arxiv_id: string | null }[]>`
    SELECT id, version, arxiv_id FROM papers WHERE arxiv_id = ${arxivId}
      OR (arxiv_id IS NULL AND source_url LIKE ${`https://arxiv.org/abs/${arxivId}%`}) ORDER BY created_at LIMIT 1`;
  if (!existing) {
    const id = randomUUID();
    await tx`INSERT INTO papers (id, title, authors, published, topic, abstract, source_url, pdf_url, arxiv_id, version,arxiv_categories)
      VALUES (${id}, ${item.title}, ${item.authors}, ${item.published}, ${item.categories[0] ?? "AI"}, ${item.abstract},
        ${sourceUrl}, ${pdfUrl}, ${arxivId}, ${version},${item.categories})`;
    await tx`INSERT INTO paper_materials (paper_id, status) VALUES (${id}, 'unavailable') ON CONFLICT (paper_id) DO NOTHING`;
    await tx`INSERT INTO paper_digests (paper_id, status) VALUES (${id}, 'unavailable') ON CONFLICT (paper_id) DO NOTHING`;
    await ensureCurrentVersion(id,tx);
    return id;
  }
  const changed = existing.version !== version;
  if (existing.arxiv_id === null) await tx`UPDATE papers SET arxiv_id = ${arxivId} WHERE id = ${existing.id}`;
  if (changed) {
    const [p]=await tx`SELECT * FROM papers WHERE id=${existing.id}`;
    await saveDiscoveredVersion(existing.id,{...p,title:item.title,authors:item.authors,published:item.published,abstract:item.abstract,
      topic:item.categories[0]??'AI',source_url:sourceUrl,pdf_url:pdfUrl,version,arxiv_categories:item.categories,pdf_sha256:null,
      metadata:{source:'arxiv',date_precision:'day',publication_year:Number(item.published.slice(0,4))||null,identity_status:'record_found',
        metadata_source_url:sourceUrl,identity_checks:['arXiv 新版本登记信息已检索，新 PDF 尚未解析'],identity_checked_at:new Date().toISOString()}},tx);
  }else{
    await ensureCurrentVersion(existing.id,tx);
  }
  return existing.id;
}

async function saveCandidate(tx: Db, plan: DiscoveryPlan, item: ArxivItem): Promise<{ paperId: string; score: number; matchedCategories: string[]; matchedKeywords: string[] }> {
  const paperId = await upsertPaper(tx, item);
  const match=matchPlan(plan,item)!;
  const matchedCategories=match.categories,matchedKeywords=match.keywords,score=match.score;
  await tx`INSERT INTO paper_candidates (paper_id, plan_id, matched_categories, matched_keywords, score)
    VALUES (${paperId}, ${plan.id}, ${matchedCategories}, ${matchedKeywords}, ${score})
    ON CONFLICT (paper_id, plan_id) DO UPDATE SET matched_categories = ARRAY(
      SELECT DISTINCT unnest(paper_candidates.matched_categories || EXCLUDED.matched_categories)),
      matched_keywords = ARRAY(SELECT DISTINCT unnest(paper_candidates.matched_keywords || EXCLUDED.matched_keywords)),
      score = GREATEST(paper_candidates.score, EXCLUDED.score)`;
  return { paperId, score, matchedCategories, matchedKeywords };
}

export async function selectToday(now: Date): Promise<Array<{ paperId: string; plans: string[] }>> {
  const settings = await discoverySettings();
  const plans=await listDiscoveryPlans();
  const todayLabel = readingDate(now);
  const today = new Date(`${todayLabel}T00:00:00.000Z`);
  const selected = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`paper-daily-queue:${todayLabel}`}))`;
    const existing = await tx<{ paper_id: string; source_kind: "hot" | "personal" }[]>`SELECT paper_id, source_kind FROM paper_daily_queue WHERE queue_date = ${today}`;
    const remaining = Math.max(0, settings.daily_limit - existing.length);
    if (!remaining) return [];
    const hotRemaining = Math.max(0, settings.hot_limit - existing.filter((row) => row.source_kind === "hot").length);
    const rows = await tx<{ paper_id:string;plan_id:string;title:string;abstract:string;published:string;categories:string[] }[]>`
      SELECT c.paper_id,c.plan_id,p.title,p.abstract,p.published,coalesce(p.arxiv_categories,c.matched_categories) AS categories
      FROM paper_candidates c JOIN paper_discovery_plans d ON d.id = c.plan_id JOIN papers p ON p.id = c.paper_id
      WHERE d.enabled AND c.first_discovered_at >= ${now}::timestamptz - (${settings.candidate_days} * interval '1 day')
        AND p.published >= ${new Date(now.getTime()-settings.candidate_days*86400_000).toISOString().slice(0,10)}
        AND NOT EXISTS (SELECT 1 FROM paper_pdf_inspections i WHERE i.pdf_sha256=p.pdf_sha256 AND i.page_count>${DAILY_MAX_PDF_PAGES})
        AND NOT EXISTS (SELECT 1 FROM paper_reading_runs r WHERE r.paper_id=p.id AND r.version_id=p.active_version_id AND r.error LIKE '自动日更跳过：%')
        AND NOT EXISTS (SELECT 1 FROM paper_daily_queue q WHERE q.queue_date = ${today} AND q.paper_id = c.paper_id)
        AND NOT EXISTS (SELECT 1 FROM paper_daily_queue q WHERE q.queue_date >= ${today} - interval '7 days' AND q.paper_id = c.paper_id)
      ORDER BY p.published DESC,c.paper_id,c.plan_id`;
    const byPaper = new Map<string, SelectionCandidate>();
    for (const row of rows) {
      const value=byPaper.get(row.paper_id)??{paperId:row.paper_id,title:row.title,abstract:row.abstract,published:row.published,categories:[],planIds:[]};
      value.planIds.push(row.plan_id);value.categories=[...new Set([...value.categories,...row.categories])];byPaper.set(row.paper_id,value);
    }
    const history=await tx<{primary_plan_id:string;n:number;last_date:string}[]>`SELECT primary_plan_id,count(*)::int AS n,max(queue_date)::text AS last_date FROM paper_daily_queue
      WHERE queue_date>=${today}::date-interval '7 days' AND queue_date<=${today}::date AND primary_plan_id IS NOT NULL GROUP BY primary_plan_id`;
    const chosen=selectCandidates([...byPaper.values()],plans,new Map(history.map(row=>[row.primary_plan_id,{count:row.n,lastDate:row.last_date}])),remaining,hotRemaining);
    for (const item of chosen) {
      await tx`INSERT INTO paper_daily_queue (queue_date, paper_id, plan_ids, reason, source_kind, score,primary_plan_id)
        VALUES (${today}, ${item.paperId}, ${item.plans}, ${item.reason}, ${item.sourceKind}, ${item.score},${item.primaryPlanId}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE paper_candidates SET selected_date = ${today} WHERE paper_id = ${item.paperId}`;
      await enqueuePaperMaterial(item.paperId, tx,undefined,true);
    }
    return chosen.map(({ paperId, plans }) => ({ paperId, plans }));
  });
  return selected;
}

export async function runPaperDiscovery(now = new Date(),options:DiscoveryOptions={}) {
  // The daily timer and recovery timer can overlap, including across worker processes.
  const session=await sql.reserve();
  const [{locked}]=await session`SELECT pg_try_advisory_lock(hashtext('papers.discovery')) AS locked`;
  if(!locked){session.release();return {status:'skipped' as const,selected:0,plans:[],paper_ids:[],next_retry_at:null};}
  try{return await discover(now,options);}finally{try{await session`SELECT pg_advisory_unlock(hashtext('papers.discovery'))`;}finally{session.release();}}
}

async function discover(now:Date,options:DiscoveryOptions){
  const started=Date.now();
  const currentTime=()=>new Date(now.getTime()+Date.now()-started);
  const plans = (await listDiscoveryPlans()).filter((plan) => plan.enabled);
  const endDate = now;
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  // Freeze the window to the reading day: a retry crossing 08:00 must not reset its progress.
  const dateKey = (date: Date) => readingDate(date).replaceAll("-", "");
  const start = dateKey(startDate); const end = dateKey(endDate);
  const date=readingDate(now);
  await sql`INSERT INTO paper_arxiv_throttle(singleton) VALUES(true) ON CONFLICT DO NOTHING`;
  for (const plan of plans) {
    const queryKey=JSON.stringify({start,end,query:arxivExpression(plan)});
    await sql`INSERT INTO paper_discovery_progress(queue_date,plan_id,query_key) VALUES(${date}::date,${plan.id},${queryKey})
      ON CONFLICT(queue_date,plan_id) DO UPDATE SET query_key=EXCLUDED.query_key,phase='recent',status='pending',attempts=0,recent_count=NULL,next_attempt_at=NULL,error=NULL,updated_at=now()
      WHERE paper_discovery_progress.query_key<>EXCLUDED.query_key OR (${options.refresh===true} AND paper_discovery_progress.status IN ('ready','failed'))`;
    let [progress]=await sql<Progress[]>`SELECT * FROM paper_discovery_progress WHERE queue_date=${date}::date AND plan_id=${plan.id}`;
    if(progress!.status==='ready'||progress!.status==='failed'||(progress!.next_attempt_at&&progress!.next_attempt_at>now))continue;
    while(progress!.phase!=='done'){
      const [gate]=await sql`SELECT next_request_at,blocked_until FROM paper_arxiv_throttle WHERE singleton`;
      if(gate.blocked_until&&gate.blocked_until>currentTime())break;
      const interval=options.requestIntervalMs??3100;
      const attempt=progress!.attempts+1;
      await sql`UPDATE paper_discovery_progress SET attempts=${attempt},updated_at=now() WHERE queue_date=${date}::date AND plan_id=${plan.id}`;
      let result:Awaited<ReturnType<typeof fetchPlan>>;
      const previousEndDate=new Date(startDate.getTime()-86400_000),previousStartDate=new Date(previousEndDate.getTime()-6*86400_000);
      try{result=await fetchPlan(plan,progress!.phase==='recent'?start:dateKey(previousStartDate),progress!.phase==='recent'?end:dateKey(previousEndDate),currentTime(),interval,attempt);}
      catch(error){
        const retryable=error instanceof ArxivFetchError?error.status===429||error.status>=500:error instanceof TypeError||(error instanceof DOMException&&['TimeoutError','AbortError'].includes(error.name));
        const next=retryable&&attempt<5?discoveryRetryAt(currentTime(),attempt,error instanceof ArxivFetchError?error.retryAfter:null):null;
        const message=`${plan.title}：${error instanceof ArxivFetchError?error.message:'arXiv 连接超时或暂不可达'}`;
        await sql`UPDATE paper_discovery_progress SET status=${next?'waiting':'failed'},next_attempt_at=${next},error=${message},updated_at=now() WHERE queue_date=${date}::date AND plan_id=${plan.id}`;
        break;
      }
      if(progress!.phase==='recent'){
        await sql.begin(async tx=>{
          for(const item of result.items)if(matchPlan(plan,item))await saveCandidate(tx,plan,item);
          await tx`UPDATE paper_discovery_progress SET phase='previous',status='pending',attempts=0,recent_count=${result.count},next_attempt_at=NULL,error=NULL,updated_at=now() WHERE queue_date=${date}::date AND plan_id=${plan.id}`;
        });
        progress={...progress!,phase:'previous',attempts:0,recent_count:result.count};
      }else{
        await sql.begin(async tx=>{
          await tx`INSERT INTO paper_trend_snapshots (observed_on,plan_id,window_start,window_end,recent_count,previous_count)
            VALUES(${date}::date,${plan.id},${sqlDate(start)},${sqlDate(end)},${progress!.recent_count},${result.count})
            ON CONFLICT(observed_on,plan_id) DO UPDATE SET window_start=EXCLUDED.window_start,window_end=EXCLUDED.window_end,recent_count=EXCLUDED.recent_count,previous_count=EXCLUDED.previous_count,captured_at=now()`;
          await tx`UPDATE paper_discovery_progress SET phase='done',status='ready',next_attempt_at=NULL,error=NULL,updated_at=now() WHERE queue_date=${date}::date AND plan_id=${plan.id}`;
        });
        break;
      }
    }
  }
  const queued = await selectToday(now);
  const summary=await discoveryProgress(now);
  return {window_start:start,window_end:end,...summary,selected:queued.length,paper_ids:queued.map(item=>item.paperId)};
}

export async function discoveryProgress(now=new Date()){
  const rows=await sql<Progress[]>`SELECT r.* FROM paper_discovery_progress r JOIN paper_discovery_plans p ON p.id=r.plan_id WHERE r.queue_date=${readingDate(now)}::date AND p.enabled ORDER BY p.kind,p.title`;
  const [gate]=await sql`SELECT blocked_until FROM paper_arxiv_throttle WHERE singleton`;
  const waiting=rows.filter(p=>p.status==='pending'||p.status==='waiting');
  const times=waiting.map(p=>Math.max(p.next_attempt_at?.getTime()??now.getTime(),gate?.blocked_until?.getTime()??0));
  const next=times.length?new Date(Math.min(...times)).toISOString():null;
  return {status:waiting.length?'waiting' as const:rows.some(p=>p.status==='failed')?'failed' as const:'complete' as const,next_retry_at:next,plans:rows.map(p=>({plan_id:p.plan_id,status:p.status,phase:p.phase,fetched:p.recent_count,error:p.error,next_attempt_at:p.next_attempt_at?.toISOString()??null}))};
}

export async function recoverPaperDiscovery(now=new Date(),options:DiscoveryOptions={}){
  if(process.env.PAPER_DISCOVERY_ENABLED!=='true'||now<discoveryTime(readingDate(now)))return {status:'skipped'};
  const active=(await listDiscoveryPlans()).filter(plan=>plan.enabled);
  if(!active.length)return {status:'skipped'};
  const progress=await discoveryProgress(now);
  if(progress.plans.length===active.length&&!progress.next_retry_at)return {status:'skipped'};
  if(progress.next_retry_at&&new Date(progress.next_retry_at)>now)return {status:'skipped'};
  if(!progress.plans.length){
    const [legacy]=await sql`SELECT count(*)::int AS n FROM job_runs WHERE job='papers.discovery' AND status='ok' AND (started_at AT TIME ZONE 'Asia/Shanghai')::date=${readingDate(now)}::date AND detail->>'status' IS NULL`;
    if(legacy.n)return {status:'skipped'};
  }
  return recordRun('papers.discovery',()=>runPaperDiscovery(now,options));
}

export async function todayQueue(now=new Date()) {
  const papers = await sql<Paper[]>`SELECT q.queue_date, q.paper_id, q.plan_ids, q.reason, q.source_kind, q.score,
      p.id, p.title, p.authors, p.published, p.topic, p.abstract, p.source_url, p.pdf_url, p.code_url, p.arxiv_id, p.version, p.status,
      (p.pdf_data IS NOT NULL) AS has_pdf, p.pdf_sha256, p.created_at,
      coalesce((SELECT status FROM paper_materials WHERE paper_id = p.id), 'unavailable') AS parse_status,
      coalesce((SELECT status FROM paper_digests WHERE paper_id = p.id), 'unavailable') AS digest_status,
      (SELECT status FROM paper_reading_tasks WHERE paper_id=p.id) AS reading_status,
      (SELECT stage FROM paper_reading_tasks WHERE paper_id=p.id) AS reading_stage,
      (SELECT error FROM paper_reading_tasks WHERE paper_id=p.id) AS reading_error,
      (SELECT updated_at FROM paper_reading_tasks WHERE paper_id=p.id) AS reading_updated_at
    FROM paper_daily_queue q JOIN papers p ON p.id = q.paper_id
    WHERE q.queue_date = ${readingDate(now)}::date
    ORDER BY CASE q.source_kind WHEN 'hot' THEN 0 ELSE 1 END, q.score DESC`;
  return withReadingWaits(await withPaperPresentations(papers),now);
}

export async function recentCandidates(filters:CandidateFilters={direction:'',q:'',reading:'',page:1}) {
  const settings = await discoverySettings();
  const plans=await listDiscoveryPlans();
  const papers = await sql<CandidateRow[]>`SELECT c.paper_id, c.plan_id, d.title AS plan_title, d.kind, c.first_discovered_at, c.selected_date,
      coalesce(p.arxiv_categories,c.matched_categories) AS categories,
      p.id, p.title, p.authors, p.published, p.topic, p.abstract, p.source_url, p.pdf_url, p.code_url, p.arxiv_id, p.version, p.status,
      (p.pdf_data IS NOT NULL) AS has_pdf, p.pdf_sha256, p.created_at,
      coalesce((SELECT status FROM paper_materials WHERE paper_id = p.id), 'unavailable') AS parse_status,
      coalesce((SELECT status FROM paper_digests WHERE paper_id = p.id), 'unavailable') AS digest_status
    FROM paper_candidates c JOIN papers p ON p.id = c.paper_id JOIN paper_discovery_plans d ON d.id = c.plan_id
    WHERE d.enabled AND c.first_discovered_at >= now() - (${settings.candidate_days} * interval '1 day')
    ORDER BY c.first_discovered_at DESC, c.score DESC, p.id, c.plan_id`;
  const matched=papers.flatMap(paper=>{const plan=plans.find(p=>p.id===paper.plan_id)!;const match=matchPlan(plan,paper);
    return match?[{...paper,reason:match.reason}]:[];});
  return candidatePage(await withPaperPresentations(groupCandidates(matched)),filters,settings.candidate_days);
}

export async function paperTrends() {
  return sql`SELECT DISTINCT ON (d.id) d.id AS plan_id, d.kind, d.title, s.observed_on, s.window_start, s.window_end,
      s.recent_count, s.previous_count, s.source, s.captured_at
    FROM paper_discovery_plans d LEFT JOIN paper_trend_snapshots s ON s.plan_id = d.id WHERE d.enabled
    ORDER BY d.id, s.observed_on DESC NULLS LAST`;
}

export const paperDiscoverySchedule: Scheduled = {
  name: "papers.discovery", cron: DAILY_DISCOVERY.cron, missed: "once", run: runPaperDiscovery,
  when: () => process.env.PAPER_DISCOVERY_ENABLED === "true",
};
export const paperDiscoveryRecoverySchedule:Scheduled={name:'papers.discovery-recovery',cron:'*/5 * * * *',run:()=>recoverPaperDiscovery(),when:()=>process.env.PAPER_DISCOVERY_ENABLED==='true'};
