import '../../../tests/setup.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {paperMaterialQueue} from '../backend/queue.ts';
import {startReadingTask,readingTask} from '../backend/reading-task.ts';
import {readingDate} from '../daily.ts';
import {blankPdf as pdf} from './pdf-fixture.ts';
import {inspectPdfPages} from '../backend/daily-length.ts';

after(async()=>{await stopBoss();await closeDb();});
async function paper(pages:number){
  const id=randomUUID(),data=pdf(pages),hash=createHash('sha256').update(data).digest('hex');
  await sql`INSERT INTO papers(id,title,source_url,published,topic,abstract,pdf_data,pdf_sha256) VALUES(${id},${`Daily ${pages}`},${`https://example.org/${id}`},'2026-10-10','cs.IR','retrieval',${data},${hash})`;
  await sql`INSERT INTO paper_materials(paper_id,status,parser,markdown,blocks) VALUES(${id},'ready','fixture','Retained text','[]')`;
  return {id,hash,data};
}
test('112页日更论文在精读前退出并补位，原文与已保存材料保留，不发送付费请求',async()=>{
  const long=await paper(112),short=await paper(12),date=readingDate(new Date());
  const {listDiscoveryPlans}=await import('../backend/discovery.ts');await listDiscoveryPlans();
  await sql`UPDATE paper_discovery_plans SET enabled=id='personal-rag'`;
  await sql`UPDATE papers SET published=${date},arxiv_categories=ARRAY['cs.IR'],title='Retrieval augmented generation',abstract='RAG retrieval' WHERE id=${short.id}`;
  await sql`INSERT INTO paper_candidates(paper_id,plan_id,score) VALUES(${short.id},'personal-rag',10)`;
  await sql`INSERT INTO paper_daily_queue(queue_date,paper_id,source_kind) VALUES(${date}::date,${long.id},'personal')`;
  await startReadingTask(long.id,'material',{daily:true});
  const original=globalThis.fetch;let requests=0;globalThis.fetch=(async()=>{requests++;throw new Error('No external calls allowed');}) as typeof fetch;
  try{
    const result=await paperMaterialQueue.run([{paperId:long.id}]) as {status:string}[];
    assert.equal(result[0].status,'excluded_length');
    assert.equal(requests,0);
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_daily_queue WHERE paper_id=${long.id}`)[0].n,0);
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_daily_queue WHERE paper_id=${short.id}`)[0].n,1);
    const [saved]=await sql`SELECT p.pdf_data,m.markdown FROM papers p JOIN paper_materials m ON p.id=m.paper_id WHERE p.id=${long.id}`;
    assert.deepEqual(saved.pdf_data,long.data);assert.equal(saved.markdown,'Retained text');
    assert.equal((await readingTask(short.id))?.options.daily,true);
    const {selectToday}=await import('../backend/discovery.ts');
    assert.equal((await selectToday(new Date())).length,0,'页数缓存阻止再次入选');
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_daily_exclusions WHERE paper_id=${long.id}`)[0].n,1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipts WHERE subject=${'paper:'+long.id}`)[0].n,0);
  }finally{globalThis.fetch=original;await sql`DELETE FROM papers WHERE id IN (${long.id},${short.id})`;}
});
test('30页边界允许继续，手动精读112页不被日更规则拦截',async()=>{
  for(const [pages,daily] of [[30,true],[112,false]] as const){
    const p=await paper(pages);await startReadingTask(p.id,'material',{daily});
    try{const result=await paperMaterialQueue.run([{paperId:p.id}]) as {status:string}[];assert.equal(result[0].status,'digest_queued');}
    finally{await sql`DELETE FROM papers WHERE id=${p.id}`;}
  }
});
test('页数绑定实际文件哈希；未知或损坏PDF不能当成短论文',async()=>{
  assert.equal((await inspectPdfPages(pdf(112))).pages,112);
  assert.equal((await inspectPdfPages(pdf(8))).pages,8);
  await assert.rejects(inspectPdfPages(Buffer.from('%PDF-1.4 invalid')),/无法检查/);
});
test('尚未解析的超长PDF也在 MinerU 请求前拦截',async()=>{
  const p=await paper(31);await sql`UPDATE paper_materials SET status='unavailable' WHERE paper_id=${p.id}`;
  await startReadingTask(p.id,'material',{daily:true});
  const original=globalThis.fetch;let hits=0;globalThis.fetch=(async()=>{hits++;throw new Error('No paid request');}) as typeof fetch;
  try{
    await paperMaterialQueue.run([{paperId:p.id}]);assert.equal(hits,0);
    assert.equal((await readingTask(p.id))?.status,'unavailable');
  }finally{globalThis.fetch=original;await sql`DELETE FROM papers WHERE id=${p.id}`;}
});
test('超过20MB的日更PDF退出且不重复入选，不调用付费解析',async()=>{
  const p=await paper(10),date=readingDate(new Date());
  await sql`UPDATE papers SET pdf_data=${Buffer.alloc(20*1024*1024+1)} WHERE id=${p.id}`;
  await sql`INSERT INTO paper_daily_queue(queue_date,paper_id,source_kind) VALUES(${date}::date,${p.id},'personal')`;
  await startReadingTask(p.id,'material',{daily:true});
  const original=globalThis.fetch;let hits=0;globalThis.fetch=(async()=>{hits++;throw new Error('No paid requests');}) as typeof fetch;
  try{
    const result=await paperMaterialQueue.run([{paperId:p.id}]) as {status:string}[];
    assert.equal(result[0].status,'excluded_pdf_size');assert.equal(hits,0);
    assert.match((await readingTask(p.id))!.error!,/20 MB/);
    assert.equal((await sql`SELECT count(*)::int AS n FROM paper_daily_queue WHERE paper_id=${p.id}`)[0].n,0);
  }finally{globalThis.fetch=original;await sql`DELETE FROM papers WHERE id=${p.id}`;}
});
