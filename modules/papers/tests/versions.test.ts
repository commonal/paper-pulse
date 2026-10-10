import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {installModules} from '@aihot/backend/modules';
import {config} from '@aihot/backend/config';
import {buildApp} from '../../../apps/api/src/app.ts';
import papers from '../server.ts';
import {createPaper,detail,listPapers,pdfById} from '../backend/store.ts';
import {addPaperVersion,selectPaperVersion,listVersions} from '../backend/versions.ts';
import {presentationSignature} from '../backend/presentation.ts';
import {illustrationSignature} from '../backend/illustration-plan.ts';
import {startReadingTask,assertReadingTask,ReadingSupersededError} from '../backend/reading-task.ts';
after(async()=>{await stopBoss();await closeDb();});
const pdf=(label:string)=>Buffer.from('%PDF-1.4\n'+label+' '+randomUUID()+'\n%%EOF');

test('新增原文不覆盖旧PDF；历史解读/图表/翻译/笔记与引用恢复到原版，已精读库仍能找到',async()=>{
  const old=pdf('old'),p=await createPaper({title:'Version study',sourceUrl:'https://example.org/'+randomUUID(),pdfBase64:old.toString('base64'),version:'v1'});
  await sql`UPDATE paper_materials SET status='ready',parser='fixture',markdown='original',blocks=${sql.json([{id:'b1',kind:'text',text:'original evidence',section_path:['Method'],locator:'p1',page:1}])} WHERE paper_id=${p.id}`;
  const [material]=await sql`SELECT * FROM paper_materials WHERE paper_id=${p.id}`;
  const sections=[{id:'summary',title:'结论',claims:[{id:'c1',text:'原版结论',support:'direct',evidence_block_ids:['b1']}]}];
  await sql`UPDATE paper_digests SET status='ready',sections=${sql.json(sections)},material_updated_at=${material.updated_at} WHERE paper_id=${p.id}`;
  const [digest]=await sql`SELECT * FROM paper_digests WHERE paper_id=${p.id}`;
  await sql`INSERT INTO paper_presentations(paper_id,status,title_zh,summary_zh,source_signature,model,prompt_version)
    VALUES(${p.id},'ready','原版论文','原版简介',${presentationSignature(p)},'fixture','fixture')`;
  await sql`INSERT INTO paper_illustrations(paper_id,status,input_signature,selections,prompt_version)
    VALUES(${p.id},'ready',${illustrationSignature(p,material as any,digest as any)},${sql.json([{block_id:'b1',after_claim_id:'c1',title:'旧图',explanation:'旧图说明'}])},'fixture')`;
  await sql`INSERT INTO paper_notes(id,paper_id,title,markdown,version,pdf_sha256) VALUES(${randomUUID()},${p.id},'Old note','keep me','v1',${p.pdf_sha256})`;
  const incoming=pdf('new'),added=await addPaperVersion(p.id,{label:'新原文',pdfBase64:incoming.toString('base64'),confirmSamePaper:true});
  assert.equal((await detail(p.id))!.digest!.status,'ready');assert.deepEqual(await pdfById(p.id),old);
  const originalId=p.active_version_id!;
  await selectPaperVersion(p.id,added.versionId,originalId);
  assert.deepEqual(await pdfById(p.id),incoming);assert.equal((await detail(p.id))!.digest!.status,'unavailable');
  const history=(await detail(p.id,originalId))!;assert.equal(history.is_current_version,false);assert.deepEqual(history.digest!.sections,sections);
  assert.equal(history.paper.title_zh,'原版论文');assert.equal(history.illustrations!.length,1);assert.equal(history.notes.length,1);
  const library=await listPapers('Version study','',true);assert.equal(library.find(row=>row.id===p.id)!.readable_version_id,originalId);
  await selectPaperVersion(p.id,originalId,added.versionId);
  const restored=(await detail(p.id))!;assert.deepEqual(restored.digest!.sections,sections);assert.equal(restored.paper.title_zh,'原版论文');
  assert.equal(restored.illustrations!.length,1);assert.equal(restored.notes[0].markdown,'keep me');assert.deepEqual(await pdfById(p.id),old);
  const duplicate=await addPaperVersion(p.id,{label:'same bytes',pdfBase64:old.toString('base64'),confirmSamePaper:true});
  assert.equal(duplicate.added,false);assert.equal((await listVersions(p.id)).length,2);
});

test('切换前核对当前版本与未完成任务；旧页面不能启动另一原文，历史GET无额外任务',async()=>{
  const p=await createPaper({title:'Bound version',pdfBase64:pdf('one').toString('base64')});
  const added=await addPaperVersion(p.id,{label:'two',pdfBase64:pdf('two').toString('base64'),confirmSamePaper:true});
  const task=await startReadingTask(p.id,'material');
  assert.equal(task.options.versionId,p.active_version_id);
  await assert.rejects(selectPaperVersion(p.id,added.versionId,p.active_version_id!),/未结束/);
  await sql`UPDATE paper_reading_tasks SET status='failed' WHERE paper_id=${p.id}`;
  await selectPaperVersion(p.id,added.versionId,p.active_version_id!);
  await assert.rejects(startReadingTask(p.id,'material',{versionId:p.active_version_id!}),/原文已改变/);
  await assert.rejects(sql.begin(db=>assertReadingTask(p.id,task.run_id,db)),ReadingSupersededError);
  const previous=config.devAdmin;config.devAdmin={displayName:'Version test'};installModules([papers]);const app=await buildApp();await app.ready();
  try{
    assert.equal((await app.inject({method:'POST',url:`/api/admin/papers/${p.id}/versions/${p.active_version_id}/select`,payload:{}})).statusCode,403);
    const result=await app.inject(`/api/admin/papers/${p.id}?version=${p.active_version_id}`);assert.equal(result.statusCode,200);assert.equal(result.json().is_current_version,false);
    const file=await app.inject(`/api/admin/papers/${p.id}/pdf?version=${p.active_version_id}`);assert.equal(file.statusCode,200);
    assert.equal((await app.inject({method:'POST',url:`/api/admin/papers/${p.id}/material`,headers:{'x-csrf-token':'dev'},payload:{versionId:p.active_version_id}})).statusCode,409);
    config.devAdmin=null;assert.equal((await app.inject(`/api/admin/papers/${p.id}?version=${p.active_version_id}`)).statusCode,401);
  }finally{config.devAdmin=previous;installModules([]);await app.close();}
});

test('并发相同原文只保存一个版本，不能把其他论文的版本设为当前',async()=>{
  const p=await createPaper({title:'A',pdfBase64:pdf('a').toString('base64')}),other=await createPaper({title:'B',pdfBase64:pdf('b').toString('base64')});
  const input={label:'revision',pdfBase64:pdf('same').toString('base64'),confirmSamePaper:true};
  const result=await Promise.all([addPaperVersion(p.id,input),addPaperVersion(p.id,input)]);
  assert.equal(result[0].versionId,result[1].versionId);assert.equal((await listVersions(p.id)).length,2);
  await assert.rejects(selectPaperVersion(p.id,other.active_version_id!,p.active_version_id!),/不存在/);
});
