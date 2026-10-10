import type {Paper} from './types.ts';
import {candidateFilters,candidateUrl,type CandidateFilters} from './candidates.ts';

export interface ImpactCandidate {
  openalex_id:string;doi:string|null;title:string;authors:string;publication_year:number|null;publication_date:string;
  venue_name:string;venue_type:string;venue_url:string;ccf_area:string;ccf_rank:string;citation_count:number|null;
  citation_percentile_min:number|null;citation_percentile_max:number|null;openalex_url:string;doi_url:string;open_access_url:string;
  plan_ids:string[];fetched_at:string;abstract:string|null;pdf_url:string|null;paper_id:string|null;paper:Paper|null;
}
export interface ImpactFilters extends CandidateFilters {age:''|'older'|'recent';venue:string}
export const impactFilters=(params:URLSearchParams):ImpactFilters=>({...candidateFilters(params),
  age:params.get('age')==='older'?'older':params.get('age')==='recent'?'recent':'',venue:(params.get('venue')??'').slice(0,300)});
export function impactUrl(filters:ImpactFilters,patch:Partial<ImpactFilters>={}){
  const value={...filters,...patch},url=new URL(candidateUrl(value),'http://local');
  if(value.age)url.searchParams.set('age',value.age);
  if(value.venue)url.searchParams.set('venue',value.venue);
  return '/papers/impact'+url.search;
}
export interface ImpactData {
  status:{state:'idle'|'running'|'ready'|'failed';candidate_count:number;query_start:string|null;query_end:string|null;error:string|null;captured_at:string|null};
  candidates:ImpactCandidate[];venues:{venue_name:string;candidate_count:number}[];directions:{id:string;title:string;count:number}[];
  filters:ImpactFilters;total:number;pageSize:number;
}
