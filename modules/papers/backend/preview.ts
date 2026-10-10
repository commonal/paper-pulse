import {sql} from '@aihot/backend/db';
import {matchPlan,type DiscoveryPlan} from '../directions.ts';

/** Preview unsaved rules against bounded local metadata. No collection, queue or provider call. */
export async function previewDirections(plans:DiscoveryPlan[],days:number){
  const rows=await sql<{id:string;title:string;abstract:string;published:string;categories:string[]}[]>`SELECT p.id,p.title,p.abstract,p.published,
    coalesce(p.arxiv_categories,nullif(ARRAY(SELECT DISTINCT unnest(c.matched_categories) FROM paper_candidates c WHERE c.paper_id=p.id),'{}'::text[]),ARRAY[p.topic]) AS categories
    FROM papers p WHERE p.created_at>=now()-(${days}*interval '1 day') ORDER BY p.published DESC,p.created_at DESC,p.id LIMIT 501`;
  const sample=rows.slice(0,500);
  const matches=sample.flatMap(paper=>{
    const reasons=plans.filter(plan=>plan.enabled).flatMap(plan=>{const match=matchPlan(plan,paper);return match?[{planId:plan.id,reason:match.reason}]:[];});
    return reasons.length?[{...paper,abstract:paper.abstract.slice(0,400),reasons}]:[];
  });
  return {sampled:sample.length,matched:matches.length,capped:rows.length>500,matches:matches.slice(0,20)};
}
