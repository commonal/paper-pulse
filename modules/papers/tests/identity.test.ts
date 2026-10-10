import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {installModules} from '@aihot/backend/modules';
import {buildApp} from '../../../apps/api/src/app.ts';
import papers from '../server.ts';
import {identifyImport,getImportPreview,extractPdfHints,paperIdentityQueue,enqueueIdentityOcr,recoverIdentityPreviews} from '../backend/identity.ts';
import {createPaper} from '../backend/store.ts';
import {collectPaper} from '../backend/collection.ts';
import {paperMaterialQueue} from '../backend/queue.ts';
import {materialByPaperId} from '../backend/material.ts';
import {pdfHints,matchIdentity} from '../identity.ts';
after(async()=>{await stopBoss();await closeDb();});

function pdf(lines:{text:string;size:number}[]){
  const stream=lines.map((line,i)=>`BT /F1 ${line.size} Tf 50 ${760-i*40} Td (${line.text.replace(/[\\()]/g,'\\$&')}) Tj ET`).join('\n');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
const title='Evidence Grounded Retrieval with Agents';
const textPdf=()=>pdf([{text:title,size:20},{text:'Jane Doe and John Smith',size:12},{text:'Abstract',size:12},
  {text:'We evaluate retrieval models on a held out collection and compare against strong baselines.',size:10}]);
function work(doi:string,t=title,authors=['Doe','Smith']){return {DOI:doi,title:[t],author:authors.map(family=>({given:'Researcher',family})),
  'container-title':['Journal of Machine Learning Research'],published:{'date-parts':[[2021]]}};}
function fakeCrossref(records:Record<string,unknown>,search:unknown[]){
  const calls:string[]=[];const previous=globalThis.fetch;
  globalThis.fetch=(async(input)=>{const url=new URL(String(input));calls.push(url.href);assert.equal(url.origin,'https://api.crossref.org','测试禁止任何未声明的外部调用');
    if(url.searchParams.has('query.bibliographic'))return Response.json({message:{items:search}});
    const record=records[decodeURIComponent(url.pathname.replace('/works/',''))];return record?Response.json({message:record}):new Response('',{status:404});}) as typeof fetch;
  return {calls,restore:()=>{globalThis.fetch=previous;}};
}

test('首页标题提取和身份匹配拒绝参考文献 DOI、无作者佐证与伪造 PDF 元数据',async()=>{
  const hints=pdfHints([{text:title,size:20,y:700,x:50},{text:'Jane Doe John Smith',size:12,y:650,x:50},{text:'Abstract',size:12,y:620,x:50},
    {text:'Study evidence and compare retrieval baselines carefully for this specific dataset.',size:10,y:580,x:50},{text:'References',size:12,y:500,x:50},{text:'10.1234/foreign',size:10,y:480,x:50}], 'Unrelated PDF metadata');
  assert.equal(hints.title_hint,title);assert.deepEqual(hints.doi_hints,[]);
  assert.equal(pdfHints([{text:title,size:20,y:700,x:50},{text:'Unrelated PDF metadata cited in the body.',size:10,y:400,x:50}], 'Unrelated PDF metadata').title_hint,title);
  assert.equal(matchIdentity(title,['Doe','Smith'],hints).matched,true);
  assert.equal(matchIdentity(title,['Other','Author'],hints).matched,false);
  assert.equal(matchIdentity('Evidence Grounded Retrieval with Different Agents',['Doe','Smith'],hints).matched,false);
  const noAbstract=pdfHints([{text:title,size:20,y:700,x:50},{text:'Jane Doe John Smith',size:12,y:650,x:50},
    {text:'Previous work cites Other and Author for a different method.',size:10,y:400,x:50}]);
  assert.equal(matchIdentity(title,['Other','Author'],noAbstract).matched,false,'正文引用的作者不能冒充首页作者');
  assert.equal((await extractPdfHints(textPdf())).title_hint,title);
  await assert.rejects(extractPdfHints(Buffer.from('%PDF-invalid')),/PDF/);
});

test('结果未知的 OCR 回执不会由恢复调度启动另一笔请求',async()=>{
  const previous=process.env.MINERU_CALLS_ENABLED;process.env.MINERU_CALLS_ENABLED='true';
  const id=randomUUID();
  try{
    await sql`INSERT INTO paper_import_previews(id,input_key,pdf_data,state) VALUES(${id},${'unknown-test:'+id},${pdf([])},'waiting')`;
    await sql`INSERT INTO receipts(logical_key,service,purpose,subject,status) VALUES(${randomUUID()},'mineru','paper_material',${'paper:'+id},'unknown')`;
    await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES('mineru',1000,1000,1000) ON CONFLICT(service) DO UPDATE SET per_minute=1000,per_hour=1000,per_day=1000`;
    assert.equal((await recoverIdentityPreviews()).resumed,0);
    assert.equal((await sql`SELECT * FROM pgboss.job WHERE name='papers.identity' AND data->>'previewId'=${id}`).length,0);
  }finally{if(previous===undefined)delete process.env.MINERU_CALLS_ENABLED;else process.env.MINERU_CALLS_ENABLED=previous;}
});

test('实际 PDF 预览只自动选同时匹配标题作者的记录；保存核验绑定文件与来源，查找重复不调用模型',async()=>{
  const doi='10.1234/'+randomUUID(),mock=fakeCrossref({[doi]:work(doi)},[work(doi),work('10.1234/wrong',title,['Other','Author'])]);
  const enabled=process.env.MINERU_CALLS_ENABLED;process.env.MINERU_CALLS_ENABLED='false';
  try{
    const base64=textPdf().toString('base64'),preview=await identifyImport({pdfBase64:base64});
    assert.equal(preview.state,'ready');assert.equal(preview.result.selected_key,'crossref:'+doi);
    const c=preview.result.candidates.find(c=>c.key===preview.result.selected_key)!;assert.equal(c.match,'matched');assert.equal(c.published,'');assert.equal(c.metadata.publication_year,2021);
    const input={title:c.title,authors:c.authors,sourceUrl:c.source_url,doi:c.doi,pdfBase64:base64,previewId:preview.id,identityKey:c.key};
    await assert.rejects(createPaper({...input,pdfBase64:pdf([{text:'Changed file',size:20}]).toString('base64')}),/PDF 已改变/);
    await assert.rejects(createPaper({...input,doi:'10.1234/changed'}),/DOI 已改变/);
    await assert.rejects(createPaper({...input,identityKey:'forged-key'}),/有效的论文身份/);
    const p=await createPaper(input);assert.equal(p.metadata!.identity_status,'matched');assert.equal(p.collection!.reason,'');
    await collectPaper(p.id,{tags:['保留标签'],reason:'保留我的阅读原因'});
    const repeated=await createPaper({...input,collection:{tags:[],reason:''}});
    assert.deepEqual(repeated.collection!.tags,['保留标签']);assert.equal(repeated.collection!.reason,'保留我的阅读原因');
    assert.equal((await sql`SELECT * FROM paper_reading_tasks WHERE paper_id=${p.id}`).length,0);
    const [stored]=await sql`SELECT pdf_data FROM paper_import_previews WHERE id=${preview.id}`;assert.equal(stored.pdf_data,null);
    const calls=mock.calls.length,again=await identifyImport({pdfBase64:base64});assert.equal(again.result.candidates[0].existing_id,p.id);assert.equal(mock.calls.length,calls);
    const owned=again.result.candidates[0];
    const duplicate=await createPaper({title:owned.title,authors:owned.authors,previewId:again.id,identityKey:owned.key});
    assert.equal(duplicate.metadata!.identity_checked_at,p.metadata!.identity_checked_at,'仅核对相同文件不刷新外部身份核验时间');
  }finally{mock.restore();if(enabled===undefined)delete process.env.MINERU_CALLS_ENABLED;else process.env.MINERU_CALLS_ENABLED=enabled;}
});

test('DOI 记录查询保持日期精度；预览和状态只允许管理员，读取不触发外部查询',async()=>{
  const doi='10.1234/'+randomUUID(),mock=fakeCrossref({[doi]:work(doi)},[]),previous=config.devAdmin;
  config.devAdmin={displayName:'Identity test'};installModules([papers]);const app=await buildApp();await app.ready();
  try{
    assert.equal((await app.inject({method:'POST',url:'/api/admin/papers/import-preview',payload:{input:doi}})).statusCode,403);
    const response=await app.inject({method:'POST',url:'/api/admin/papers/import-preview',headers:{'x-csrf-token':'dev'},payload:{input:doi}});
    assert.equal(response.statusCode,200,response.body);const p=response.json();assert.equal(p.result.candidates[0].match,'record');assert.equal(p.result.candidates[0].published,'');
    const count=mock.calls.length;await app.inject('/api/admin/papers/import-preview/'+p.id);assert.equal(mock.calls.length,count);
    const c=p.result.candidates[0];await assert.rejects(createPaper({title:c.title,authors:c.authors,previewId:p.id,identityKey:c.key,collection:{read:true}}),/尚无可解析全文/);
    const saved=await createPaper({title:c.title,authors:c.authors,previewId:p.id,identityKey:c.key});assert.equal(saved.metadata!.identity_status,'record_found');
    assert.equal((await sql`SELECT * FROM paper_reading_tasks WHERE paper_id=${saved.id}`).length,0);
    config.devAdmin=null;assert.equal((await app.inject('/api/admin/papers/import-preview/'+p.id)).statusCode,401);
  }finally{config.devAdmin=previous;installModules([]);await app.close();mock.restore();}
});

test('正文里无关 DOI 不会被自动选中；外部查询失败的 PDF 预览允许重查',async()=>{
  const doi='10.1234/'+randomUUID(),foreign='10.1234/foreign',original=globalThis.fetch;
  let unavailable=true;
  globalThis.fetch=(async(input)=>{const url=new URL(String(input));assert.equal(url.origin,'https://api.crossref.org');
    if(unavailable)return new Response('',{status:503});
    return url.searchParams.has('query.bibliographic')?Response.json({message:{items:[work(doi)]}}):Response.json({message:work(foreign,'A different publication',['Different','Authors'])});
  }) as typeof fetch;
  const base64=pdf([{text:title,size:20},{text:'Jane Doe John Smith',size:12},{text:'Abstract',size:12},
    {text:'This research compares retrieval baselines and also cites a separate previous study.',size:10},{text:foreign+' '+randomUUID(),size:8}]).toString('base64');
  try{
    const first=await identifyImport({pdfBase64:base64});assert.equal(first.result.selected_key,'pdf');assert.ok(first.result.warnings.length);
    unavailable=false;const retry=await identifyImport({pdfBase64:base64});assert.equal(retry.id,first.id);assert.equal(retry.result.selected_key,'crossref:'+doi);
  }finally{globalThis.fetch=original;}
});

test('扫描 PDF OCR 只由队列执行，经预算/回执；完成材料被导入与精读复用',async()=>{
  const original=globalThis.fetch,env={token:process.env.MINERU_API_TOKEN,enabled:process.env.MINERU_CALLS_ENABLED,poll:process.env.MINERU_POLL_INTERVAL_SECONDS};
  process.env.MINERU_API_TOKEN='test-token';process.env.MINERU_CALLS_ENABLED='true';process.env.MINERU_POLL_INTERVAL_SECONDS='0';
  const doi='10.1234/'+randomUUID();let name='',calls=0;
  const archive=zipSync({'paper_content_list.json':strToU8(JSON.stringify([
    {type:'title',text:title,page_idx:0,bbox:[0,0,1,.1]},{type:'text',text:'Jane Doe John Smith',page_idx:0,bbox:[0,.2,1,.3]},
    {type:'title',text:'Abstract',page_idx:0,bbox:[0,.4,1,.5]},{type:'text',text:'We evaluate retrieval on a held out dataset and compare carefully against strong baselines.',page_idx:0,bbox:[0,.6,1,.7]}])),
    'full.md':strToU8('# '+title+'\n\nJane Doe John Smith\n\nAbstract\n\nA grounded retrieval study.')});
  globalThis.fetch=(async(input,init)=>{const url=String(input);
    if(url.startsWith('https://api.crossref.org/'))return Response.json({message:{items:[work(doi)]}});
    calls++;
    if(url.endsWith('/v4/file-urls/batch')){name=JSON.parse(String(init!.body)).files[0].name;return Response.json({code:0,data:{batch_id:'scan-batch',file_urls:['https://identity-upload.test/pdf']}});}
    if(url==='https://identity-upload.test/pdf')return new Response(null,{status:200});
    if(url.includes('/v4/extract-results/batch/'))return Response.json({code:0,data:{extract_result:[{file_name:name,state:'done',full_zip_url:'https://identity-result.test/file.zip'}]}});
    if(url==='https://identity-result.test/file.zip')return new Response(archive);
    throw new Error('Unexpected network destination');
  }) as typeof fetch;
  try{
    await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES('mineru',0,0,0) ON CONFLICT(service) DO UPDATE SET per_minute=0,per_hour=0,per_day=0`;
    const scanned=pdf([]),preview=await identifyImport({pdfBase64:scanned.toString('base64')});assert.equal(preview.state,'queued');assert.equal(calls,0);
    await paperIdentityQueue.run([{previewId:preview.id}]);assert.equal((await getImportPreview(preview.id))!.state,'waiting');assert.equal(calls,0);
    await sql`UPDATE pgboss.job SET state='failed' WHERE name='papers.identity' AND data->>'previewId'=${preview.id}`;
    assert.equal((await recoverIdentityPreviews()).resumed,0);
    await sql`UPDATE budgets SET per_minute=10,per_hour=20,per_day=100 WHERE service='mineru'`;
    await enqueueIdentityOcr(preview.id);await paperIdentityQueue.run([{previewId:preview.id}]);
    const ready=(await getImportPreview(preview.id))!;assert.equal(ready.state,'ready');assert.equal(ready.result.selected_key,'crossref:'+doi);assert.equal(calls,4);
    const c=ready.result.candidates.find(c=>c.key===ready.result.selected_key)!;
    const p=await createPaper({title:c.title,authors:c.authors,previewId:preview.id,identityKey:c.key});
    const material=(await materialByPaperId(p.id))!;assert.equal(material.status,'ready');assert.ok(material.receipt_id);assert.equal(material.blocks.length,4);
    await collectPaper(p.id,{read:true});await paperMaterialQueue.run([{paperId:p.id}]);assert.equal(calls,4,'精读不再次调用 MinerU');
  }finally{globalThis.fetch=original;for(const [key,value] of [['MINERU_API_TOKEN',env.token],['MINERU_CALLS_ENABLED',env.enabled],['MINERU_POLL_INTERVAL_SECONDS',env.poll]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}}
});
