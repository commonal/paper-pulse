import {stub} from '../../../tests/setup.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createPaper,detail} from '../backend/store.ts';
import {enqueuePaperIllustrations,paperIllustrationQueue,resumeReadingTask} from '../backend/queue.ts';
import {illustrationState} from '../backend/illustrations.ts';
import {illustrationSignature,VISUAL_ILLUSTRATION_VERSION} from '../backend/illustration-plan.ts';
import {renderFigureImages} from '../backend/figure-images.ts';
import {readingTask} from '../backend/reading-task.ts';
import {DIGEST_SECTIONS} from '../backend/digest.ts';
import {presentationSignature} from '../backend/presentation.ts';

function pdf(){
  const stream='0.8 0.9 1 rg 30 60 420 220 re f 0 0 0 rg BT /F1 18 Tf 50 310 Td (Accuracy results) Tj 0 -40 Td (Model A: 90%) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 360] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let data='%PDF-1.4\n';const offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${obj}\nendobj\n`;});const xref=Buffer.byteLength(data);
  data+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(data);
}
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const bytes=pdf(),block={id:'table1',kind:'table',caption:'Table 1: Accuracy.',text:'Model A accuracy is 90%.',page:1,bbox:[40,40,960,940],section_path:['Experiments'],locator:'fixture:1'};
const plan={selections:[{block_id:block.id,after_claim_id:'e1',title:'准确率实验表',selection_reason:'展示主结果',reading_guide:'看模型与准确率列',takeaway:'模型A报告准确率90%',caveat:'只对应该实验条件',evidence_block_ids:[block.id]}],reason:'选择主结果'};
let rejectVisual=false,stale=false,exhaust=false,addUnknown=false;
let eightObservations=false;
let longTextContext=false;
let sixFigures=false;
const sixBlocks=Array.from({length:6},(_,i)=>({...block,id:'table'+(i+1),caption:'Table '+(i+1)+': Accuracy.'}));
const sixPlan={selections:sixBlocks.map(b=>({...plan.selections[0],block_id:b.id,evidence_block_ids:[b.id]})),reason:'覆盖六个不同证据块'};
let bodyConflict=false,repairRejected=false,repairBudget=false,wrongRepair=false,remainingConflict=false,unknownQuote=false,missingBody=false,repairStale=false;
const bodyChecks=(sections:any[],conflict=false)=>sections.flatMap(s=>s.claims.map((c:any)=>({claim_id:c.id,verdict:c.id==='e1'?(conflict?'conflict':'consistent'):'not_assessable',figure_ids:c.id==='e1'?(sixFigures?sixBlocks.map(b=>b.id):[block.id]):[],reason:c.id==='e1'?(conflict?'原图和原文是90%，正文错写成99%。':'已核对原图90%。'):'该主张没有对应选中原图。'})));
const messages:any[]=[];
const provider=await stub(async(_hit,request)=>{
  const body=JSON.parse(request.body),parts=body.messages[1].content;messages.push(parts);
  const user=JSON.parse(Array.isArray(parts)?parts[0].text:parts);
  const activePlan=sixFigures?sixPlan:plan;
  let result:any=activePlan;
  if(Array.isArray(parts)){
    const images=parts.filter(p=>p.type==='image_url');assert.equal(images.length,sixFigures?6:1);
    images.forEach((part:any,i:number)=>{const image=Buffer.from(part.image_url.url.split(',')[1],'base64');assert.equal(image.subarray(1,4).toString(),'PNG');assert.equal(hash(image),user.visual_assets[i].sha256);assert.equal(user.visual_assets[i].pdfSha256,user.paper.pdf_sha256);});
    const final={...activePlan,selections:activePlan.selections.map(s=>({...s,block_id:addUnknown?'other-image':s.block_id,visual_reading:{kind:'table',observations:['图片中可见Accuracy results和Model A: 90%。'],text_context:longTextContext?['图注补充：模型A准确率为90%。'.repeat(25)]:[],unreadable:[],conflicts:[]}}))};
    if(eightObservations)final.selections[0].visual_reading.observations=Array.from({length:8},(_,i)=>'观察'+i+'：图片中可见Model A: 90%。');
    if(user.conflicts){
      assert.equal(images.length,1);
      if(user.changes){
        if(repairBudget)await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;
        if(repairStale)await sql`UPDATE papers SET title=title||' changed' WHERE id=${user.paper.id}`;
        result={publishable:!repairRejected,blockers:repairRejected?['数值仍不准确']:[],summary_zh:'该论文在指定条件下报告准确率90%。',
          checks:[{claim_id:'e1',accepted:!repairRejected,boundary_consistent:true,reason:'数字与图文相同',quote_ids:[unknownQuote?'fake-quote':block.id+':text:0']}],
          illustrations:{publishable:true,blockers:[],checks:[{block_id:block.id,verdict:'supported',reason:'原文与图一致',quote_ids:[block.id+':text:0'],visual_consistent:!rejectVisual,visual_reason:'再次看图90%。'}],final,body_checks:bodyChecks(user.sections,remainingConflict)}};
      }else{
        result={summary_zh:'该论文在指定条件下报告准确率90%。',changes:[{id:wrongRepair?'s1':'e1',text:'在该实验设置下，模型A的准确率为90%。',support:'direct',evidence_block_ids:[block.id]}]};
        if(repairBudget)await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;
      }
    }else if(user.draft?.selections[0]?.visual_reading){
      assert.match(body.messages[0].content,/body_checks/);assert.match(body.messages[0].content,/publishable只判断图下解释/);
      if(stale)await sql`UPDATE papers SET title=title||' changed' WHERE id=${user.paper.id}`;
      result={publishable:true,blockers:[],checks:activePlan.selections.map(s=>({block_id:s.block_id,verdict:'supported',reason:'原文报告该准确率',quote_ids:[s.block_id+':text:0'],visual_consistent:!rejectVisual,visual_reason:'已再次核对图片中的标签与数字。'})),final,body_checks:missingBody?[]:bodyChecks(user.digest,bodyConflict)};
    }else{assert.equal(user.source_blocks,undefined);assert.equal(user.source_evidence,undefined);assert.equal(user.draft,undefined);assert(user.allowed_anchors.every((a:any)=>a.text===undefined));result=final;if(exhaust)await sql`UPDATE budgets SET per_minute=0 WHERE service='llm'`;}
  }
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:200}};
});
process.env.LLM_BASE_URL=provider.url;process.env.LLM_API_KEY='test-key';process.env.LLM_MODEL='vision-fixture';process.env.LLM_VISION='true';config.modelCallsEnabled=true;
after(async()=>{await provider.close();await stopBoss();await closeDb();});
async function fixture(seed=true,full=false){
  const unique=Buffer.concat([bytes,Buffer.from('\n% '+randomUUID())]);
  const p=await createPaper({title:'Visual paper',pdfBase64:unique.toString('base64')});
  await sql`UPDATE paper_materials SET status='ready',parser='mineru_api',blocks=${sql.json(sixFigures?sixBlocks:[block])} WHERE paper_id=${p.id}`;
  await sql`UPDATE paper_digests SET status='ready',sections=${sql.json([{id:'experiments',title:'实验',claims:[{id:'e1',text:'准确率90%',support:'direct',evidence_block_ids:[block.id]}]}])},material_updated_at=(SELECT updated_at FROM paper_materials WHERE paper_id=${p.id}) WHERE paper_id=${p.id}`;
  if(full){
    const sections=DIGEST_SECTIONS.map((s,i)=>({...s,claims:[{id:s.id==='experiments'?'e1':s.id[0]+(i+1),text:s.id==='experiments'?'模型A的准确率为99%。':s.title+'，保留原文字。',support:'direct',evidence_block_ids:[block.id]}]}));
    await sql`UPDATE paper_digests SET sections=${sql.json(sections)} WHERE paper_id=${p.id}`;
    await sql`INSERT INTO paper_presentations(paper_id,status,title_zh,summary_zh,source_signature,model,prompt_version) VALUES(${p.id},'ready','视觉测试论文','该论文报告模型A准确率99%。',${presentationSignature(p)},'fixture','fixture')`;
  }
  const d=(await detail(p.id))!;
  if(seed)await sql`INSERT INTO paper_illustrations(paper_id,status,input_signature,prompt_version,selections) VALUES(${p.id},'failed',${illustrationSignature(p,d.material!,d.digest!)},${VISUAL_ILLUSTRATION_VERSION},${sql.json(plan.selections)})`;
  return p;
}
test('后台从真实PDF渲染可读PNG，校验文件哈希和页码，不购买模型',async()=>{
  const hits=provider.hits(),images=await renderFigureImages(bytes,hash(bytes),[block as any]);assert.equal(images.length,1);assert(images[0].width>500);assert.equal(hash(images[0].data),images[0].sha256);assert.equal(provider.hits(),hits);
  await assert.rejects(renderFigureImages(bytes,'incorrect',[block as any]),/哈希不一致/);
  await assert.rejects(renderFigureImages(bytes,hash(bytes),[{...block,page:2} as any]),/页码/);
});
test('六张原图完成选图、PNG渲染、独立核查与正文关联后发布，七张渲染被拒绝',async()=>{
  sixFigures=true;
  try{
    const p=await fixture(false),hits=provider.hits();await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);
    const d=(await detail(p.id))!;assert.equal(d.reading_task!.status,'ready');assert.equal(d.illustrations!.length,6);assert.equal(provider.hits()-hits,3);
    assert.deepEqual(d.illustrations!.map(s=>s.block_id),sixBlocks.map(b=>b.id));assert(d.illustrations!.every(s=>s.input_basis==='vision'&&s.image_sha256));
    assert.equal(d.reading_task!.coverage!.visualBodyReview!.checks[0].figure_ids.length,6);
    await assert.rejects(renderFigureImages(bytes,hash(bytes),[...sixBlocks,{...block,id:'table7'}] as any),/1–6张/);
  }finally{sixFigures=false;}
});
test('旧三张策略的图表升级时重新选取，不把旧结果当作六张策略缓存',async()=>{
  const p=await fixture(),hits=provider.hits();await sql`UPDATE paper_illustrations SET prompt_version='paper-illustrations-vision-v3' WHERE paper_id=${p.id}`;
  await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);
  assert.equal(provider.hits()-hits,3);assert.equal((await illustrationState(p.id))!.prompt_version,VISUAL_ILLUSTRATION_VERSION);
});
test('八条图像观察经过独立核查发布，格式失败回执只在输入完全相同时复用',async()=>{
  const p=await fixture(),hits=provider.hits();eightObservations=true;
  try{
    await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);
    assert.equal((await illustrationState(p.id))!.selections[0].visual_reading!.observations.length,8);
    assert.equal(provider.hits()-hits,2);
    const [receipt]=await sql`SELECT id FROM receipts WHERE subject=${'paper:'+p.id} AND purpose='paper_illustrations_visual'`;
    await sql`UPDATE receipts SET status='failed',error='unusable output: observations count 8 > 6' WHERE id=${receipt.id}`;
    await sql`UPDATE paper_illustrations SET status='failed' WHERE paper_id=${p.id}`;
    await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);
    assert.equal((await illustrationState(p.id))!.status,'ready');assert.equal(provider.hits()-hits,2);
    const [recovered]=await sql`SELECT request FROM receipts WHERE id=${receipt.id}`;
    assert.equal(recovered.request.paperVisualRecovery.rawResponsePreserved,true);
    await sql`UPDATE receipts SET status='failed',request=jsonb_set(request,'{userHash}','"changed-input"'::jsonb) WHERE id=${receipt.id}`;
    await sql`UPDATE paper_illustrations SET status='failed' WHERE paper_id=${p.id}`;
    await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);
    assert.equal(provider.hits()-hits,3);assert.equal((await illustrationState(p.id))!.status,'ready');
  }finally{eightObservations=false;}
});
test('图文冲突只修订对应主张，两个新增阶段都收到原图，正文简介与图表一起发布',async()=>{
  const p=await fixture(true,true),before=(await detail(p.id))!,hits=provider.hits();bodyConflict=true;
  try{
    await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,4);
    const after=(await detail(p.id))!;assert.equal(after.reading_task!.status,'ready');assert.match(after.digest!.sections.flatMap(s=>s.claims).find(c=>c.id==='e1')!.text,/90%/);
    for(const section of before.digest!.sections)for(const claim of section.claims)if(claim.id!=='e1')assert.deepEqual(after.digest!.sections.flatMap(s=>s.claims).find(c=>c.id===claim.id),claim);
    assert.match(after.paper.summary_zh!,/90%/);assert.equal(after.illustrations!.length,1);
    assert.equal(after.reading_task!.coverage!.visualBodyReview!.status,'completed');assert.equal(after.reading_task!.coverage!.visualBodyReview!.changes.length,1);
    const [row]=await sql`SELECT input_signature,receipt_id FROM paper_illustrations WHERE paper_id=${p.id}`;
    assert.equal(row.input_signature,illustrationSignature(after.paper,after.material!,after.digest!));assert.equal(row.receipt_id,after.digest!.receipt_id);
    const [r]=await sql`SELECT request FROM receipts WHERE id=${row.receipt_id}`;assert.deepEqual(r.request.paperVisualBodyRepair.targetIds,['e1']);assert.equal(await enqueuePaperIllustrations(p.id),false);
  }finally{bodyConflict=false;}
});

