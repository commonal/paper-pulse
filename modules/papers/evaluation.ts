import type {ReadingStage,ReadingStatus,PaperDigestSection} from './types.ts';

export interface ReadingEvent {id:number;run_id:string;stage:string;status:string;action:string;error:string|null;receipt_id:number|null;recorded_at:string}
export interface ReadingRun {run_id:string;paper_id:string;version_id:string|null;title:string;kind:'full'|'illustrations';initial_observed:boolean;status:ReadingStatus|'superseded';stage:ReadingStage;cached_digest:boolean;started_at:string;updated_at:string;finished_at:string|null;error:string|null;receipt_id:number|null}
export const stageLabels:Record<ReadingStage,string>={material:'正文解析',coverage:'覆盖检查',reading:'Skill 精读',review:'原文核查',illustrations:'图表解读',complete:'完整完成'};
export function failureCategory(error:string|null){
  if(!error)return '未知';
  if(/预算|额度/.test(error))return '预算等待';
  if(/未启用|未配置|not configured|disabled/i.test(error))return '服务配置';
  if(/结果尚未取回|回执恢复|同一请求正在执行/.test(error))return '请求结果未知或占用';
  if(/长度上限|finish_reason=length|截断/.test(error))return '输出截断';
  if(/结构校验|JSON|未知.*(?:片段|出处)|字段/.test(error))return '结构或引用校验';
  if(/核查|矛盾|主张/.test(error))return '内容核查';
  if(/HTTP|fetch|timeout|网络|超时|供应商/i.test(error))return '外部服务';
  if(/正文|覆盖|PDF|定位/.test(error))return '原文材料';
  if(/中断/.test(error))return '执行中断';
  return '其他';
}
const rate=(n:number,d:number)=>({numerator:n,denominator:d,percent:d?Math.round(n/d*1000)/10:null});
const percentile=(values:number[],p:number)=>values.length?values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]!:null;
export function summarizeReadingRuns(runs:ReadingRun[],events:ReadingEvent[]){
  // A recovered legacy run and a figure-only upgrade cannot establish first-pass full-reading success.
  const measured=runs.filter(r=>r.initial_observed&&r.kind==='full');
  const resolved=measured.filter(r=>['ready','failed','unavailable'].includes(r.status));
  const complete=measured.filter(r=>r.status==='ready'&&r.stage==='complete');
  const interrupted=new Set(events.filter(e=>['failed','unavailable','waiting'].includes(e.status)||e.action.startsWith('resume_')).map(e=>e.run_id));
  const clean=complete.filter(r=>!interrupted.has(r.run_id));
  const fromFailure=new Set(events.filter(e=>['failed','unavailable'].includes(e.status)).map(e=>e.run_id));
  const recovered=complete.filter(r=>fromFailure.has(r.run_id));
  const measuredIds=new Set(measured.map(r=>r.run_id));
  const failures=events.filter(e=>measuredIds.has(e.run_id)&&['failed','unavailable'].includes(e.status));
  const groups=new Map<string,{stage:string;category:string;runs:Set<string>;events:number}>();
  for(const e of failures){const category=failureCategory(e.error),key=e.stage+'|'+category;const g=groups.get(key)??{stage:e.stage,category,runs:new Set<string>(),events:0};g.runs.add(e.run_id);g.events++;groups.set(key,g);}
  const durations=complete.flatMap(r=>r.finished_at?[Math.max(0,new Date(r.finished_at).getTime()-new Date(r.started_at).getTime())/1000]:[]);
  const fresh=measured.filter(r=>!r.cached_digest),freshComplete=fresh.filter(r=>r.status==='ready'&&r.stage==='complete');
  return {started:measured.length,resolved:resolved.length,completed:complete.length,firstPass:rate(clean.length,resolved.length),
    completion:rate(complete.length,resolved.length),allStartedCompletion:rate(complete.length,measured.length),
    freshCompletion:rate(freshComplete.length,fresh.filter(r=>['ready','failed','unavailable'].includes(r.status)).length),
    recovered:recovered.length,waiting:measured.filter(r=>r.status==='waiting').length,active:measured.filter(r=>['queued','running'].includes(r.status)).length,
    failed:measured.filter(r=>['failed','unavailable'].includes(r.status)).length,superseded:measured.filter(r=>r.status==='superseded').length,
    legacy:runs.filter(r=>!r.initial_observed).length,figureOnly:runs.filter(r=>r.kind==='illustrations').length,cached:measured.filter(r=>r.cached_digest).length,
    p50Seconds:percentile(durations,.5),p95Seconds:percentile(durations,.95),
    failures:[...groups.values()].map(g=>({stage:g.stage,category:g.category,runs:g.runs.size,events:g.events})).sort((a,b)=>b.runs-a.runs),
    smallSample:resolved.length<20};
}
export const QUALITY_DIMENSIONS=['factuality','numbers','coverage','boundaries','figures','readability'] as const;
export const dimensionLabels={factuality:'事实与出处',numbers:'实验数字与条件',coverage:'重要内容覆盖',boundaries:'局限与证据边界',figures:'图表解释',readability:'中文可读性'};
export type QualityVerdict='supported'|'contradicted'|'insufficient'|'source_conflict';
export interface NumericAudit {quantity:string;readings:{quote_id:string;value:string}[];agreement:'consistent'|'conflict'|'single_source'|'not_comparable';reason:string}
export interface QualityEvaluationSummary {id:string;paper_id:string;version_id:string;title:string;status:string;model:string|null;receipt_id:number|null;error:string|null;created_at:string;updated_at:string;input_hash:string;rubric_version:string;result:QualityResult|null;assessed_sections:PaperDigestSection[];digest_receipt_id:number|null;calibration_label?:string|null}
export interface QualityResult {
  summary:string;claim_checks:{claim_id:string;verdict:QualityVerdict;reason:string;quote_ids:string[];numeric_audit?:NumericAudit[]}[];
  dimensions:{id:typeof QUALITY_DIMENSIONS[number];score:number|null;reason:string;quote_ids:string[]}[];
  omissions:{description:string;severity:'major'|'minor';quote_ids:string[]}[];
  quotes:{quote_id:string;block_id:string;page?:number;text:string}[];
  referenceRepairs?:{provided:string;resolved:string[];scope:'whole_block'}[];
  numericFormatRepairs?:{quoteId:string;provided:string;resolved:string;basis:'table_percent_header'}[];
  calibration?:{suite:string;passed:number;total:number;checks:{claimId:string;expected:QualityVerdict;observed:QualityVerdict;matched:boolean}[]};
  hardChecks:{claims:number;unknownEvidenceIds:string[];unreferencedDirectClaims:string[];sourceBlocks:number;sourceChars:number;figures:number;visualFigures:number};
  visualScope:string;sameModel:boolean;judgeModel:string;digestModel:string;
}
