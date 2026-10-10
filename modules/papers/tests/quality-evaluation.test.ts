import {stub,tag} from '../../../tests/setup.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {installModules} from '@aihot/backend/modules';
import {buildApp} from '../../../apps/api/src/app.ts';
import module from '../server.ts';
import {startReadingTask,moveReadingTask,readingTask} from '../backend/reading-task.ts';
import {ensureCurrentVersion} from '../backend/versions.ts';
import {readingHistory} from '../backend/reading-history.ts';
import {evaluationDashboard,enqueueQualityEvaluation,enqueueQualitySnapshot,paperQualityQueue,resumeQualityEvaluation} from '../backend/quality-evaluation.ts';
import {QUALITY_DIMENSIONS} from '../evaluation.ts';

let bad=false,bare=false;
const judgeInputs:any[]=[];
const provider=await stub((_hit,request)=>{
  const input=JSON.parse(JSON.parse(request.body).messages[1].content[0].text),q=bare?input.sources[0].block_id:input.sources[0].quotes[0].quote_id;
  judgeInputs.push(input);
  const data={summary:'实验条件与原文相符，但覆盖有限。',claim_checks:input.digest.sections.flatMap((s:any)=>s.claims.map((c:any)=>({claim_id:c.id,verdict:'supported',reason:'对照原文条件',quote_ids:[bad?'invented':q],numeric_audit:[{quantity:'测试集准确率',readings:[{quote_id:input.sources[0].quotes[0].quote_id,value:'90%'}],agreement:'single_source',reason:'测试材料只有一处该数字。'}]}))),
    dimensions:QUALITY_DIMENSIONS.map(id=>({id,score:id==='figures'?null:3,reason:'测试材料支持当前说明',quote_ids:[q]})),omissions:[]};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}],usage:{prompt_tokens:100,completion_tokens:300}};
});
process.env.LLM_BASE_URL=provider.url;process.env.LLM_API_KEY='test-key';process.env.LLM_MODEL='fixture';config.modelCallsEnabled=true;
after(async()=>{await provider.close();await stopBoss();await closeDb();});
async function paper(){
  const id=randomUUID();await sql`INSERT INTO papers(id,title,source_url) VALUES(${id},'Quality test',${'https://example.org/'+tag()})`;
  await sql`INSERT INTO paper_materials(paper_id,status,parser,blocks) VALUES(${id},'ready','fixture',${sql.json([{id:'b1',kind:'text',text:'Accuracy is 90% on the test split.',section_path:['Results'],locator:'fixture',page:2}])})`;
  const [m]=await sql`SELECT updated_at FROM paper_materials WHERE paper_id=${id}`;
  await sql`INSERT INTO paper_digests(paper_id,status,model,prompt_version,sections,material_updated_at) VALUES(${id},'ready','fixture','fixture',${sql.json([{id:'experiments',title:'实验',claims:[{id:'c1',text:'测试集准确率90%。',support:'direct',evidence_block_ids:['b1']}]}])},${m.updated_at})`;
  await sql.begin(db=>ensureCurrentVersion(id,db));await sql`INSERT INTO paper_notes(id,paper_id,title,markdown,version) VALUES(${randomUUID()},${id},'我的笔记','个人记录','')`;
  return id;
}
test('任务状态与事件同事务；恢复不抹掉失败，新任务不抹掉原run',async()=>{
  const id=await paper(),r=await startReadingTask(id,'coverage');
  await moveReadingTask(id,r.run_id,'reading','running');await moveReadingTask(id,r.run_id,'review','failed',{error:'模型回答未通过解读结构校验'});
  await moveReadingTask(id,r.run_id,'review','queued',{action:'resume_manual'});await moveReadingTask(id,r.run_id,'complete','ready');
  const history=await readingHistory(id);assert.equal(history.length,5);assert.equal(history.filter(e=>e.status==='failed').length,1);
  const report=await evaluationDashboard();assert.equal(report.metrics.recovered,1);assert.equal(report.metrics.firstPass.numerator,0);
  await assert.rejects(sql.begin(async tx=>{await moveReadingTask(id,r.run_id,'reading','failed',{error:'rollback'},tx);throw new Error('rollback');}));
  assert.equal((await readingTask(id))!.status,'ready');assert.equal((await readingHistory(id)).length,5);
  await startReadingTask(id,'illustrations');const [old]=await sql`SELECT status FROM paper_reading_runs WHERE run_id=${r.run_id}`;assert.equal(old.status,'ready');
});
test('评分冻结原文，重复提交与恢复复用回执；不修改文章或笔记',async()=>{
  const id=await paper(),before=await sql`SELECT sections FROM paper_digests WHERE paper_id=${id}`,notes=await sql`SELECT markdown,revision FROM paper_notes WHERE paper_id=${id}`;
  const e=await enqueueQualityEvaluation(id);const duplicate=await enqueueQualityEvaluation(id);assert.equal(e.id,duplicate.id);
  // Change the live article after enqueue: the judge must still score the old frozen claim.
  await sql`UPDATE paper_digests SET sections=${sql.json([{id:'method',title:'新解读',claims:[{id:'new',text:'新的正文',support:'not_stated',evidence_block_ids:[]}]}])} WHERE paper_id=${id}`;
  const hits=provider.hits();await paperQualityQueue.run([{evaluationId:e.id}]);assert.equal(provider.hits(),hits+1);
  const [row]=await sql`SELECT status,result,input,receipt_id FROM paper_quality_evaluations WHERE id=${e.id}`;
  assert.equal(row.status,'ready');assert.equal(row.result.claim_checks[0].claim_id,'c1');assert.equal(row.input.digest.sections[0].claims[0].text,before[0]!.sections[0].claims[0].text);
  assert.equal((await sql`SELECT sections FROM paper_digests WHERE paper_id=${id}`)[0]!.sections[0].claims[0].id,'new');
  assert.deepEqual([...await sql`SELECT markdown,revision FROM paper_notes WHERE paper_id=${id}`],[...notes]);
  await paperQualityQueue.run([{evaluationId:e.id}]);assert.equal(provider.hits(),hits+1);
  await resumeQualityEvaluation(e.id);await paperQualityQueue.run([{evaluationId:e.id}]);assert.equal(provider.hits(),hits+1);
});
test('评分引用未知原句明确失败；相同快照重试仍独立保存结果',async()=>{
  const id=await paper(),e=await enqueueQualityEvaluation(id);bad=true;
  try{await paperQualityQueue.run([{evaluationId:e.id}]);}finally{bad=false;}
  const [failed]=await sql`SELECT status,result,error,receipt_id FROM paper_quality_evaluations WHERE id=${e.id}`;
  assert.equal(failed.status,'failed');assert.equal(failed.result,null);assert.match(failed.error,/未知原文片段/);assert.ok(failed.receipt_id);
  const resumed=await enqueueQualityEvaluation(id);assert.equal(resumed.id,e.id);assert.equal(resumed.status,'queued');
  await paperQualityQueue.run([{evaluationId:e.id}]);assert.equal((await sql`SELECT status FROM paper_quality_evaluations WHERE id=${e.id}`)[0]!.status,'ready');
});

