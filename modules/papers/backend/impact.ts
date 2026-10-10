import { sql } from "@aihot/backend/db";
import {defineQueue,type Scheduled} from "@aihot/backend/modules";
import {enqueueOn} from '@aihot/backend/jobs/queue';
import {paidRequest,assertAccepted,completeReceipt} from '@aihot/backend/providers/receipts';
import { listDiscoveryPlans } from "./discovery.ts";
import { matchCcfAVenue } from "./ccf-venues.ts";
import {openAlexExpression,planPreferences,matchPlan,type DiscoveryPlan} from '../directions.ts';
import {DIRECTIONS,HOT_DIRECTION} from '../directions.ts';
import {randomUUID,createHash} from 'node:crypto';
import {arxivId,decodePaperPdf,paperById,lockPaperIdentity,normalizePaperDoi} from './store.ts';
import {saveCollection} from './collection.ts';
import {ensureCurrentVersion} from './versions.ts';
import {withPaperPresentations} from './presentation.ts';
import {withReadingWaits} from './wait-status.ts';
import type {Paper} from '../types.ts';
import type {ImpactCandidate,ImpactFilters,ImpactData} from '../impact.ts';

type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  cited_by_count?: number | null;
  abstract_inverted_index?:Record<string,number[]>|null;
  cited_by_percentile_year?: { min?: number | null; max?: number | null } | null;
  authorships?: Array<{ author?: { display_name?: string | null } }>;
  primary_location?: {
    pdf_url?:string|null;is_oa?:boolean;
    landing_page_url?: string | null;
    source?: { display_name?: string | null; type?: string | null; homepage_url?: string | null } | null;
  } | null;
  locations?: Array<{pdf_url?:string|null;is_oa?:boolean; landing_page_url?: string | null; source?: { display_name?: string | null; type?: string | null; homepage_url?: string | null } | null }>;
  best_oa_location?:{pdf_url?:string|null;landing_page_url?:string|null;is_oa?:boolean}|null;
  open_access?: { oa_url?: string | null } | null;
};

type OpenAlexResponse = { results?: OpenAlexWork[] };
const dateLabel = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);

