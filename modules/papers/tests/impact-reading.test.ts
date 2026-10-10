import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {installModules} from '@aihot/backend/modules';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {buildApp} from '../../../apps/api/src/app.ts';
import papers from '../server.ts';
import {impactFulltext,startImpactReading,paperImpactResults,runPaperImpactDiscovery} from '../backend/impact.ts';
import {parsePaperMaterial} from '../backend/material.ts';
import {pdfById} from '../backend/store.ts';
import {impactFilters,impactUrl} from '../impact.ts';
import {matchCcfAVenue} from '../backend/ccf-venues.ts';
import {listDiscoveryPlans} from '../backend/discovery.ts';
after(async()=>{await stopBoss();await closeDb();});

test('高引全文只选择明确 PDF 或 arXiv；过滤条件可随方向切换及翻页保留',()=>{
  assert.deepEqual(impactFulltext({pdf_url:null,open_access_url:'https://arxiv.org/abs/1706.03762v2'}),
    {pdfUrl:'https://arxiv.org/pdf/1706.03762v2',arxivId:'1706.03762',sourceUrl:'https://arxiv.org/abs/1706.03762v2'});
  assert.equal(impactFulltext({pdf_url:null,open_access_url:'https://publisher.org/paper'}),null);
  assert.equal(impactFulltext({pdf_url:'http://user:secret@example.org/a.pdf',open_access_url:''}),null);
  assert.equal(impactFulltext({pdf_url:'https://publisher.org/download?id=1',open_access_url:''})?.pdfUrl,'https://publisher.org/download?id=1');
  assert.equal(impactFulltext({pdf_url:null,open_access_url:'',doi_url:'http://jmlr.org/papers/v15/srivastava14a.html'})?.pdfUrl,'https://jmlr.org/papers/v15/srivastava14a.html');
  assert.equal(matchCcfAVenue('Journal of Artificial Intelligence Research'),null);
  assert.equal(matchCcfAVenue('American Association for Artificial Intelligence eBooks'),null);
  assert.equal(matchCcfAVenue('Artificial Intelligence')?.acronym,'Artificial Intelligence');
  const filters=impactFilters(new URLSearchParams('direction=personal-rag&q=经典&reading=ready&age=older&venue=SIGIR&page=2'));
  const url=new URL(impactUrl(filters,{page:3}),'http://local');
  assert.equal(url.pathname,'/papers/impact');assert.equal(url.searchParams.get('age'),'older');assert.equal(url.searchParams.get('venue'),'SIGIR');
  assert.equal(url.searchParams.get('reading'),'ready');assert.equal(url.searchParams.get('page'),'3');
});

