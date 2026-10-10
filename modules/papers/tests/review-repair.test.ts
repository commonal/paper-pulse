import {stub} from '../../../tests/setup.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {installModules} from '@aihot/backend/modules';
import {buildApp} from '../../../apps/api/src/app.ts';
import papers from '../server.ts';
import {createPaper,detail} from '../backend/store.ts';
import {enqueuePaperDigest,paperDigestQueue,paperIllustrationQueue,resumeReadingTask} from '../backend/queue.ts';
import {enqueueReviewRepair} from '../backend/review-repair.ts';
import {reviewProblems,type ReviewFailure} from '../review.ts';
import {readingTask} from '../backend/reading-task.ts';

const source='Accuracy was 90% on the held-out dataset.';
const names=['summary','problem','method','experiments','limitations'];
const titles=['一句话结论','研究问题','核心方法','实验设置与结果','局限与边界'];
const draft=(id:string)=>({title_zh:'检索方法评估',summary_zh:'研究检索方法在留出集上的表现。',sections:names.map((name,i)=>({id:name,title:titles[i]!,claims:[{id:name,text:'留出集准确率为90%。',support:'direct',evidence_block_ids:[id]}]}))});
let failAudit=false,rejectFacts=false,proposalNotStated=false,budgetAfterProposal=false,changeDuringAudit=false,wrongAssessedText=false,wrongIssueText=false,contextQuote=false,unknownContext=false;
const requests:any[]=[];
const provider=await stub(async(_hit,request)=>{
  const body=JSON.parse(request.body);requests.push(body);const user=JSON.parse(body.messages[1].content);
  let result;
  if(user.problems){
    result={summary_zh:'在留出集上报告90%的准确率，结论仅限该设置。',changes:user.problems.map((p:any)=>({...p.claim,text:proposalNotStated?'原文未报告跨数据集的泛化实验，该缺失不代表方法已被证实存在泛化缺陷。':'作者在留出集上报告90%的准确率，不能推断其他数据集的表现。',support:proposalNotStated?'not_stated':'direct',evidence_block_ids:proposalNotStated?[]:p.claim.evidence_block_ids}))};
    if(budgetAfterProposal)await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;
  }else if(user.changes){
    const id=user.source_evidence[0].block_id;
    result={publishable:true,blockers:[],summary_zh:user.summary_zh,checks:user.changes.map((c:any)=>({claim_id:c.id,assessed_text:wrongAssessedText?'这是被删掉的旧主张':c.text,accepted:!rejectFacts,boundary_consistent:!failAudit,issue_text:wrongIssueText?'这是被删掉的旧事实':rejectFacts||failAudit?c.text:null,reason:'回读了留出集实验设置。',quote_ids:unknownContext?['invented']:c.support==='not_stated'&&!contextQuote?[]:[id+':text:0']}))};
    if(changeDuringAudit)await sql`UPDATE paper_materials SET updated_at=now() WHERE paper_id=${user.paper.id}`;
  }else if(user.draft){
    const id=user.source_evidence[0].block_id;result={publishable:true,blockers:[],final:draft(id),checks:names.map(name=>({claim_id:name,verdict:name==='limitations'?'not_stated':'supported',reason:'需要区分原文未报告和条件推断。',quote_ids:[id+':text:0']}))};
  }else{const id=user.material.match(/\[([^ |]+) \|/)[1];result=draft(id);}
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:100}};
});
process.env.LLM_BASE_URL=provider.url;process.env.LLM_API_KEY='test-key';process.env.LLM_MODEL='test-model';config.modelCallsEnabled=true;
after(async()=>{await provider.close();await stopBoss();await closeDb();});
async function fixture(){
  const p=await createPaper({title:'Review repair fixture'});
  await sql`UPDATE paper_materials SET status='ready',parser='fixture',blocks=${sql.json([{id:p.id,kind:'text',text:source,page:3,section_path:['Experiments'],locator:'fixture:3'}])} WHERE paper_id=${p.id}`;
  await sql`UPDATE paper_digests SET status='ready',prompt_version='old',sections=${sql.json(draft(p.id).sections)} WHERE paper_id=${p.id}`;
  await enqueuePaperDigest(p.id,{reread:true});await paperDigestQueue.run([{paperId:p.id}]);
  await sql`DELETE FROM pgboss.job WHERE name='papers.digest' AND data->>'paperId'=${p.id}`;
  const task=(await readingTask(p.id))!;assert.equal(task.status,'failed');const failure=task.coverage!.reviewFailure as ReviewFailure;assert(failure);
  return {p,task,failure,body:{versionId:p.active_version_id,receiptId:failure.receiptId,inputSignature:failure.inputSignature,instructions:[] as {claimId:string;text:string}[]}};
}

