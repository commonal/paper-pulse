import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {getBoss,stopBoss} from '@aihot/backend/jobs/queue';
import {buildApp} from '../../../apps/api/src/app.ts';
import {installModules} from '@aihot/backend/modules';
import papers from '../server.ts';
import {createPaper,detail} from '../backend/store.ts';
import {addNote,editNote,noteById} from '../backend/notes.ts';
import {addPaperVersion,selectPaperVersion} from '../backend/versions.ts';
import {illustrationSignature} from '../backend/illustration-plan.ts';
import {noteAnchorMatches} from '../notes.ts';
after(async()=>{await stopBoss();await closeDb();});
async function fixture(){
  const p=await createPaper({title:'Notes paper',pdfBase64:Buffer.from('%PDF-1.4\n'+randomUUID()+'\n%%EOF').toString('base64')});
  const block={id:'f1',kind:'figure',text:'Figure 1 supports the mechanism.',caption:'Figure 1: mechanism',section_path:['Method'],page:2,bbox:[0,0,1000,1000],locator:'fixture'};
  await sql`UPDATE paper_materials SET status='ready',parser='mineru_api',blocks=${sql.json([block])} WHERE paper_id=${p.id}`;
  await sql`UPDATE paper_digests SET status='ready',sections=${sql.json([{id:'method',title:'核心方法',claims:[{id:'m1',text:'方法依据概念需求分配预算。',support:'direct',evidence_block_ids:['f1']}]}])},material_updated_at=(SELECT updated_at FROM paper_materials WHERE paper_id=${p.id}) WHERE paper_id=${p.id}`;
  const d=(await detail(p.id))!;
  await sql`INSERT INTO paper_illustrations(paper_id,status,input_signature,selections) VALUES(${p.id},'ready',${illustrationSignature(p,d.material!,d.digest!)},${sql.json([{block_id:'f1',after_claim_id:'m1',title:'机制图',explanation:'这是流程示意，需要结合实验。',evidence_block_ids:['f1'],image_sha256:'image-fixture'}])})`;
  return (await detail(p.id))!;
}
test('批注引用由服务器生成，绑定解读及原文版本，同ID重放只创建一次，无付费或队列任务',async()=>{
  await getBoss();
  const d=await fixture(),ctx=d.note_context!,id=randomUUID();const [before]=await sql`SELECT count(*)::int AS n FROM receipts`;
  const input={id,title:'机制理解',markdown:'**自己的理解**\n<script>alert(1)</script>\n![remote](https://tracker.invalid/a.png)',versionId:ctx.versionId,readingSignature:ctx.readingSignature,target:{kind:'claim',targetId:'m1'},anchor:{excerpt:'伪造'},page:999};
  const [a,b]=await Promise.all([addNote(d.paper.id,input),addNote(d.paper.id,input)]);assert.equal(a!.id,b!.id);assert.equal(a!.revision,1);assert.equal(a!.page,2);
  assert.equal(a!.anchor!.excerpt,'方法依据概念需求分配预算。');assert.equal(a!.anchor!.receiptId,d.digest!.receipt_id);assert.equal(a!.anchor!.versionId,ctx.versionId);
  assert(!a!.html.includes('<script'));assert(!a!.html.includes('<img'));assert.equal((await detail(d.paper.id))!.notes.length,1);
  const figure=await addNote(d.paper.id,{...input,id:randomUUID(),target:{kind:'figure',targetId:'f1'}});assert.equal(figure!.anchor!.imageSha256,'image-fixture');
  const [after]=await sql`SELECT count(*)::int AS n FROM receipts`;assert.equal(after.n,before.n);
  const [jobs]=await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'paperId'=${d.paper.id}`;assert.equal(jobs.n,0);
  await assert.rejects(addNote(d.paper.id,{...input,id:randomUUID(),target:{kind:'claim',targetId:'missing'}}),/段落不存在/);
  const other=await fixture();await assert.rejects(addNote(other.paper.id,{...input,versionId:other.note_context!.versionId,readingSignature:other.note_context!.readingSignature}),/其他论文/);
});
test('重新精读保持笔记原句，旧创建请求拒绝，未知响应同ID可取回原笔记，编辑不会移动批注',async()=>{
  const d=await fixture(),ctx=d.note_context!,input={id:randomUUID(),title:'原批注',markdown:'保留我',...{versionId:ctx.versionId,readingSignature:ctx.readingSignature},target:{kind:'claim',targetId:'m1'}};
  const note=(await addNote(d.paper.id,input))!;
  await sql`UPDATE paper_digests SET sections=${sql.json([{id:'method',title:'核心方法',claims:[{id:'m1',text:'后来修订的方法文字。',support:'direct',evidence_block_ids:['f1']}]}])} WHERE paper_id=${d.paper.id}`;
  const updated=(await detail(d.paper.id))!;assert.equal(updated.notes[0].anchor!.excerpt,note.anchor!.excerpt);assert.equal(noteAnchorMatches(note.anchor,updated.digest,updated.illustrations!),false);
  await assert.rejects(addNote(d.paper.id,{...input,id:randomUUID()}),/解读已更新/);assert.equal((await addNote(d.paper.id,input))!.id,note.id);
  const edited=(await editNote(d.paper.id,note.id,{title:note.title,markdown:'我补充了想法',page:99,revision:1,anchor:{excerpt:'伪造修改'}}))!;assert.deepEqual(edited.anchor,note.anchor);assert.equal(edited.page,2);
  await assert.rejects(editNote(d.paper.id,note.id,{title:'覆盖',markdown:'不要覆盖',revision:1}),/另一个页面更新/);assert.equal((await noteById(d.paper.id,note.id))!.markdown,'我补充了想法');
});
test('历史解读可记笔记，写入所选原文而非当前PDF，切换后仍保留，私人路由及CSRF保护',async()=>{
  const d=await fixture(),v=await addPaperVersion(d.paper.id,{label:'新PDF',confirmSamePaper:true,pdfBase64:Buffer.from('%PDF-1.4\n'+randomUUID()+'\n%%EOF').toString('base64')});
  await selectPaperVersion(d.paper.id,v.versionId,d.paper.active_version_id!);
  const history=(await detail(d.paper.id,d.paper.active_version_id!))!,ctx=history.note_context!;assert(ctx);
  const input={id:randomUUID(),title:'旧版批注',markdown:'历史文字',versionId:ctx.versionId,readingSignature:ctx.readingSignature,target:{kind:'claim',targetId:'m1'}};
  const previous=config.devAdmin;config.devAdmin={displayName:'Notes test'};installModules([papers]);const app=await buildApp();await app.ready();
  try{
    const base='/api/admin/papers/'+d.paper.id+'/notes';assert.equal((await app.inject({method:'POST',url:base,payload:input})).statusCode,403);
    const result=await app.inject({method:'POST',url:base,headers:{'x-csrf-token':'dev'},payload:input});assert.equal(result.statusCode,201);assert.equal(result.json().pdf_sha256,d.paper.pdf_sha256);
    assert.equal((await detail(d.paper.id))!.notes.length,0);assert.equal((await detail(d.paper.id,ctx.versionId))!.notes.length,1);
    assert.equal((await app.inject(base+'/'+input.id)).statusCode,200);
    config.devAdmin=null;assert.equal((await app.inject(base+'/'+input.id)).statusCode,401);
    config.devAdmin={displayName:'Notes test'};await selectPaperVersion(d.paper.id,ctx.versionId,v.versionId);assert.equal((await detail(d.paper.id))!.notes[0].markdown,'历史文字');
  }finally{config.devAdmin=previous;installModules([]);await app.close();}
});