test('恢复旧校验器拒绝的完整真实块编号评分，不新增请求且保留原回答',async()=>{
  const id=await paper(),e=await enqueueQualityEvaluation(id);bare=true;
  try{await paperQualityQueue.run([{evaluationId:e.id}]);}finally{bare=false;}
  const [row]=await sql`SELECT receipt_id FROM paper_quality_evaluations WHERE id=${e.id}`;
  const [raw]=await sql`SELECT response FROM receipts WHERE id=${row.receipt_id}`;
  await sql`UPDATE receipts SET status='failed',error='旧校验器拒绝块编号' WHERE id=${row.receipt_id}`;
  await sql`UPDATE paper_quality_evaluations SET status='failed',result=NULL WHERE id=${e.id}`;
  const hits=provider.hits();await resumeQualityEvaluation(e.id);await paperQualityQueue.run([{evaluationId:e.id}]);
  assert.equal(provider.hits(),hits);
  const [after]=await sql`SELECT status,result,receipt_id FROM paper_quality_evaluations WHERE id=${e.id}`;
  assert.equal(after.status,'ready');assert.equal(after.receipt_id,row.receipt_id);assert.equal(after.result.referenceRepairs[0].provided,'b1');
  assert.deepEqual((await sql`SELECT response FROM receipts WHERE id=${row.receipt_id}`)[0]!.response,raw.response);
});