function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function normalizeDoi(value: string) { return value.replace(/^https?:\/\/doi\.org\//i, "").trim(); }
function openAlexId(value: string) { return value.match(/W\d+$/)?.[0] ?? ""; }

async function searchOpenAlex(plan:DiscoveryPlan, from: string, to: string) {
  const params = new URLSearchParams({
    [planPreferences(plan).precision==='precise'?'search.title':'search.title_and_abstract']:openAlexExpression(plan),
    filter: `from_publication_date:${from},to_publication_date:${to},type:article`,
    sort: 'cited_by_count:desc',
    per_page: "100",
    select: "id,doi,title,abstract_inverted_index,publication_year,publication_date,cited_by_count,cited_by_percentile_year,authorships,primary_location,locations,best_oa_location,open_access",
  });
  if(new TextEncoder().encode(`https://api.openalex.org/works?${params}`).length>4094)throw new Error('高引检索关键词过长，请减少补充或排除关键词');
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "PaperPulse/0.2 (academic discovery)" };
  const key = process.env.OPENALEX_API_KEY;
  if (key) headers.authorization = `Bearer ${key}`;
  const request=async()=>{
    const response=await fetch(`https://api.openalex.org/works?${params}`,{headers,signal:AbortSignal.timeout(20000)});
    const body=await response.text();assertAccepted('OpenAlex',response.status,body);
    if(body.length>4000000)throw new Error('OpenAlex 响应超过 4 MB 上限');
    return {response:JSON.parse(body) as OpenAlexResponse};
  };
  // Authenticated searches consume provider credits, so preserve a response before processing it.
  if(key)await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day,note) VALUES('openalex',0,0,0,'OpenAlex 检索：配置预算后启用') ON CONFLICT(service) DO NOTHING`;
  const receipt=key?await paidRequest({service:'openalex',purpose:'paper_impact_discovery',subject:plan.id,
    identity:{query:params.toString()},requestSummary:{planId:plan.id,from,to}},request):null;
  const data=(receipt?receipt.response:(await request()).response) as OpenAlexResponse;
  const results = Array.isArray(data.results) ? data.results : [];
  let matched = 0;
  for (const work of results) {
    const id = openAlexId(string(work.id));
    const title = string(work.title);
    if (!id || !title) continue;
    const words=Object.entries(work.abstract_inverted_index??{}).flatMap(([word,positions])=>Array.isArray(positions)?positions.filter(p=>Number.isInteger(p)&&p>=0&&p<100000).map(position=>({word,position})):[]);
    const abstract=words.sort((a,b)=>a.position-b.position).map(value=>value.word).join(' ');
    if(!matchPlan(plan,{title,abstract},false))continue;
    if (typeof work.cited_by_count !== "number" || work.cited_by_count <= 0) continue;
    const locations = [work.primary_location, ...(work.locations ?? [])].filter(Boolean);
    const match = locations.map((location) => ({ location: location!, venue: matchCcfAVenue(string(location!.source?.display_name)) }))
      .find((item) => item.venue);
    if (!match?.venue) continue;
    const source = match.location.source;
    const venue = match.venue;
    const doi = normalizeDoi(string(work.doi));
    const percentile = work.cited_by_percentile_year;
    const arxiv=locations.find(l=>l?.is_oa&&/^https:\/\/arxiv\.org\//i.test(string(l.pdf_url)));
    const pdfUrl=string(arxiv?.pdf_url)||string(work.best_oa_location?.pdf_url)||string(locations.find(l=>l?.is_oa&&l.pdf_url)?.pdf_url);
    await sql`INSERT INTO paper_impact_candidates (
      openalex_id, doi, title, authors, publication_year, publication_date, venue_name, venue_type, venue_url, ccf_area, ccf_rank,
      citation_count, citation_percentile_min, citation_percentile_max, openalex_url, doi_url, open_access_url, plan_ids, fetched_at,abstract,pdf_url
    ) VALUES (
      ${id}, ${doi || null}, ${title}, ${((work.authorships ?? []).slice(0, 12).map((item) => string(item.author?.display_name)).filter(Boolean)).join(", ")},
      ${work.publication_year ?? null}, ${string(work.publication_date)}, ${string(source?.display_name)}, ${string(source?.type)},
      ${string(source?.homepage_url)}, ${venue.area}, 'A', ${work.cited_by_count ?? null}, ${percentile?.min ?? null}, ${percentile?.max ?? null},
      ${string(work.id)}, ${doi ? `https://doi.org/${doi}` : string(match.location.landing_page_url)},
      ${string(work.open_access?.oa_url)}, ${[plan.id]}, now(),${abstract.slice(0,20000)},${pdfUrl}
    ) ON CONFLICT (openalex_id) DO UPDATE SET doi = coalesce(EXCLUDED.doi, paper_impact_candidates.doi),
      title = EXCLUDED.title, authors = EXCLUDED.authors, publication_year = EXCLUDED.publication_year,
      publication_date = EXCLUDED.publication_date, venue_name = EXCLUDED.venue_name, venue_type = EXCLUDED.venue_type,
      venue_url = EXCLUDED.venue_url, ccf_area = EXCLUDED.ccf_area, ccf_rank = 'A', citation_count = EXCLUDED.citation_count,
      citation_percentile_min = EXCLUDED.citation_percentile_min, citation_percentile_max = EXCLUDED.citation_percentile_max,
      openalex_url = EXCLUDED.openalex_url, doi_url = EXCLUDED.doi_url, open_access_url = EXCLUDED.open_access_url,
      plan_ids = ARRAY(SELECT DISTINCT unnest(paper_impact_candidates.plan_ids || EXCLUDED.plan_ids)), fetched_at = now(),
      abstract=EXCLUDED.abstract,pdf_url=EXCLUDED.pdf_url`;
    matched++;
  }
  if(receipt)await completeReceipt(sql,receipt.receiptId);
  return matched;
}

export async function runPaperImpactDiscovery() {
  const today = dateLabel();
  const from = '1900-01-01';
  await sql`INSERT INTO paper_impact_status (singleton, state, error) VALUES (true, 'running', NULL)
    ON CONFLICT (singleton) DO UPDATE SET state = 'running', error = NULL`;
  try {
    const plans = (await listDiscoveryPlans()).filter((plan) => plan.enabled);
    let count = 0;
    for (const plan of plans) {
      count += await searchOpenAlex(plan, from, today);
    }
    const [status] = await sql<{ state: string; candidate_count: number; query_start: string; query_end: string; error: string | null; captured_at: string }[]>`
      UPDATE paper_impact_status SET state = 'ready', candidate_count = ${count}, query_start = ${from}, query_end = ${today},
        error = NULL, captured_at = now() WHERE singleton = true
      RETURNING state, candidate_count, query_start, query_end, error, captured_at`;
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "OpenAlex 查询失败";
    await sql`UPDATE paper_impact_status SET state = 'failed', error = ${message}, captured_at = now() WHERE singleton = true`;
    throw error;
  }
}

export async function paperImpactResults(filters:ImpactFilters={direction:'',q:'',reading:'',page:1,age:'',venue:''}):Promise<ImpactData> {
  const [status] = await sql`SELECT state, candidate_count, query_start, query_end, error, captured_at FROM paper_impact_status WHERE singleton = true`;
  const stored=await sql<ImpactCandidate[]>`SELECT * FROM paper_impact_candidates WHERE fetched_at >= now()-interval '35 days' OR paper_id IS NOT NULL
    ORDER BY citation_count DESC NULLS LAST,publication_year DESC NULLS LAST,title,openalex_id`;
  const rows=stored.filter(c=>c.ccf_rank==='A'&&matchCcfAVenue(c.venue_name));
  const ids=rows.map(p=>p.paper_id).filter((id):id is string=>Boolean(id));
  const linked=ids.length?await sql<Paper[]>`SELECT p.id,p.title,p.authors,p.published,p.topic,p.abstract,p.source_url,p.pdf_url,p.code_url,p.arxiv_id,p.version,p.status,
    (p.pdf_data IS NOT NULL) AS has_pdf,p.pdf_sha256,p.created_at,m.status AS parse_status,d.status AS digest_status,
    t.status AS reading_status,t.stage AS reading_stage,t.error AS reading_error,t.updated_at AS reading_updated_at
    FROM papers p LEFT JOIN paper_materials m ON m.paper_id=p.id LEFT JOIN paper_digests d ON d.paper_id=p.id
    LEFT JOIN paper_reading_tasks t ON t.paper_id=p.id WHERE p.id IN ${sql(ids)}`:[];
  const papers=new Map((await withReadingWaits(await withPaperPresentations(linked))).map(p=>[p.id,p]));
  const terms=filters.q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean),year=new Date().getFullYear();
  const searched=rows.map(c=>({...c,paper:c.paper_id?papers.get(c.paper_id)??null:null})).filter(c=>{
    if(filters.reading==='ready'&&c.paper?.digest_status!=='ready'||filters.reading==='pending'&&c.paper?.digest_status==='ready')return false;
    if(filters.age==='older'&&(!c.publication_year||c.publication_year>year-5)||filters.age==='recent'&&(!c.publication_year||c.publication_year<=year-5))return false;
    if(filters.venue&&c.venue_name!==filters.venue)return false;
    const text=[c.title,c.authors,c.abstract,c.venue_name,c.paper?.title_zh,c.paper?.summary_zh].join(' ').normalize('NFKC').toLowerCase();
    return terms.every(t=>text.includes(t));
  });
  const directions=[{id:'',title:'全部',count:searched.length},...[...DIRECTIONS,HOT_DIRECTION].map(d=>({id:d.id,title:d.title,count:searched.filter(c=>c.plan_ids.includes(d.id)).length}))];
  const matched=searched.filter(c=>!filters.direction||c.plan_ids.includes(filters.direction));
  const venues=[...new Set(rows.map(c=>c.venue_name).filter(Boolean))].map(venue_name=>({venue_name,candidate_count:rows.filter(c=>c.venue_name===venue_name).length}));
  const pageSize=24,page=Math.min(filters.page,Math.max(1,Math.ceil(matched.length/pageSize)));
  return {status:(status??{state:'idle',candidate_count:0,query_start:null,query_end:null,error:null,captured_at:null}) as ImpactData['status'],
    candidates:matched.slice((page-1)*pageSize,page*pageSize),venues,directions,filters:{...filters,page},total:matched.length,pageSize};
}

export function impactFulltext(candidate:{pdf_url:string|null;open_access_url:string;doi_url?:string}){
  for(const value of [candidate.pdf_url,candidate.open_access_url]){
    if(!value)continue;
    try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)continue;
      try{const id=arxivId(value);return {pdfUrl:`https://arxiv.org/pdf/${id}`,arxivId:id.replace(/v\d+$/i,''),sourceUrl:`https://arxiv.org/abs/${id}`};}catch{}
      if(value===candidate.pdf_url||/\.pdf$/i.test(u.pathname))return {pdfUrl:value,arxivId:null,sourceUrl:null};
    }catch{}
  }
  for(const value of [candidate.open_access_url,candidate.doi_url]){
    if(!value)continue;
    try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)continue;
      if(['jmlr.org','www.jmlr.org','jmlr.csail.mit.edu','jmlr2020.csail.mit.edu','proceedings.mlr.press','aclanthology.org','papers.nips.cc','proceedings.neurips.cc'].includes(u.hostname)){
        u.protocol='https:';
        if(u.hostname==='jmlr.csail.mit.edu'||u.hostname==='jmlr2020.csail.mit.edu')u.hostname='jmlr.org';
        return {pdfUrl:u.href,arxivId:null,sourceUrl:null,...(/\.pdf$/i.test(u.pathname)?{}:{landing:true})};
      }
    }catch{}
  }
  return null;
}

