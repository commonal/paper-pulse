import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {installModules} from '@aihot/backend/modules';
import {buildApp} from '../../../apps/api/src/app.ts';
import papers from '../server.ts';
import {listDiscoveryPlans} from '../backend/discovery.ts';
import {candidateFilters,candidatePage,candidateUrl,groupCandidates,type CandidateRow} from '../candidates.ts';
after(closeDb);

const filters={direction:'',q:'',reading:'' as const,page:1};
function row(id:string,title:string,patch:Partial<CandidateRow>={}):CandidateRow {
  return {id,paper_id:id,title,abstract:'',authors:'Author',published:'2026-10-08',topic:'cs.CL',source_url:'urn:'+id,pdf_url:'',code_url:'',
    version:'v1',status:'unread',has_pdf:false,pdf_sha256:null,created_at:'2026-10-08',plan_id:'hot-ai',plan_title:'AI 热点发现',kind:'hot',reason:'AI',
    categories:['cs.CL'],first_discovered_at:'2026-10-08T00:00:00Z',selected_date:null,digest_status:'unavailable',...patch};
}
test('跨计划候选合并，保留全部来源、阅读队列状态和多个方向，分类也覆盖未开启检索的方向',()=>{
  const input=[row('cross','Multimodal RAG with tool calling',{categories:['cs.IR']}),
    row('cross','Multimodal RAG with tool calling',{plan_id:'personal-multimodal',plan_title:'多模态大模型',kind:'personal',categories:['cs.CV'],selected_date:'2026-10-08'})];
  const [paper]=groupCandidates(input);
  assert.equal(paper!.matches.length,2);assert.equal(paper!.selected_date,'2026-10-08');
  assert.deepEqual(paper!.directions.map(d=>d.id),['personal-rag','personal-multimodal','personal-agent']);
  const page=candidatePage(groupCandidates(input),filters,7);
  assert.equal(page.total,1);assert.equal(page.directions.find(d=>d.id==='personal-agent')!.count,1);
  assert.equal(page.directions[0]!.count,1);
  assert.equal(groupCandidates([row('edge','fragility of aggregate methods')])[0]!.directions[0]!.id,'other');
  assert.deepEqual(groupCandidates([row('plural','A study of LLMs',{abstract:'Large language models use reinforcement learning for reasoning.'})])[0]!.directions.map(d=>d.id),['personal-alignment','personal-reasoning']);
});
test('搜索与精读状态决定分类数量；方向筛选在分页前执行，旧200条之外的结果仍能找到',()=>{
  const rows=Array.from({length:250},(_,i)=>row('p'+i,'Unrelated paper '+i));
  rows.push(row('last','Language model study',{abstract:'We evaluate retrieval augmented generation.',title_zh:'检索增强生成方法',digest_status:'ready'}));
  const papers=groupCandidates(rows);
  const rag=candidatePage(papers,{...filters,direction:'personal-rag'},7);
  assert.equal(rag.total,1);assert.equal(rag.candidates[0]!.id,'last');
  assert.equal(candidatePage(papers,{...filters,q:'检索',reading:'ready'},7).directions[0]!.count,1);
  assert.equal(candidatePage(papers,{...filters,reading:'pending'},7).total,250);
  const last=candidatePage(papers,{...filters,page:999},7);assert.equal(last.filters.page,11);assert.equal(last.candidates.length,11);
  assert.equal(new Set(candidatePage(papers,filters,7).candidates.map(p=>p.id)).size,24);
});
test('分类切换与分页保留搜索和状态，异常页面参数规范化',()=>{
  const value=candidateFilters(new URLSearchParams('direction=personal-rag&q=工具&reading=ready&page=2'));
  const url=candidateUrl(value,{direction:'personal-agent',page:1});
  const params=new URL(url,'http://local').searchParams;
  assert.equal(params.get('q'),'工具');assert.equal(params.get('reading'),'ready');assert.equal(params.get('direction'),'personal-agent');assert.equal(params.has('page'),false);
  assert.deepEqual(candidateFilters(new URLSearchParams('direction=invalid&reading=invalid&page=-1')),filters);
});
test('真实候选API分类、状态与翻页只读；过期、停用和不再命中计划的候选排除',async()=>{
  const previous=config.devAdmin,previousFetch=globalThis.fetch;
  await listDiscoveryPlans();
  const ids=Array.from({length:28},()=>randomUUID());
  for(const [i,id] of ids.entries()){
    const title=i===25?'Multimodal RAG target':i===26?'Stale match':'RAG search '+i;
    await sql`INSERT INTO papers(id,title,abstract,source_url,arxiv_categories) VALUES(${id},${title},'',${'urn:candidate-test:'+id},ARRAY['cs.CL'])`;
    await sql`INSERT INTO paper_candidates(paper_id,plan_id,first_discovered_at,matched_categories,selected_date) VALUES(${id},${i===27?'personal-code':'personal-rag'},
      ${new Date(Date.now()-(i===24?15:0)*86400000)},ARRAY['cs.CL'],${i===25?'2026-10-08':null}::date)`;
  }
  await sql`INSERT INTO paper_candidates(paper_id,plan_id,matched_categories) VALUES(${ids[25]!},'hot-ai',ARRAY['cs.CL'])`;
  await sql`INSERT INTO paper_digests(paper_id,status,sections) VALUES(${ids[25]!},'ready','[]'::jsonb)`;
  config.devAdmin={displayName:'Candidates test'};installModules([papers]);const app=await buildApp();await app.ready();
  try{
    globalThis.fetch=(async()=>{throw new Error('candidate reads must not access providers');}) as typeof fetch;
    const before=await sql`SELECT count(*)::int AS n FROM receipt_attempts`;
    const plansBefore=await sql`SELECT id,enabled,preferences FROM paper_discovery_plans ORDER BY id`;
    const all=await app.inject('/api/admin/papers/candidates');assert.equal(all.statusCode,200);assert.equal(all.json().total,25);assert.equal(all.json().candidates.length,24);
    const second=(await app.inject('/api/admin/papers/candidates?page=2')).json();assert.equal(second.candidates.length,1);
    const allIds=[...all.json().candidates,...second.candidates].map(p=>p.paper_id);assert.equal(new Set(allIds).size,25);
    const selected=(await app.inject('/api/admin/papers/candidates?direction=personal-multimodal&reading=ready&q=target')).json();
    assert.equal(selected.total,1);assert.equal(selected.candidates[0].matches.length,2);
    assert.equal(selected.directions.find((d:{id:string})=>d.id==='personal-rag').count,1);
    assert.equal((await app.inject('/api/admin/papers/candidates?direction=unknown')).statusCode,400);
    assert.equal((await app.inject('/api/admin/papers/candidates?page=0')).statusCode,400);
    assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipt_attempts`,before);
    assert.deepEqual(await sql`SELECT id,enabled,preferences FROM paper_discovery_plans ORDER BY id`,plansBefore);
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/papers/candidates')).statusCode,401);
  }finally{
    globalThis.fetch=previousFetch;config.devAdmin=previous;installModules([]);await app.close();await sql`DELETE FROM papers WHERE id IN ${sql(ids)}`;
  }
});