test('worker 才获取高引全文：阻止私网地址，拒绝HTML，保存真实PDF；未启用MinerU不冒充完成',async()=>{
  const previous=config.allowPrivateNetworkFetch,enabled=process.env.MINERU_CALLS_ENABLED,dispatcher=getGlobalDispatcher();
  const mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);process.env.MINERU_CALLS_ENABLED='false';
  const id='W'+(Date.now()+9);let pid='';
  try{
    await sql`INSERT INTO paper_impact_candidates(openalex_id,title,venue_name,openalex_url,doi_url,pdf_url) VALUES(${id},'Private network reading fixture','SIGIR',${'https://openalex.org/'+id},${'https://doi.org/10.1234/'+id},'https://127.0.0.1/paper.pdf')`;
    const paper=await startImpactReading(id);pid=paper!.id;
    config.allowPrivateNetworkFetch=false;await assert.rejects(parsePaperMaterial(paper!),/private|blocked|not allowed/i);assert.equal(await pdfById(pid),null);
    config.allowPrivateNetworkFetch=true;
    mock.get('https://127.0.0.1').intercept({path:'/paper.pdf'}).reply(200,'<html>login</html>');
    await assert.rejects(parsePaperMaterial(paper!),/有效 PDF/);assert.equal(await pdfById(pid),null);
    const pdf=Buffer.from('%PDF-1.4\nfixture\n%%EOF');
    await sql`UPDATE paper_impact_candidates SET pdf_url=NULL,doi_url='https://jmlr.org/papers/fixture.html' WHERE openalex_id=${id}`;
    mock.get('https://jmlr.org').intercept({path:'/papers/fixture.html'}).reply(200,'<a href="https://other.test/unrelated.pdf">other</a><a href="http://[">invalid</a><a href="fixture.pdf">PDF</a>');
    mock.get('https://jmlr.org').intercept({path:'/papers/fixture.pdf'}).reply(200,pdf);
    const result=await parsePaperMaterial(paper!);assert.equal(result.status,'unavailable');assert.match(result.error!,/MinerU/i);
    assert.deepEqual(await pdfById(pid),pdf);assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE subject=${'paper:'+pid}`)[0].n,0);
  }finally{config.allowPrivateNetworkFetch=previous;if(enabled===undefined)delete process.env.MINERU_CALLS_ENABLED;else process.env.MINERU_CALLS_ENABLED=enabled;
    setGlobalDispatcher(dispatcher);await mock.close();await sql`DELETE FROM paper_impact_candidates WHERE openalex_id=${id}`;if(pid)await sql`DELETE FROM papers WHERE id=${pid}`;}
});

test('带密钥的OpenAlex查询经过预算和回执，精确重放复用结果而不重复请求',async()=>{
  const key=process.env.OPENALEX_API_KEY,previousFetch=globalThis.fetch;let calls=0;
  process.env.OPENALEX_API_KEY='local-test-key';await listDiscoveryPlans();
  const [budget]=await sql`SELECT * FROM budgets WHERE service='openalex'`;
  await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day,note) VALUES('openalex',0,0,0,'test') ON CONFLICT(service) DO UPDATE SET per_minute=0,per_hour=0,per_day=0`;
  globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({results:[]}));}) as typeof fetch;
  try{
    await assert.rejects(runPaperImpactDiscovery(),/Budget for openalex exhausted/);assert.equal(calls,0);
    await sql`UPDATE budgets SET per_minute=20,per_hour=40,per_day=100 WHERE service='openalex'`;
    await runPaperImpactDiscovery();assert.equal(calls,4);
    await runPaperImpactDiscovery();assert.equal(calls,4);
    const rows=await sql`SELECT status FROM receipts WHERE service='openalex'`;assert.equal(rows.length,4);assert.ok(rows.every(r=>r.status==='completed'));
  }finally{
    globalThis.fetch=previousFetch;if(key===undefined)delete process.env.OPENALEX_API_KEY;else process.env.OPENALEX_API_KEY=key;
    await sql`DELETE FROM receipts WHERE service='openalex'`;
    if(budget)await sql`UPDATE budgets SET per_minute=${budget.per_minute},per_hour=${budget.per_hour},per_day=${budget.per_day},note=${budget.note} WHERE service='openalex'`;else await sql`DELETE FROM budgets WHERE service='openalex'`;
  }
});