/** An explicit selection creates one durable reading task; list reads never enqueue. */
export async function startImpactReading(id:string,pdfBase64?:string,read=true){
  const pdf=pdfBase64===undefined?null:decodePaperPdf(pdfBase64);
  const paperId=await sql.begin(async tx=>{
    const [candidate]=await tx<ImpactCandidate[]>`SELECT * FROM paper_impact_candidates WHERE openalex_id=${id} FOR UPDATE`;
    if(!candidate)throw Object.assign(new Error('高引论文不存在，请刷新列表'),{statusCode:400});
    if(!matchCcfAVenue(candidate.venue_name))throw Object.assign(new Error('当前白名单未能匹配该论文来源，请先核对发表信息'),{code:'conflict'});
    const fulltext=impactFulltext(candidate),source=fulltext?.sourceUrl||candidate.doi_url||candidate.openalex_url;
    const doi=normalizePaperDoi(candidate.doi??''),hash=pdf?createHash('sha256').update(pdf).digest('hex'):null;
    await lockPaperIdentity(tx,[source,fulltext?.arxivId??null,doi||null,hash]);
    const matches=await tx<{id:string;has_pdf:boolean;pdf_sha256:string|null;doi:string|null}[]>`SELECT id,(pdf_data IS NOT NULL) AS has_pdf,pdf_sha256,doi FROM papers
      WHERE id=${candidate.paper_id} OR source_url=${source} OR (${doi!==''} AND doi=${doi}) OR (${hash}::text IS NOT NULL AND pdf_sha256=${hash})
      OR (${fulltext?.arxivId??null}::text IS NOT NULL AND arxiv_id=${fulltext?.arxivId??null}) ORDER BY created_at`;
    if(new Set(matches.map(p=>p.id)).size>1)throw Object.assign(new Error('标识符或 PDF 对应多条已有论文，请先核对记录'),{code:'conflict'});
    const existing=matches[0];
    if(doi&&existing?.doi&&existing.doi!==doi)throw Object.assign(new Error('该论文已有不同的 DOI，请先核对身份'),{code:'conflict'});
    if(pdf&&existing?.has_pdf&&existing.pdf_sha256!==hash)throw Object.assign(new Error('已有不同版本的 PDF，本次不会覆盖原文或解读'),{code:'conflict'});
    if(read&&!pdf&&!fulltext&&!existing?.has_pdf)throw Object.assign(new Error('尚无可直接获取的开放 PDF，请上传原文 PDF 后开始精读'),{code:'conflict'});
    let pid=existing?.id;
    if(!pid){
      const [created]=await tx<{id:string}[]>`INSERT INTO papers(id,title,authors,published,topic,abstract,source_url,pdf_url,arxiv_id,version,pdf_data,pdf_sha256)
        VALUES(${randomUUID()},${candidate.title},${candidate.authors},${candidate.publication_date},${candidate.ccf_area},${candidate.abstract??''},
        ${source},${fulltext?.pdfUrl??''},${fulltext?.arxivId??null},${fulltext?.arxivId?'开放预印本（版本未标注）':'发表版本'},${pdf},${hash})
        ON CONFLICT(source_url) DO UPDATE SET source_url=EXCLUDED.source_url RETURNING id`;
      pid=created!.id;
    }
    await tx`UPDATE paper_impact_candidates SET paper_id=${pid} WHERE openalex_id=${id}`;
    const metadata={source:'openalex',publication_year:candidate.publication_year,date_precision:candidate.publication_year?'year':'unknown',
      venue_name:candidate.venue_name,venue_verification:'source_matched',ccf_rank:'A',ccf_catalog:'CCF 2022（2024 名称更新）',
      openalex_id:candidate.openalex_id,citation_count:candidate.citation_count,citation_updated_at:candidate.fetched_at};
    await tx`UPDATE papers SET doi=coalesce(doi,${doi||null}),metadata=metadata||${tx.json(metadata)} WHERE id=${pid}`;
    if(pdf)await tx`UPDATE papers SET pdf_data=coalesce(pdf_data,${pdf}),pdf_sha256=coalesce(pdf_sha256,${hash}) WHERE id=${pid}`;
    await tx`INSERT INTO paper_materials(paper_id,status) VALUES(${pid},'unavailable') ON CONFLICT(paper_id) DO NOTHING`;
    await tx`INSERT INTO paper_digests(paper_id,status) VALUES(${pid},'unavailable') ON CONFLICT(paper_id) DO NOTHING`;
    await ensureCurrentVersion(pid,tx);await saveCollection(pid,{read},tx);
    return pid;
  });
  return paperById(paperId);
}

export const paperImpactSchedule: Scheduled = {
  name: "papers.impact-discovery", cron: "0 7 * * 1", missed: "once", run: runPaperImpactDiscovery,
  when: () => process.env.PAPER_OPENALEX_ENABLED === "true",
};
export const paperImpactQueue=defineQueue<Record<string,never>>({name:'papers.impact-refresh',options:{policy:'short',retryLimit:0,expireInSeconds:900},
  worker:{batchSize:1},async run(){await runPaperImpactDiscovery();}});
export async function refreshPaperImpact(){
  if(process.env.PAPER_OPENALEX_ENABLED!=='true')throw Object.assign(new Error('OpenAlex 检索尚未启用'),{code:'conflict'});
  return {queued:Boolean(await enqueueOn(paperImpactQueue,{}, {singletonKey:'impact'}))};
}