test('完整图注背景段落不因350字排版限制被拒；同输入失败回执复用但仍须视觉核查',async()=>{
  const p=await fixture(),hits=provider.hits();longTextContext=true;
  try{
    await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);
    assert.equal((await illustrationState(p.id))!.status,'ready');
    const [receipt]=await sql`SELECT id,response FROM receipts WHERE subject=${'paper:'+p.id} AND purpose='paper_illustrations_visual'`;
    const before=JSON.stringify(receipt.response);
    await sql`UPDATE receipts SET status='failed',error='unusable output: text_context length > 350' WHERE id=${receipt.id}`;
    await sql`UPDATE paper_illustrations SET status='failed' WHERE paper_id=${p.id}`;
    await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);
    const [saved]=await sql`SELECT status,response,request FROM receipts WHERE id=${receipt.id}`;
    assert.equal(saved.status,'completed');assert.equal(JSON.stringify(saved.response),before);
    assert.equal(saved.request.paperVisualRecovery.rawResponsePreserved,true);
    assert.equal(provider.hits()-hits,2,'已保存原图解释和独立核查结果都复用');
  }finally{longTextContext=false;}
});
test('修订预算等待保留原正文和旧图，恢复复用已完成检测和修订，只买最后复核',async()=>{
  const p=await fixture(true,true),before=(await detail(p.id))!,hits=provider.hits();bodyConflict=true;repairBudget=true;
  try{
    await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,3);
    const waiting=(await detail(p.id))!;assert.equal(waiting.reading_task!.status,'waiting');assert.deepEqual(waiting.digest!.sections,before.digest!.sections);assert.equal(waiting.illustrations![0].input_basis,undefined);
    await sql`DELETE FROM pgboss.job WHERE name='papers.illustrations' AND data->>'paperId'=${p.id}`;repairBudget=false;await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`;
    await resumeReadingTask(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,4);assert.equal((await readingTask(p.id))!.status,'ready');
  }finally{bodyConflict=false;repairBudget=false;await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`;}
});
test('错误修订ID、未通过复核、伪造引用、未消除矛盾及发布前版本变化均不写正文或图表',async()=>{
  for(const mode of ['wrong','reject','quote','conflict','stale']){
    const p=await fixture(true,true),before=(await detail(p.id))!;bodyConflict=true;
    wrongRepair=mode==='wrong';repairRejected=mode==='reject';unknownQuote=mode==='quote';remainingConflict=mode==='conflict';repairStale=mode==='stale';
    try{await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);
      const after=(await detail(p.id))!;assert.equal(after.reading_task!.status,'failed');assert.deepEqual(after.digest!.sections,before.digest!.sections);assert.equal((await illustrationState(p.id))!.selections[0].input_basis,undefined);
      assert.equal(after.reading_task!.coverage!.visualBodyReview!.status,'failed');assert.equal(after.reading_task!.coverage!.visualBodyReview!.changes[0].claimId,'e1');
    }finally{bodyConflict=false;wrongRepair=false;repairRejected=false;unknownQuote=false;remainingConflict=false;repairStale=false;}
  }
});
test('缺失逐条正文核查不能发布',async()=>{
  const p=await fixture();missingBody=true;
  try{await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal((await readingTask(p.id))!.status,'failed');assert.equal((await illustrationState(p.id))!.selections[0].input_basis,undefined);}finally{missingBody=false;}
});
test('两阶段都收到原图，同策略选图只需两次请求，发布视觉标记和像素哈希，重复运行零请求',async()=>{
  const p=await fixture(),hits=provider.hits();await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,2);
  const state=(await illustrationState(p.id))!;assert.equal(state.status,'ready');assert.equal(state.prompt_version,VISUAL_ILLUSTRATION_VERSION);assert.equal(state.selections[0].input_basis,'vision');assert.equal(state.selections[0].image_pdf_sha256,p.pdf_sha256);assert(state.selections[0].visual_reading?.observations.length);
  const [receipt]=await sql`SELECT request FROM receipts WHERE id=${state.receipt_id}`;assert.equal(receipt.request.paperIllustrations.images.length,1);assert.equal(receipt.request.paperIllustrations.visualChecks[0].visual_consistent,true);
  assert.equal(await enqueuePaperIllustrations(p.id),false);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,2);
});
test('新论文先选图，再生成与核查原图，三次请求；视觉不一致保留旧文本解释',async()=>{
  const p=await fixture(false),hits=provider.hits();await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,3);assert.equal((await illustrationState(p.id))!.status,'ready');
  const old=await fixture();rejectVisual=true;
  try{await enqueuePaperIllustrations(old.id);await paperIllustrationQueue.run([{paperId:old.id}]);const state=(await illustrationState(old.id))!;assert.equal(state.status,'failed');assert.equal(state.selections[0].input_basis,undefined);assert.equal(state.selections[0].title,plan.selections[0].title);}
  finally{rejectVisual=false;}
});
test('预算等待复用已经看图生成的完整回答，恢复只购买核查；原文变化或新增未渲染图拒绝发布',async()=>{
  const p=await fixture(),hits=provider.hits();exhaust=true;
  try{await enqueuePaperIllustrations(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal((await readingTask(p.id))!.status,'waiting');assert.equal(provider.hits()-hits,1);
    await sql`DELETE FROM pgboss.job WHERE name='papers.illustrations' AND data->>'paperId'=${p.id}`;exhaust=false;await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`;await resumeReadingTask(p.id);await paperIllustrationQueue.run([{paperId:p.id}]);assert.equal(provider.hits()-hits,2);assert.equal((await readingTask(p.id))!.status,'ready');
  }finally{exhaust=false;await sql`UPDATE budgets SET per_minute=300 WHERE service='llm'`;}
  const old=await fixture();stale=true;try{await enqueuePaperIllustrations(old.id);await paperIllustrationQueue.run([{paperId:old.id}]);assert.equal((await illustrationState(old.id))!.status,'failed');assert.equal((await illustrationState(old.id))!.selections[0].input_basis,undefined);}finally{stale=false;}
  const other=await fixture();addUnknown=true;try{await enqueuePaperIllustrations(other.id);await paperIllustrationQueue.run([{paperId:other.id}]);assert.equal((await illustrationState(other.id))!.status,'failed');}finally{addUnknown=false;}
});