test('校准标签保存在独立快照，模型输入不含预期答案，不改论文文章',async()=>{
  const id=await paper(),e=await enqueueQualityEvaluation(id);
  const [baseline]=await sql`SELECT input FROM paper_quality_evaluations WHERE id=${e.id}`;
  const input={...baseline.input,calibration:{suite:'fixture-v1',label:'受控样本',expected:[{claimId:'c1',verdict:'supported'}]}};
  const sample=await enqueueQualitySnapshot(id,input);await paperQualityQueue.run([{evaluationId:sample.id}]);
  assert.equal(Object.hasOwn(judgeInputs.at(-1),'calibration'),false);
  const [result]=await sql`SELECT status,result FROM paper_quality_evaluations WHERE id=${sample.id}`;
  assert.equal(result.status,'ready');assert.equal(result.result.calibration.passed,1);assert.equal(result.result.calibration.total,1);
  assert.equal((await sql`SELECT sections FROM paper_digests WHERE paper_id=${id}`)[0]!.sections[0].claims[0].text,'测试集准确率90%。');
});

test('旧量表任务恢复继续使用冻结v1，升级不悄悄改写历史评分口径',async()=>{
  const id=await paper(),e=await enqueueQualityEvaluation(id);
  await sql`UPDATE paper_quality_evaluations SET rubric_version='paper-quality-v1' WHERE id=${e.id}`;
  await paperQualityQueue.run([{evaluationId:e.id}]);
  const [row]=await sql`SELECT status,receipt_id,rubric_version FROM paper_quality_evaluations WHERE id=${e.id}`;
  assert.equal(row.status,'ready');assert.equal(row.rubric_version,'paper-quality-v1');assert.equal(judgeInputs.at(-1).rubricVersion,'paper-quality-v1');
  const [receipt]=await sql`SELECT request FROM receipts WHERE id=${row.receipt_id}`;
  assert.equal(receipt.request.paperQuality.rubricVersion,'paper-quality-v1');assert.equal(receipt.request.promptVersion,'paper-quality-v1');
});

test('评分输入保留真实表格行列，避免把不同模型的相邻数字串成一行',async()=>{
  const id=await paper(),html='<table><tr><td>Model</td><td>Accuracy</td></tr><tr><td>Model A</td><td>90%</td></tr><tr><td>Model B</td><td>91%</td></tr></table>';
  await sql`UPDATE paper_materials SET blocks=${sql.json([{id:'b1',kind:'table',text:html,table_html:html,page:2,section_path:['Results'],locator:'fixture'}])} WHERE paper_id=${id}`;
  const e=await enqueueQualityEvaluation(id);await paperQualityQueue.run([{evaluationId:e.id}]);
  const source=judgeInputs.at(-1).sources[0];
  assert.deepEqual(source.table_rows[1].cells,['Model A','90%']);assert.deepEqual(source.table_rows[2].cells,['Model B','91%']);
  assert.deepEqual(source.table_rows[1].quote_ids,['b1:text:0']);
});
test('预算等待不发请求；恢复评分使用原快照',async()=>{
  const id=await paper(),e=await enqueueQualityEvaluation(id),before=provider.hits();await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;
  try{await paperQualityQueue.run([{evaluationId:e.id}]);assert.equal(provider.hits(),before);assert.equal((await sql`SELECT status FROM paper_quality_evaluations WHERE id=${e.id}`)[0]!.status,'waiting');}
  finally{await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`;}
  await resumeQualityEvaluation(e.id);await paperQualityQueue.run([{evaluationId:e.id}]);assert.equal(provider.hits(),before+1);
});
test('评测GET只读且私有，评分POST需要CSRF',async()=>{
  const previous=config.devAdmin;config.devAdmin={displayName:'Evaluation test'};installModules([module]);const app=await buildApp();await app.ready();
  try{
    const id=await paper(),before=provider.hits();const get=await app.inject('/api/admin/papers/evaluation');assert.equal(get.statusCode,200);assert.equal(provider.hits(),before);assert.match(String(get.headers['cache-control']),/no-store/);
    const exportResult=await app.inject('/api/admin/papers/evaluation/report');assert.equal(exportResult.statusCode,200);assert.match(String(exportResult.headers['content-disposition']),/attachment/);
    assert.equal((await app.inject({method:'POST',url:'/api/admin/papers/quality-evaluations',payload:{paperId:id}})).statusCode,403);
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/papers/evaluation')).statusCode,401);
  }finally{config.devAdmin=previous;installModules([]);await app.close();}
});
