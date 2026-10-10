import {matchPlan,planPreferences,type DiscoveryPlan} from '../directions.ts';

export type SelectionCandidate={paperId:string;title:string;abstract:string;categories:string[];published:string;planIds:string[]};
export type DirectionHistory={count:number;lastDate:string};
export function selectCandidates(candidates:SelectionCandidate[],plans:DiscoveryPlan[],history:Map<string,DirectionHistory>,limit:number,hotLimit:number){
  const active=plans.filter(p=>p.enabled);
  const items=candidates.map(paper=>({paper,matches:active.filter(plan=>paper.planIds.includes(plan.id)).flatMap(plan=>{
    const match=matchPlan(plan,paper);return match?[{plan,...match}]:[];
  })})).filter(item=>item.matches.length);
  const chosen:{paperId:string;plans:string[];primaryPlanId:string;sourceKind:'hot'|'personal';reason:string;score:number}[]=[];
  const selected=new Set<string>();
  const take=(item:typeof items[number],match:typeof item.matches[number])=>{
    selected.add(item.paper.paperId);
    chosen.push({paperId:item.paper.paperId,plans:item.matches.map(m=>m.plan.id),primaryPlanId:match.plan.id,sourceKind:match.plan.kind,reason:match.reason,score:match.score});
  };
  const ranked=(plan:DiscoveryPlan)=>items.filter(i=>!selected.has(i.paper.paperId)&&i.matches.some(m=>m.plan.id===plan.id))
    .sort((a,b)=>b.matches.find(m=>m.plan.id===plan.id)!.score-a.matches.find(m=>m.plan.id===plan.id)!.score||b.paper.published.localeCompare(a.paper.published)||a.paper.paperId.localeCompare(b.paper.paperId));
  for(const hot of active.filter(p=>p.kind==='hot'))for(const item of ranked(hot).slice(0,Math.min(Math.max(0,hotLimit-chosen.length),limit-chosen.length)))take(item,item.matches.find(m=>m.plan.id===hot.id)!);
  const served=new Map([...history].map(([id,value])=>[id,{...value}]));
  while(chosen.length<limit){
    const eligible=active.filter(p=>p.kind==='personal'&&ranked(p).length);
    eligible.sort((a,b)=>(served.get(a.id)?.count??0)-(served.get(b.id)?.count??0)
      ||Number(planPreferences(b).priority)-Number(planPreferences(a).priority)
      ||(served.get(a.id)?.lastDate??'').localeCompare(served.get(b.id)?.lastDate??'')||a.id.localeCompare(b.id));
    const plan=eligible[0];if(!plan)break;
    const item=ranked(plan)[0]!;take(item,item.matches.find(m=>m.plan.id===plan.id)!);
    const prev=served.get(plan.id);served.set(plan.id,{count:(prev?.count??0)+1,lastDate:prev?.lastDate??''});
  }
  return chosen;
}
