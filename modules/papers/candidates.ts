import {DIRECTIONS,defaultPreferences,matchPlan} from './directions.ts';
import type {Paper} from './types.ts';

export const CANDIDATE_DIRECTIONS=[...DIRECTIONS.map(d=>({id:d.id,title:d.title})),{id:'other',title:'其他方向'}];
export interface CandidateRow extends Paper {
  paper_id:string;plan_id:string;plan_title:string;kind:'hot'|'personal';reason:string;
  categories:string[];first_discovered_at:string;selected_date:string|null;
}
export interface PaperCandidate extends Paper {
  paper_id:string;first_discovered_at:string;selected_date:string|null;
  directions:{id:string;title:string}[];
  matches:{plan_id:string;plan_title:string;kind:'hot'|'personal';reason:string}[];
}
export interface CandidateFilters {direction:string;q:string;reading:''|'pending'|'ready';page:number}
export interface CandidatePage {
  candidates:PaperCandidate[];directions:{id:string;title:string;count:number}[];
  filters:CandidateFilters;total:number;pageSize:number;days:number;
}
export function candidateFilters(params:URLSearchParams):CandidateFilters {
  const direction=params.get('direction')??'',reading=params.get('reading')??'';
  const page=Number(params.get('page')??1);
  return {direction:CANDIDATE_DIRECTIONS.some(d=>d.id===direction)?direction:'',q:(params.get('q')??'').trim().slice(0,200),
    reading:reading==='pending'||reading==='ready'?reading:'',page:Number.isSafeInteger(page)&&page>0?page:1};
}
function classify(paper:Paper,categories:string[]) {
  // Browsing labels recognize common plural forms without changing a user's discovery rules.
  const singular=(text:string)=>text.replace(/\b(models|llms|vlms|transformers|recommendations|recommenders|agents|benchmarks)\b/gi,word=>word.slice(0,-1));
  const directions=DIRECTIONS.filter(d=>matchPlan({id:d.id,title:d.title,kind:'personal',enabled:true,categories:d.categories,keywords:[],updated_at:'',
    preferences:{...defaultPreferences(),precision:'broad'}},{title:singular(paper.title),abstract:singular(paper.abstract),categories},false));
  return directions.length?directions.map(d=>({id:d.id,title:d.title})):[{id:'other',title:'其他方向'}];
}
export function groupCandidates(rows:CandidateRow[]):PaperCandidate[] {
  const grouped=new Map<string,PaperCandidate>();
  for(const row of rows){
    const {plan_id,plan_title,kind,reason,categories,...paper}=row;
    const match={plan_id,plan_title,kind,reason},previous=grouped.get(row.paper_id);
    if(previous){
      if(!previous.matches.some(m=>m.plan_id===plan_id))previous.matches.push(match);
      if(row.selected_date)previous.selected_date=row.selected_date;
    }else grouped.set(row.paper_id,{...paper,directions:classify(paper,categories),matches:[match]});
  }
  return [...grouped.values()];
}
export function candidatePage(papers:PaperCandidate[],filters:CandidateFilters,days:number):CandidatePage {
  const terms=filters.q.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  const searched=papers.filter(p=>{
    if(filters.reading==='ready'&&p.digest_status!=='ready'||filters.reading==='pending'&&p.digest_status==='ready')return false;
    const text=[p.title,p.title_zh,p.authors,p.abstract,p.summary_zh,p.topic,...p.directions.map(d=>d.title)]
      .join(' ').normalize('NFKC').toLowerCase();
    return terms.every(term=>text.includes(term));
  });
  const directions=[{id:'',title:'全部',count:searched.length},...CANDIDATE_DIRECTIONS.map(d=>({...d,count:searched.filter(p=>p.directions.some(t=>t.id===d.id)).length}))];
  const matched=searched.filter(p=>!filters.direction||p.directions.some(d=>d.id===filters.direction));
  const pageSize=24,page=Math.min(filters.page,Math.max(1,Math.ceil(matched.length/pageSize)));
  return {candidates:matched.slice((page-1)*pageSize,page*pageSize),directions,filters:{...filters,page},total:matched.length,pageSize,days};
}
export function candidateUrl(filters:CandidateFilters,patch:Partial<CandidateFilters>={}) {
  const value={...filters,...patch},params=new URLSearchParams();
  if(value.direction)params.set('direction',value.direction);
  if(value.q)params.set('q',value.q);
  if(value.reading)params.set('reading',value.reading);
  if(value.page>1)params.set('page',String(value.page));
  return '/papers/candidates'+(params.size?'?'+params:'');
}