test('失败定位到具体主张及原文；仅两次局部请求完成修订和独立核查，保留其他段落与原回执',async()=>{
  const {p,failure,body}=await fixture();assert.deepEqual(reviewProblems(failure).map(p=>p.claim.id),['limitations']);
  const before=await detail(p.id),hits=provider.hits();assert.equal(before!.material!.blocks[0].page,3);assert.equal(before!.digest!.prompt_version,'old');
  assert.equal(provider.hits(),hits);
  body.instructions=[{claimId:'limitations',text:'明确90%仅对应留出集，不声称泛化能力。'}];await enqueueReviewRepair(p.id,body);await paperDigestQueue.run([{paperId:p.id}]);await paperIllustrationQueue.run([{paperId:p.id}]);
  assert.equal(provider.hits()-hits,2);
  const after=await detail(p.id);assert.equal(after!.reading_task!.status,'ready');assert.equal(after!.reading_task!.coverage!.reviewFailure,undefined);
  for(let i=0;i<4;i++)assert.deepEqual(after!.digest!.sections[i],draft(p.id).sections[i]);
  assert.ok(after!.digest!.sections[4].claims[0].text.includes('不能推断'));
  const [old]=await sql`SELECT status,response FROM receipts WHERE id=${failure.receiptId}`;assert.equal(old.status,'failed');assert.equal(JSON.parse(old.response.choices[0].message.content).checks[4].verdict,'not_stated');
  const [receipt]=await sql`SELECT status,request FROM receipts WHERE id=${after!.digest!.receipt_id}`;assert.equal(receipt.status,'completed');assert.equal(receipt.request.paperReviewRepair.baseReceiptId,failure.receiptId);assert.deepEqual(receipt.request.paperReviewRepair.instructions,body.instructions);
  assert.equal(JSON.parse(requests.at(-2).messages[1].content).problems.length,1);assert.equal(JSON.parse(requests.at(-1).messages[1].content).changes.length,1);
  assert.equal(Object.hasOwn(JSON.parse(requests.at(-1).messages[1].content),'previous_blockers'),false,'独立核查不能收到旧拒绝理由');
});

test('修订仍不合格时保留旧文章并生成新问题，过期请求和并发点击不能重复购买',async()=>{
  const {p,body,failure}=await fixture();failAudit=true;
  try{
    const outcomes=await Promise.allSettled([enqueueReviewRepair(p.id,body),enqueueReviewRepair(p.id,body)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    const hits=provider.hits();await paperDigestQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,2);
    const task=(await readingTask(p.id))!;assert.equal(task.status,'failed');const next=task.coverage!.reviewFailure as ReviewFailure;assert.notEqual(next.receiptId,failure.receiptId);
    assert.equal((await detail(p.id))!.digest!.prompt_version,'old');await assert.rejects(enqueueReviewRepair(p.id,body),/记录或正文已经改变/);
    assert.equal(provider.hits()-hits,2);
  }finally{failAudit=false;}
});

test('预算等待保留修订输入；恢复复用已完成修订，只新增独立核查请求',async()=>{
  const {p,body}=await fixture();budgetAfterProposal=true;body.instructions=[{claimId:'limitations',text:'保持实验条件。'}];const hits=provider.hits();
  try{
    await enqueueReviewRepair(p.id,body);await paperDigestQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,1);assert.equal((await readingTask(p.id))!.status,'waiting');
    await sql`DELETE FROM pgboss.job WHERE name='papers.digest' AND data->>'paperId'=${p.id}`;
    budgetAfterProposal=false;await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`;
    await resumeReadingTask(p.id);await paperDigestQueue.run([{paperId:p.id}]);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,2);assert.equal((await readingTask(p.id))!.status,'ready');
  }finally{budgetAfterProposal=false;await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`;}
});

test('第二次核查复用精确匹配的已完成修订稿；文字准确与未报告边界分开核验',async()=>{
  const {p,body}=await fixture();body.instructions=[{claimId:'limitations',text:'只说明未报告，不推断缺陷。'}];const hits=provider.hits();proposalNotStated=true;failAudit=true;
  try{
    await enqueueReviewRepair(p.id,body);await paperDigestQueue.run([{paperId:p.id}]);const next=(await readingTask(p.id))!.coverage!.reviewFailure as ReviewFailure;
    await sql`DELETE FROM pgboss.job WHERE name='papers.digest' AND data->>'paperId'=${p.id}`;
    failAudit=false;await enqueueReviewRepair(p.id,{...body,receiptId:next.receiptId});await paperDigestQueue.run([{paperId:p.id}]);await paperIllustrationQueue.run([{paperId:p.id}]);
    assert.equal(provider.hits()-hits,3);const d=(await detail(p.id))!;assert.equal(d.reading_task!.status,'ready');assert.equal(d.digest!.sections[4].claims[0].support,'not_stated');
    const [receipt]=await sql`SELECT request FROM receipts WHERE id=${d.digest!.receipt_id}`;assert.equal(receipt.request.paperReviewRepair.reusedProposal,true);assert.equal(receipt.request.paperReviewRepair.independentChecks[0].accepted,true);
  }finally{proposalNotStated=false;failAudit=false;}
});