test('高引列表只读；显式精读持久化关联并复用任务，已读不重新购买，缺全文用同篇上传PDF',async()=>{
  const previous=config.devAdmin,previousFetch=globalThis.fetch;
  config.devAdmin={displayName:'Impact test'};installModules([papers]);const app=await buildApp();await app.ready();
  const ids=['W'+Date.now(),'W'+(Date.now()+1)];const paperIds:string[]=[];
  const headers={'x-csrf-token':'dev'};
  try{
    for(const [i,id] of ids.entries())await sql`INSERT INTO paper_impact_candidates(openalex_id,title,publication_year,venue_name,ccf_area,citation_count,openalex_url,doi_url,open_access_url,pdf_url,abstract,plan_ids)
      VALUES(${id},${'Classic retrieval '+id},${i?2025:2010},'SIGIR','数据库/数据挖掘/内容检索',${i?50:5000},${'https://openalex.org/'+id},${'https://doi.org/10.9999/'+id},'',${i?null:'https://publisher.org/'+id+'.pdf'},'retrieval methods',ARRAY['personal-rag'])`;
    globalThis.fetch=(async()=>{throw new Error('reads/import must not call providers');}) as typeof fetch;
    const before=await sql`SELECT count(*)::int AS n FROM receipt_attempts`;
    const listing=await app.inject('/api/admin/papers/impact?direction=personal-rag&age=older');assert.equal(listing.statusCode,200);
    assert.ok(listing.json().candidates.some((c:{openalex_id:string})=>c.openalex_id===ids[0]));
    assert.ok(!listing.json().candidates.some((c:{openalex_id:string})=>c.openalex_id===ids[1]));
    assert.equal((await app.inject({method:'POST',url:`/api/admin/papers/impact/${ids[0]}/read`,payload:{}})).statusCode,403);
    const request=()=>app.inject({method:'POST',url:`/api/admin/papers/impact/${ids[0]}/read`,headers,payload:{}});
    const created=await request();assert.equal(created.statusCode,202);const pid=created.json().id;paperIds.push(pid);
    const [task]=await sql`SELECT run_id,status,stage FROM paper_reading_tasks WHERE paper_id=${pid}`;assert.equal(task.status,'queued');assert.equal(task.stage,'material');
    const repeated=await request();assert.equal(repeated.json().id,pid);
    assert.equal((await sql`SELECT run_id FROM paper_reading_tasks WHERE paper_id=${pid}`)[0].run_id,task.run_id);
    await sql`UPDATE paper_digests SET status='ready' WHERE paper_id=${pid}`;
    await sql`UPDATE paper_reading_tasks SET status='ready',stage='complete' WHERE paper_id=${pid}`;
    assert.equal((await request()).json().id,pid);assert.equal((await sql`SELECT run_id FROM paper_reading_tasks WHERE paper_id=${pid}`)[0].run_id,task.run_id);
    const ready=(await app.inject(`/api/admin/papers/impact?q=${ids[0]}&reading=ready`)).json();assert.equal(ready.total,1);assert.equal(ready.candidates[0].paper.id,pid);
    await sql`UPDATE paper_impact_candidates SET fetched_at=now()-interval '40 days' WHERE openalex_id=${ids[0]!}`;
    assert.equal((await paperImpactResults({direction:'',q:ids[0]!,reading:'',page:1,age:'',venue:''})).total,1,'imported classics remain accessible after discovery cache expiry');
    const noPdf=await app.inject({method:'POST',url:`/api/admin/papers/impact/${ids[1]}/read`,headers,payload:{}});assert.equal(noPdf.statusCode,409);
    assert.equal((await sql`SELECT paper_id FROM paper_impact_candidates WHERE openalex_id=${ids[1]!}`)[0].paper_id,null);
    const bad=await app.inject({method:'POST',url:`/api/admin/papers/impact/${ids[1]}/read`,headers,payload:{pdfBase64:Buffer.from('not PDF').toString('base64')}});assert.equal(bad.statusCode,400);
    const pdf=Buffer.from('%PDF-1.4\nfixture\n%%EOF');
    const uploaded=await app.inject({method:'POST',url:`/api/admin/papers/impact/${ids[1]}/read`,headers,payload:{pdfBase64:pdf.toString('base64')}});
    assert.equal(uploaded.statusCode,202);paperIds.push(uploaded.json().id);assert.equal(uploaded.json().has_pdf,true);
    assert.equal((await app.inject('/api/admin/papers/'+uploaded.json().id+'/pdf')).rawPayload.toString(),pdf.toString());
    assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipt_attempts`,before);
    assert.equal((await app.inject('/api/admin/papers/impact?age=invalid')).statusCode,400);
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/papers/impact')).statusCode,401);
  }finally{globalThis.fetch=previousFetch;config.devAdmin=previous;installModules([]);await app.close();
    await sql`DELETE FROM paper_impact_candidates WHERE openalex_id IN ${sql(ids)}`;if(paperIds.length)await sql`DELETE FROM papers WHERE id IN ${sql(paperIds)}`;}
});
