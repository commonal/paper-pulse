import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {config} from '@aihot/backend/config';
import {installModules} from '@aihot/backend/modules';
import {buildApp} from '../../../apps/api/src/app.ts';
import module from '../server.ts';
import {DIRECTIONS,defaultPreferences,matchPlan,containsTerm,arxivExpression,openAlexExpression,type DiscoveryPlan} from '../directions.ts';
import {selectCandidates} from '../backend/selection.ts';
import {listDiscoveryPlans,selectToday} from '../backend/discovery.ts';
after(async()=>{await stopBoss();await closeDb();});

function plan(id:string):DiscoveryPlan{
  const direction=DIRECTIONS.find(d=>d.id===id)!;
  return {id,kind:'personal',title:direction.title,categories:direction.categories,keywords:[],enabled:true,updated_at:'',preferences:defaultPreferences()};
}
test('RAG uses word boundaries, precise title scope and normalized hyphens',()=>{
  const rag=plan('personal-rag');
  assert.equal(containsTerm('fragility and aggregate results','RAG'),false);
  assert.ok(matchPlan(rag,{title:'Retrieval-Augmented Generation for QA',abstract:'',categories:['cs.CL']}));
  assert.equal(matchPlan(rag,{title:'Unrelated vision methods',abstract:'We compare retrieval augmented generation.',categories:['cs.CL']}),null);
  rag.preferences!.precision='broad';assert.ok(matchPlan(rag,{title:'Unrelated vision methods',abstract:'We compare retrieval augmented generation.',categories:['cs.CL']}));
});
test('topic restrictions, exclusion and required recommendation/LLM groups share query semantics',()=>{
  const rec=plan('personal-llm-rec');
  assert.equal(matchPlan(rec,{title:'Large language models for search',abstract:'',categories:['cs.IR']}),null);
  assert.equal(matchPlan(rec,{title:'Sequential recommendation with graph networks',abstract:'',categories:['cs.IR']}),null);
  assert.ok(matchPlan(rec,{title:'LLM-based recommendation',abstract:'',categories:['cs.IR']}));
  const multi=plan('personal-multimodal');multi.preferences!.topicIds=['video'];
  assert.equal(matchPlan(multi,{title:'Vision language models',abstract:'',categories:['cs.CV']}),null);
  assert.ok(matchPlan(multi,{title:'Video understanding with language models',abstract:'',categories:['cs.CV']}));
  multi.preferences!.excludedKeywords=['medical'];assert.equal(matchPlan(multi,{title:'Video understanding with language models',abstract:'medical applications',categories:['cs.CV']}),null);
  assert.match(arxivExpression(multi),/ti:"video"/);assert.match(arxivExpression(multi),/ANDNOT/);
  assert.match(openAlexExpression(multi),/AND/);assert.match(openAlexExpression(multi),/NOT \("medical"\)/);
});
test('existing custom conditions remain usable and extra preset words explicitly expand matches',()=>{
  const rag=plan('personal-rag');rag.preferences=null;rag.keywords=['custom keyword'];rag.categories=['cs.DB'];
  assert.ok(matchPlan(rag,{title:'custom keyword system',abstract:'',categories:['cs.DB']}));
  assert.equal(matchPlan(rag,{title:'RAG models',abstract:'',categories:['cs.CL']}),null);
  rag.preferences=defaultPreferences();rag.preferences.extraKeywords=['knowledge graph'];
  assert.ok(matchPlan(rag,{title:'Knowledge graph methods',abstract:'',categories:['cs.AI']}));
});
test('selection rotates scarce slots, breaks equal counts by priority and deduplicates cross-direction papers',()=>{
  const plans=[plan('personal-rag'),plan('personal-multimodal'),plan('personal-llm-rec')];
  plans[0].preferences!.priority=true;
  const candidates=[
    {paperId:'rag',title:'RAG for search',abstract:'',categories:['cs.IR'],published:'2026-10-08',planIds:[plans[0].id]},
    {paperId:'multi',title:'Multimodal vision language models',abstract:'',categories:['cs.CV'],published:'2026-10-08',planIds:[plans[1].id]},
    {paperId:'rec',title:'Generative recommendation',abstract:'',categories:['cs.IR'],published:'2026-10-08',planIds:[plans[2].id]},
    {paperId:'cross',title:'Multimodal RAG',abstract:'',categories:['cs.CL'],published:'2026-10-07',planIds:[plans[0].id,plans[1].id]},
  ];
  const first=selectCandidates(candidates,plans,new Map(),2,0);assert.equal(first[0].primaryPlanId,plans[0].id);
  assert.equal(new Set(first.map(p=>p.primaryPlanId)).size,2);assert.equal(new Set(first.map(p=>p.paperId)).size,2);
  const history=new Map(first.map(p=>[p.primaryPlanId,{count:1,lastDate:'2026-10-07'}]));
  const next=selectCandidates(candidates,plans,history,1,0);assert.equal(next[0].primaryPlanId,plans.find(p=>!history.has(p.id))!.id);
  const onlyCross=selectCandidates(candidates.slice(3),plans,new Map(),3,0);assert.equal(onlyCross.length,1);
  plans[1].enabled=false;assert.ok(selectCandidates(candidates,plans,new Map(),3,0).every(p=>p.primaryPlanId!==plans[1].id));
});
test('API preserves existing custom rows, validates topics, previews unsaved conditions without mutations or provider calls',async()=>{
  const previous=config.devAdmin,previousFetch=globalThis.fetch;
  await listDiscoveryPlans();
  await sql`UPDATE paper_discovery_plans SET categories=ARRAY['cs.DB'],keywords=ARRAY['custom keyword'],preferences=NULL WHERE id='personal-rag'`;
  const plans=await listDiscoveryPlans();assert.equal(plans.length,9);assert.equal(plans.filter(p=>p.enabled).length,4);
  assert.deepEqual(plans.find(p=>p.id==='personal-rag')!.keywords,['custom keyword']);
  const id=randomUUID();await sql`INSERT INTO papers(id,title,abstract,source_url,topic,arxiv_categories) VALUES(${id},'Agentic RAG with tools','retrieval augmented generation',${'urn:preview:'+id},'cs.CL',ARRAY['cs.CL'])`;
  config.devAdmin={displayName:'Direction test'};installModules([module]);const app=await buildApp();await app.ready();
  const headers={'x-csrf-token':'dev'};
  try{
    const payload={plans:[{id:'personal-rag',enabled:true,preferences:{...defaultPreferences(),topicIds:['agentic-rag']}}],days:7};
    const before=await sql`SELECT preferences,keywords FROM paper_discovery_plans WHERE id='personal-rag'`;
    const receipts=await sql`SELECT count(*)::int AS n FROM receipts`;
    globalThis.fetch=(async()=>{throw new Error('preview must not call a provider');}) as typeof fetch;
    assert.equal((await app.inject({method:'POST',url:'/api/admin/papers/plans/preview',payload})).statusCode,403);
    const preview=await app.inject({method:'POST',url:'/api/admin/papers/plans/preview',headers,payload});assert.equal(preview.statusCode,200);
    assert.ok(preview.json().matches.some((p:{id:string;reasons:{reason:string}[]})=>p.id===id&&p.reasons[0].reason.includes('Agentic RAG')));
    assert.deepEqual(await sql`SELECT preferences,keywords FROM paper_discovery_plans WHERE id='personal-rag'`,before);
    assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipts`,receipts);
    const invalid=await app.inject({method:'PATCH',url:'/api/admin/papers/plans/personal-rag',headers,payload:{preferences:{...defaultPreferences(),topicIds:['video']}}});assert.equal(invalid.statusCode,400);
    const saved=await app.inject({method:'PATCH',url:'/api/admin/papers/plans/personal-rag',headers,payload:{preferences:{...defaultPreferences(),topicIds:['agentic-rag'],priority:true}}});assert.equal(saved.statusCode,200);
    assert.equal(saved.json().preferences.priority,true);assert.deepEqual(saved.json().keywords,['custom keyword']);
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/papers/plans')).statusCode,401);
  }finally{globalThis.fetch=previousFetch;config.devAdmin=previous;installModules([]);await app.close();}
});
test('daily queue rejects stale keyword matches, records primary direction and remains idempotent',async()=>{
  await sql`UPDATE paper_discovery_plans SET enabled=false`;
  const rag=plan('personal-rag'),multi=plan('personal-multimodal');
  for(const p of [rag,multi])await sql`UPDATE paper_discovery_plans SET enabled=true,preferences=${sql.json({...p.preferences!})} WHERE id=${p.id}`;
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  for(const [i,id] of ids.entries()){
    await sql`INSERT INTO papers(id,title,abstract,source_url,published,arxiv_categories) VALUES(${id},${['RAG for search','Multimodal understanding','Unrelated old match'][i]},'',${'urn:rotation:'+id},'2026-10-08',ARRAY['cs.CL'])`;
    await sql`INSERT INTO paper_candidates(paper_id,plan_id,matched_categories,matched_keywords,score) VALUES(${id},${i===1?multi.id:rag.id},ARRAY['cs.CL'],ARRAY['old keyword'],100)`;
  }
  const now=new Date('2026-10-08T04:00:00Z');
  const first=await selectToday(now);assert.equal(first.length,2);
  const rows=await sql`SELECT paper_id,primary_plan_id,reason FROM paper_daily_queue WHERE queue_date='2026-10-08'`;
  assert.equal(rows.length,2);assert.ok(!rows.some(row=>row.paper_id===ids[2]));
  assert.equal(new Set(rows.map(row=>row.primary_plan_id)).size,2);assert.ok(rows.every(row=>!row.reason.includes('old keyword')));
  assert.equal((await selectToday(now)).length,0);
});