test('证据类型一致也不能发布被独立核查否定的文字事实',async()=>{
  const {p,body}=await fixture();rejectFacts=true;
  try{await enqueueReviewRepair(p.id,body);await paperDigestQueue.run([{paperId:p.id}]);assert.equal((await detail(p.id))!.digest!.prompt_version,'old');assert.equal((await readingTask(p.id))!.status,'failed');}
  finally{rejectFacts=false;}
});
test('核查ID相同但核查的是旧文字时拒绝发布，保留当前修订和原文章',async()=>{
  const {p,body}=await fixture();wrongAssessedText=true;
  try{await enqueueReviewRepair(p.id,body);await paperDigestQueue.run([{paperId:p.id}]);
    assert.equal((await readingTask(p.id))!.status,'failed');assert.equal((await detail(p.id))!.digest!.prompt_version,'old');
    assert.match((await readingTask(p.id))!.error!,/核查对象与当前修订文字不一致/);
  }finally{wrongAssessedText=false;}
});

test('核查抄回当前全文但问题片段来自已删文字时拒绝该判断',async()=>{
  const {p,body}=await fixture();wrongIssueText=true;failAudit=true;
  try{await enqueueReviewRepair(p.id,body);await paperDigestQueue.run([{paperId:p.id}]);
    assert.equal((await readingTask(p.id))!.status,'failed');assert.match((await readingTask(p.id))!.error!,/问题片段不在当前修订文字中/);
    assert.equal((await detail(p.id))!.digest!.prompt_version,'old');
  }finally{wrongIssueText=false;failAudit=false;}
});

test('未报告主张的真实查阅范围独立审计，不冒充主张直接引用',async()=>{
  const {p,body}=await fixture();proposalNotStated=true;contextQuote=true;
  try{await enqueueReviewRepair(p.id,body);await paperDigestQueue.run([{paperId:p.id}]);await paperIllustrationQueue.run([{paperId:p.id}]);
    const d=(await detail(p.id))!;assert.equal(d.reading_task!.status,'ready');assert.deepEqual(d.digest!.sections[4].claims[0].evidence_block_ids,[]);
    const [r]=await sql`SELECT request FROM receipts WHERE id=${d.digest!.receipt_id}`;
    assert.deepEqual(r.request.paperReviewRepair.contextQuotes,[{claimId:'limitations',quoteIds:[p.id+':text:0']}]);
  }finally{proposalNotStated=false;contextQuote=false;}
});

test('未报告主张也拒绝虚构查阅范围，不能因不作直接引用而隐藏假证据',async()=>{
  const {p,body}=await fixture();proposalNotStated=true;unknownContext=true;
  try{await enqueueReviewRepair(p.id,body);await paperDigestQueue.run([{paperId:p.id}]);
    assert.equal((await readingTask(p.id))!.status,'failed');assert.match((await readingTask(p.id))!.error!,/未知片段/);assert.equal((await detail(p.id))!.digest!.prompt_version,'old');
  }finally{proposalNotStated=false;unknownContext=false;}
});

test('正文变更、旧版本和非失败主张修订被拒绝，核查期间原文变化不覆盖旧文章',async()=>{
  const {p,body}=await fixture();const hits=provider.hits();
  await assert.rejects(enqueueReviewRepair(p.id,{...body,instructions:[{claimId:'method',text:'无关修改'}]}),/非失败主张/);
  await assert.rejects(enqueueReviewRepair(p.id,{...body,versionId:'00000000-0000-4000-8000-000000000001'}),/当前原文已改变/);assert.equal(provider.hits(),hits);
  await enqueueReviewRepair(p.id,body);changeDuringAudit=true;
  try{await paperDigestQueue.run([{paperId:p.id}]);assert.equal((await detail(p.id))!.digest!.prompt_version,'old');assert.equal((await readingTask(p.id))!.status,'failed');}
  finally{changeDuringAudit=false;}
  await assert.rejects(enqueueReviewRepair(p.id,body),/正文已经改变/);
});

test('修订接口受管理员和CSRF保护，详情读取失败定位不会入队或调用模型',async()=>{
  const {p,body}=await fixture(),previous=config.devAdmin;config.devAdmin={displayName:'Repair test'};installModules([papers]);const app=await buildApp();await app.ready();
  try{const hits=provider.hits();const response=await app.inject('/api/admin/papers/'+p.id);assert.equal(response.statusCode,200);assert(response.json().reading_task.coverage.reviewFailure);assert.equal(provider.hits(),hits);
    assert.equal((await app.inject({method:'POST',url:`/api/admin/papers/${p.id}/review-repair`,payload:body})).statusCode,403);
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/papers/'+p.id)).statusCode,401);
  }finally{config.devAdmin=previous;installModules([]);await app.close();}
});
