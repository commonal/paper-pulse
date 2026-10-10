import { stub,tag } from "../../../tests/setup.ts";
import test,{after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {blankPdf} from './pdf-fixture.ts';
import {sql,closeDb} from "@aihot/backend/db";
import {config} from "@aihot/backend/config";
import {stopBoss} from "@aihot/backend/jobs/queue";
import {enqueuePaperDigest,paperMaterialQueue,paperDigestQueue,paperIllustrationQueue,resumeReadingTask} from "../backend/queue.ts";
import {readingTask,startReadingTask,moveReadingTask} from "../backend/reading-task.ts";
import {recoverPaperTasks} from "../backend/recovery.ts";
import {readingQuoteCatalog,compileReadingReview} from "../backend/skill-reading.ts";
import {runPaperDiscovery} from "../backend/discovery.ts";

const text="The experiment reports an accuracy of 90% on the held-out dataset.";
const sectionNames=["一句话结论","研究问题","核心方法","实验设置与结果","局限与边界"];
const sectionIds=["summary","problem","method","experiments","limitations"];
let exhaustAfterRead=false;let supersedeDuringReview=false;
const provider=await stub(async(_hit,request)=>{
  const user=JSON.parse(JSON.parse(request.body).messages[1].content);
  if(user.source_blocks){
    const id=user.candidates[0].block_id;
    const plan={selections:[{block_id:id,after_claim_id:"experiments",title:"实验结果表",selection_reason:"关键定量结果",reading_guide:"查看准确率列",takeaway:"留出集准确率90%",caveat:"不代表其他数据集",evidence_block_ids:[id]}],reason:"选择主结果"};
    const data=user.draft?{publishable:true,blockers:[],checks:[{block_id:id,verdict:"supported",reason:"原文支持",quote_ids:[id+':text:0']}],final:plan}:plan;
    return {choices:[{finish_reason:"stop",message:{content:JSON.stringify(data)}}],usage:{prompt_tokens:100,completion_tokens:200}};
  }
  const id=user.material?user.material.match(/\[([^ |]+) \|/)[1]:user.source_evidence[0].block_id;
  const draft={title_zh:"检索方法的实验评估",summary_zh:"研究检索准确率与适用条件。",sections:sectionIds.map((key,i)=>({id:key,title:sectionNames[i],claims:[{id:key,text:"留出集上的准确率为90%。",support:"direct",evidence_block_ids:[id]}]}))};
  if(!user.draft&&exhaustAfterRead)await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;
  if(user.draft&&supersedeDuringReview)await startReadingTask(user.paper.id,"coverage",{reread:true});
  const data=user.draft?{publishable:true,blockers:[],checks:sectionIds.map(key=>({claim_id:key,verdict:"supported",reason:"核对原文",quote_ids:[`${id}:text:0`]})),final:draft}:draft;
  return {choices:[{finish_reason:"stop",message:{content:JSON.stringify(data)}}],usage:{prompt_tokens:100,completion_tokens:200}};
});
process.env.LLM_BASE_URL=provider.url;process.env.LLM_API_KEY="test-key";process.env.LLM_MODEL="fixture";config.modelCallsEnabled=true;
after(async()=>{await provider.close();await stopBoss();await closeDb();});

async function paper(visual=true){
  const id=randomUUID();
  await sql`INSERT INTO papers (id,title,source_url,pdf_data,pdf_sha256) VALUES (${id},'Default workflow',${`https://example.org/${tag()}`},${visual?Buffer.from('%PDF-1.4 fixture'):null},${visual?'current':null})`;
  const blocks=[{id,kind:visual?'table':'text',text,caption:visual?'Table 1: Results.':undefined,section_path:['Experiments'],locator:'fixture:1',page:1,bbox:[100,100,900,400]}];
  await sql`INSERT INTO paper_materials (paper_id,status,parser,blocks) VALUES (${id},'ready',${visual?'mineru_api':'fixture'},${sql.json(blocks)})`;
  await sql`INSERT INTO paper_digests (paper_id,status) VALUES (${id},'queued')`;
  return id;
}

test("默认入口完整串联覆盖、Skill精读、逐条核查和图表解释，重复执行零额外费用",async()=>{
  const id=await paper();const before=provider.hits();await enqueuePaperDigest(id);
  await paperDigestQueue.run([{paperId:id}]);
  assert.equal(provider.hits()-before,2);assert.equal((await readingTask(id))!.stage,"illustrations");
  await paperIllustrationQueue.run([{paperId:id}]);
  const task=(await readingTask(id))!;assert.equal(task.status,"ready");assert.equal(task.stage,"complete");
  assert.equal(task.coverage!.included_blocks,1);assert.equal(provider.hits()-before,4);
  await paperDigestQueue.run([{paperId:id}]);await paperIllustrationQueue.run([{paperId:id}]);
  assert.equal(provider.hits()-before,4);
});

test("精读完成后预算耗尽，独立核查状态可恢复且复用初稿而不重新购买",async()=>{
  const id=await paper(false);const before=provider.hits();exhaustAfterRead=true;
  try{
    await enqueuePaperDigest(id,{reread:true});await paperDigestQueue.run([{paperId:id}]);
    const task=(await readingTask(id))!;assert.equal(task.status,"waiting");assert.equal(task.stage,"review");assert.equal(task.options.reread,true);
    assert.equal(provider.hits()-before,1);
  }finally{exhaustAfterRead=false;await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`;}
  await resumeReadingTask(id);await paperDigestQueue.run([{paperId:id}]);await paperIllustrationQueue.run([{paperId:id}]);
  assert.equal(provider.hits()-before,2);assert.equal((await readingTask(id))!.status,"ready");
});

test("未知请求持久化为等待，恢复调度不重复发送",async()=>{
  const id=await paper(false);await enqueuePaperDigest(id);const original=globalThis.fetch;let sent=0;
  globalThis.fetch=(async()=>{sent+=1;throw new DOMException('timed out','TimeoutError');}) as typeof fetch;
  try{
    await paperDigestQueue.run([{paperId:id}]);const task=(await readingTask(id))!;
    assert.equal(task.status,"waiting");assert.ok(task.receipt_id);
    assert.equal((await recoverPaperTasks()).digests,0);
    await paperDigestQueue.run([{paperId:id}]);assert.equal(sent,1);
  }finally{globalThis.fetch=original;}
});

test("新请求替代旧任务后，旧核查不能覆盖新任务或发布内容",async()=>{
  const id=await paper(false);await enqueuePaperDigest(id);supersedeDuringReview=true;
  try{
    const old=(await readingTask(id))!;const result=await paperDigestQueue.run([{paperId:id,runId:old.run_id}]) as {status:string}[];
    assert.equal(result[0]!.status,"superseded");assert.notEqual((await readingTask(id))!.run_id,old.run_id);
    const[digest]=await sql`SELECT status FROM paper_digests WHERE paper_id=${id}`;assert.notEqual(digest.status,"ready");
  }finally{supersedeDuringReview=false;}
});

test("片段编号保留LaTeX原句和独立图注，不接受不存在的片段",()=>{
  const blocks=[{id:'b1',kind:'table' as const,text:'<table><tr><td>90%</td></tr></table>',caption:'Table 1: Accuracy.',section_path:[],locator:'fixture'}];
  const catalog=readingQuoteCatalog(blocks);assert.equal(catalog[0]!.quotes.length,2);
  const raw={publishable:true,blockers:[],final:{sections:[{id:'method',claims:[{id:'c1',support:'direct',evidence_block_ids:[]}]}]} as any,checks:[{claim_id:'c1',verdict:'supported' as const,reason:'source',quote_ids:['b1:caption:0']}]};
  assert.equal(compileReadingReview(raw,blocks).checks[0]!.quotes[0]!.quote,'Table 1: Accuracy.');
  assert.deepEqual(compileReadingReview(raw,blocks).final.sections[0]!.claims[0]!.evidence_block_ids,['b1']);
  assert.deepEqual(compileReadingReview(raw,blocks).referenceRepairs,[{claim_id:'c1',added_block_ids:['b1']}]);
  assert.deepEqual(raw.final.sections[0].claims[0].evidence_block_ids,[]);
  assert.throws(()=>compileReadingReview({...raw,checks:[{...raw.checks[0]!,quote_ids:['missing']}]},blocks),/未知片段/);
  const math={...blocks[0]!,kind:'formula' as const,id:'math',text:'The gate is $G _ { c }$ and $\\tau = 0.55$.',caption:undefined};
  assert.equal(readingQuoteCatalog([math])[0]!.quotes[0]!.text,math.text);
});

test("三天日更回放：每天最多三篇，重复调度不重复入选，每篇走默认四次请求",async()=>{
  const originalFetch=globalThis.fetch;let day=0;const before=provider.hits();
  let current=new Date();current.setUTCHours(12,0,0,0);
  globalThis.fetch=(async(input,init)=>{
    const url=String(input);
    if(!url.startsWith('https://export.arxiv.org/api/query'))return originalFetch(input,init);
    const query=new URL(url).searchParams.get('search_query')??'';
    const end=query.match(/TO (\d{8})2359/)?.[1];
    const key=current.toISOString().slice(0,10).replaceAll('-','');
    const entries=end===key?Array.from({length:5},(_,i)=>`<entry><id>https://arxiv.org/abs/2610.${60000+day*10+i}v1</id><title>RAG retrieval multimodal generative recommendation ${day}-${i}</title><published>${current.toISOString()}</published><summary>retrieval augmented generation vision language LLM-based recommendation</summary><category term="cs.IR"/><author><name>Local fixture</name></author></entry>`).join(''):'';
    return new Response(`<feed><totalResults>${end===key?5:0}</totalResults>${entries}</feed>`,{headers:{'content-type':'application/atom+xml'}});
  }) as typeof fetch;
  try{
    for(day=0;day<3;day+=1){
      const run=await runPaperDiscovery(new Date(current),{requestIntervalMs:0});assert.equal(run.selected,3);
      assert.equal((await runPaperDiscovery(new Date(current),{requestIntervalMs:0})).selected,0);
      for(const id of run.paper_ids){
        const pdf=blankPdf(1),hash=createHash('sha256').update(pdf).digest('hex');
        await sql`UPDATE papers SET pdf_data=${pdf},pdf_sha256=${hash} WHERE id=${id}`;
        await sql`UPDATE paper_materials SET status='ready',parser='mineru_api',blocks=${sql.json([{id,kind:'table',text,caption:'Table 1: Results.',section_path:['Experiments'],locator:'fixture',page:1,bbox:[100,100,900,400]}])},updated_at=now() WHERE paper_id=${id}`;
        await paperMaterialQueue.run([{paperId:id}]);await paperDigestQueue.run([{paperId:id}]);await paperIllustrationQueue.run([{paperId:id}]);
        assert.equal((await readingTask(id))!.status,'ready');
      }
      current=new Date(current.getTime()+86400000);
    }
    assert.equal(provider.hits()-before,36);
    const counts=await sql`SELECT queue_date,count(*)::int AS n FROM paper_daily_queue GROUP BY queue_date`;
    assert.ok(counts.every(row=>row.n<=3));
  }finally{globalThis.fetch=originalFetch;}
});

test("重启恢复保留原任务编号和选项，内容失败不自动再次购买",async()=>{
  const id=await paper(false);const task=await startReadingTask(id,'review',{reread:true});
  await moveReadingTask(id,task.run_id,'review','running');
  await sql`UPDATE paper_reading_tasks SET updated_at=now()-interval '11 minutes' WHERE paper_id=${id}`;
  const before=provider.hits();await recoverPaperTasks();
  const resumed=(await readingTask(id))!;assert.equal(resumed.run_id,task.run_id);assert.equal(resumed.status,'queued');assert.equal(resumed.stage,'review');assert.equal(resumed.options.reread,true);
  assert.equal(provider.hits(),before);
  await sql`UPDATE pgboss.job SET state='completed' WHERE data->>'paperId'=${id}`;
  await moveReadingTask(id,task.run_id,'review','failed',{error:'内容未通过核查'});
  await recoverPaperTasks();assert.equal((await readingTask(id))!.status,'failed');assert.equal(provider.hits(),before);
});

test("正文超限在付费前停止，未选候选不会被恢复调度处理",async()=>{
  const id=await paper(false);await sql`UPDATE paper_materials SET blocks=${sql.json([{id,kind:'text',text:'x'.repeat(180001),section_path:[],locator:'fixture'}])} WHERE paper_id=${id}`;
  const before=provider.hits();await enqueuePaperDigest(id);await paperDigestQueue.run([{paperId:id}]);
  assert.equal((await readingTask(id))!.status,'failed');assert.equal((await readingTask(id))!.stage,'coverage');assert.equal(provider.hits(),before);
  const candidate=await paper(false);await recoverPaperTasks();assert.equal(await readingTask(candidate),null);assert.equal(provider.hits(),before);
});

test("关闭模型开关时保留等待状态，恢复开关后续跑",async()=>{
  const id=await paper(false);await enqueuePaperDigest(id);const before=provider.hits();config.modelCallsEnabled=false;
  try{await paperDigestQueue.run([{paperId:id}]);assert.equal((await readingTask(id))!.status,'waiting');assert.equal(provider.hits(),before);}
  finally{config.modelCallsEnabled=true;}
  await resumeReadingTask(id);await paperDigestQueue.run([{paperId:id}]);await paperIllustrationQueue.run([{paperId:id}]);
  assert.equal((await readingTask(id))!.status,'ready');assert.equal(provider.hits()-before,2);
});

test("图表等待期间解读已失效，重新进入正文处理而不误报完成",async()=>{
  const id=await paper(false);const task=await startReadingTask(id,'illustrations');const before=provider.hits();
  await paperIllustrationQueue.run([{paperId:id,runId:task.run_id}]);
  const resumed=(await readingTask(id))!;assert.equal(resumed.status,'queued');assert.equal(resumed.stage,'coverage');assert.equal(provider.hits(),before);
});
