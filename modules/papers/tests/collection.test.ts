import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {config} from '@aihot/backend/config';
import {installModules} from '@aihot/backend/modules';
import {buildApp} from '../../../apps/api/src/app.ts';
import papers from '../server.ts';
import {startImpactReading} from '../backend/impact.ts';
import {createPaper,paperById} from '../backend/store.ts';
import {paperReturnTarget} from '../navigation.ts';
after(async()=>{await stopBoss();await closeDb();});

test('仅保存无任务；个人筛选、修改、移除保留原文与解读，管理员和 CSRF 边界',async()=>{
  const previous=config.devAdmin;config.devAdmin={displayName:'Collection test'};installModules([papers]);const app=await buildApp();await app.ready();
  const headers={'x-csrf-token':'dev'},sourceUrl='https://example.org/'+randomUUID();
  try{
    const created=await app.inject({method:'POST',url:'/api/admin/papers',headers,payload:{title:'My PDF',sourceUrl,doi:'https://doi.org/10.1234/ABC',
      pdfBase64:Buffer.from('%PDF-1.4\n'+randomUUID()).toString('base64'),collection:{tags:['复现'],directions:['personal-rag'],reason:'核对检索基线'}}});
    assert.equal(created.statusCode,201,created.body);const p=created.json();assert.equal(p.doi,'10.1234/abc');assert.equal(p.collection.reason,'核对检索基线');
    assert.equal((await sql`SELECT * FROM paper_reading_tasks WHERE paper_id=${p.id}`).length,0);
    assert.equal((await app.inject('/api/admin/papers?mine=true&tag=复现&direction=personal-rag&q=检索基线')).json().papers[0].id,p.id);
    assert.equal((await app.inject('/api/admin/papers?mine=true&tag=不存在')).json().papers.length,0);
    assert.equal((await app.inject({method:'POST',url:`/api/admin/papers/${p.id}/collection`,payload:{pinned:true}})).statusCode,403);
    const changed=await app.inject({method:'POST',url:`/api/admin/papers/${p.id}/collection`,headers,payload:{pinned:true}});
    assert.equal(changed.statusCode,200);assert.equal(changed.json().collection.tags[0],'复现');assert.equal(changed.json().collection.saved_at,p.collection.saved_at);
    await sql`UPDATE paper_digests SET status='ready' WHERE paper_id=${p.id}`;
    await app.inject({method:'POST',url:`/api/admin/papers/${p.id}/collection`,headers,payload:{read:true}});
    assert.equal((await sql`SELECT * FROM paper_reading_tasks WHERE paper_id=${p.id}`).length,0,'已有解读不重新排队');
    assert.equal((await app.inject({method:'DELETE',url:`/api/admin/papers/${p.id}/collection`,headers})).statusCode,200);
    const kept=(await app.inject(`/api/admin/papers/${p.id}`)).json();assert.equal(kept.paper.collection,null);assert.equal(kept.paper.has_pdf,true);assert.equal(kept.digest.status,'ready');
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/papers?mine=true')).statusCode,401);
  }finally{config.devAdmin=previous;installModules([]);await app.close();}
});

test('并发重复导入按稳定标识与相同 PDF 复用，显式精读只启动一次',async()=>{
  const input={title:'Duplicate identity',sourceUrl:'https://arxiv.org/abs/9901.12345v1',collection:{read:false}};
  const copies=await Promise.all([createPaper(input),createPaper({...input,sourceUrl:'https://arxiv.org/pdf/9901.12345v2'})]);
  assert.equal(copies[0].id,copies[1].id);
  const pdfBase64=Buffer.from('%PDF-1.4\nidentity '+randomUUID()).toString('base64');
  const uploads=await Promise.all([createPaper({title:'A',pdfBase64}),createPaper({title:'B',pdfBase64})]);assert.equal(uploads[0].id,uploads[1].id);
  await assert.rejects(createPaper({title:'Different version',sourceUrl:uploads[0].source_url,pdfBase64:Buffer.from('%PDF-1.4\nchanged').toString('base64')}),/不同版本/);
  const doi='10.1234/'+randomUUID();const a=await createPaper({title:'DOI',sourceUrl:'https://example.org/'+randomUUID(),doi});
  const b=await createPaper({title:'Another link',sourceUrl:'https://doi.org/'+doi,collection:{read:true}});assert.equal(a.id,b.id);
  const [task]=await sql`SELECT run_id FROM paper_reading_tasks WHERE paper_id=${a.id}`;assert.ok(task);
  await createPaper({title:'Again',doi,sourceUrl:'https://example.org/'+randomUUID(),collection:{read:true}});
  assert.equal((await sql`SELECT run_id FROM paper_reading_tasks WHERE paper_id=${a.id}`)[0].run_id,task.run_id);
  assert.equal(new URL(paperReturnTarget('/papers/mine?q=RAG&tag=复现')!.to,'http://local').searchParams.get('tag'),'复现');
});

test('无开放全文的高引论文可仅保存，按 DOI 关联个人论文；精读失败不影响收藏',async()=>{
  const doi='10.1234/'+randomUUID(),id='W'+Date.now();
  const original=await createPaper({title:'Manual publication',sourceUrl:'https://example.org/'+randomUUID(),doi});
  await sql`INSERT INTO paper_impact_candidates(openalex_id,title,authors,publication_year,publication_date,venue_name,venue_type,venue_url,ccf_area,ccf_rank,
    citation_count,openalex_url,doi,doi_url,open_access_url,plan_ids)
    VALUES(${id},'Candidate','Author',2015,'2015-01-01','Journal of Machine Learning Research','journal','','人工智能','A',123,
      ${'https://openalex.org/'+id},${doi},${'https://doi.org/'+doi},'',${['personal-rag']})`;
  const saved=await startImpactReading(id,undefined,false);assert.equal(saved!.id,original.id);assert.equal(saved!.metadata!.citation_count,123);
  assert.equal(saved!.metadata!.date_precision,'year');assert.equal(saved!.metadata!.venue_verification,'source_matched');
  assert.equal((await sql`SELECT * FROM paper_reading_tasks WHERE paper_id=${original.id}`).length,0);
  await assert.rejects(startImpactReading(id),/上传原文 PDF/);
  assert.ok((await paperById(original.id))!.collection);
});
