import {createHash,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {z} from 'zod';
import {sql} from '@aihot/backend/db';
import {defineQueue,type Scheduled} from '@aihot/backend/modules';
import {enqueueOn,getBoss} from '@aihot/backend/jobs/queue';
import {credential} from '@aihot/backend/config';
import {decodePaperPdf,normalizePaperDoi,resolvePaperSource,paperById} from './store.ts';
import {parsePdfWithMineru} from './mineru.ts';
import {paperTaskFailure,paperTaskWaits} from './task-errors.ts';
import {matchCcfAVenue} from './ccf-venues.ts';
import {identityText,matchIdentity,pdfHints,type IdentityResult,type IdentityPreview,type IdentityCandidate} from '../identity.ts';
import type {PaperBlock} from '../types.ts';
import {budgetAvailable} from './recovery.ts';
type PreviewMaterial={markdown:string;blocks:PaperBlock[];receiptId:number;parser:string};

const bad=(message:string)=>Object.assign(new Error(message),{statusCode:400});
const conflict=(message:string)=>Object.assign(new Error(message),{code:'conflict'});
const empty=():IdentityResult=>({title_hint:'',author_hint:'',excerpt:'',doi_hints:[],arxiv_hints:[],candidates:[],selected_key:'',warnings:[],needs_ocr:false});
export const importPreviewInput=z.object({input:z.string().trim().max(2000).default(''),pdfBase64:z.string().max(28_000_000).optional()});

export async function extractPdfHints(pdf:Buffer):Promise<ReturnType<typeof pdfHints>>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./pdf-identity-worker.ts',import.meta.url),{workerData:new Uint8Array(pdf),execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}});
    const timer=setTimeout(()=>{void worker.terminate();reject(bad('PDF 首页识别超时，请手动填写身份'));},20000);
    worker.once('message',data=>{clearTimeout(timer);if(data.error)reject(bad(data.error));else resolve(data.result);void worker.terminate();});
    worker.once('error',()=>{clearTimeout(timer);reject(bad('PDF 首页识别失败，请检查文件或手动填写'));});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(bad('PDF 首页识别中断，请手动填写'));});
  });
}

async function crossref(path:string){
  const response=await fetch('https://api.crossref.org/works'+path,{headers:{accept:'application/json','user-agent':'PaperPulse/0.3 (paper identity verification)'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`Crossref 暂时不可用（HTTP ${response.status}）`);
  const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new Error('Crossref 元信息超过大小限制');}chunks.push(value);}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return data.message;
}
function candidateFromCrossref(record:any):IdentityCandidate|null{
  const title=Array.isArray(record?.title)?String(record.title[0]??'').trim().slice(0,500):'';
  let doi:string;try{doi=normalizePaperDoi(String(record?.DOI??''));}catch{return null;}
  if(!title||!doi||doi.length>300)return null;
  const authors=Array.isArray(record.author)?record.author.slice(0,30).map((a:any)=>[a.given,a.family].filter(v=>typeof v==='string').join(' ')).filter(Boolean).join(', ').slice(0,2000):'';
  const parts=(record['published-online']??record.published??record.issued)?.['date-parts']?.[0];
  const year=Array.isArray(parts)&&Number.isInteger(parts[0])&&parts[0]>=1500&&parts[0]<=new Date().getUTCFullYear()+1?parts[0]:null;
  const date=year&&parts.length>=3?`${year}-${String(parts[1]).padStart(2,'0')}-${String(parts[2]).padStart(2,'0')}`:'';
  const published=date&&Number.isFinite(new Date(date).getTime())&&new Date(date).toISOString().slice(0,10)===date?date:'';
  const venue=String(record['container-title']?.[0]??'').slice(0,500),ccf=matchCcfAVenue(venue);
  const url='https://doi.org/'+doi;
  return {key:'crossref:'+doi,title,authors,published,abstract:String(record.abstract??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,20000),
    source_url:url,pdf_url:'',doi,version:'PDF 版本未核验',source_kind:'crossref',match:'candidate',checks:[],
    metadata:{source:'crossref',metadata_source_url:'https://api.crossref.org/works/'+encodeURIComponent(doi),publication_year:year,date_precision:published?'day':year?'year':'unknown',venue_name:venue,
      ...(ccf?{ccf_rank:'A',ccf_catalog:'CCF 2022（2024 名称更新）',venue_verification:'source_matched'}:{})}};
}
async function arxivCandidate(id:string):Promise<IdentityCandidate>{
  const source=await resolvePaperSource('https://arxiv.org/abs/'+id);
  return {...source,key:'arxiv:'+id,doi:'',checks:[],match:'candidate',metadata:{source:'arxiv',metadata_source_url:source.source_url,date_precision:'day',publication_year:Number(source.published.slice(0,4))||null}};
}
async function duplicateCandidate(hash:string):Promise<IdentityCandidate|null>{
  const rows=await sql<{id:string}[]>`SELECT id FROM papers WHERE pdf_sha256=${hash} ORDER BY created_at LIMIT 2`;
  if(rows.length!==1)return null;
  const p=await paperById(rows[0].id);if(!p)return null;
  return {key:'existing:'+p.id,existing_id:p.id,title:p.title,authors:p.authors,published:p.published,abstract:p.abstract,source_url:p.source_url,pdf_url:p.pdf_url,
    version:p.version,source_kind:'existing',doi:p.doi??'',metadata:p.metadata??{},match:'matched',checks:['PDF 哈希与站内已保存原文完全一致；复用现有论文和解读']};
}
export async function verifyPdfIdentity(hints:ReturnType<typeof pdfHints>,previewId:string,hash:string):Promise<IdentityResult>{
  const result={...empty(),...hints};
  const existing=await duplicateCandidate(hash);
  if(existing){result.candidates=[existing];result.selected_key=existing.key;result.needs_ocr=false;return result;}
  const local:IdentityCandidate={key:'pdf',title:hints.title_hint,authors:'',published:'',abstract:'',source_url:'urn:paper-pulse:local:'+previewId,
    pdf_url:'',doi:'',version:'PDF 版本未核验',source_kind:'pdf',match:'local',checks:['首页提取线索，未通过外部身份核验'],metadata:{source:'pdf',date_precision:'unknown'}};
  result.candidates=[local];result.selected_key=local.key;
  if(hints.needs_ocr){result.warnings.push('首页文字不足，可能是扫描 PDF；OCR 完成后继续核验');return result;}
  try{
    const candidates:IdentityCandidate[]=[];
    for(const id of hints.arxiv_hints)candidates.push(await arxivCandidate(id));
    for(const doi of hints.doi_hints){const record=await crossref('/'+encodeURIComponent(doi));const c=record?candidateFromCrossref(record):null;if(c)candidates.push(c);}
    for(const c of candidates){
      const family=c.authors.split(',').map(a=>a.trim().split(/\s+/).at(-1)!);
      const check=matchIdentity(c.title,family,hints);c.match=check.matched?'matched':'candidate';c.checks=check.checks;
      if(!result.candidates.some(row=>row.key===c.key))result.candidates.push(c);
    }
    if(!result.candidates.some(c=>c.match==='matched')&&hints.title_hint.length>=12){
      const response=await crossref('?'+new URLSearchParams({'query.bibliographic':hints.title_hint,rows:'5'}));
      for(const record of response?.items??[]){const c=candidateFromCrossref(record);if(!c||result.candidates.some(row=>row.key===c.key))continue;
        const check=matchIdentity(c.title,c.authors.split(',').map(a=>a.trim().split(/\s+/).at(-1)!),hints);c.match=check.matched?'matched':'candidate';c.checks=check.checks;result.candidates.push(c);}
    }
    const matches=result.candidates.filter(c=>c.match==='matched');
    if(matches.length===1)result.selected_key=matches[0].key;
    else result.warnings.push(matches.length>1?'多个身份记录都可能匹配，请选择核对；不会自动合并预印本与发表版':'未能同时确认标题和作者，保持 PDF 本地身份，其他结果供核对');
  }catch(error){result.warnings.push((error as Error).message.slice(0,200)+'；PDF 可以仅保存，身份保持待核验');}
  return result;
}

export async function getImportPreview(id:string):Promise<IdentityPreview|null>{
  const [row]=await sql<IdentityPreview[]>`SELECT id,state,result,error FROM paper_import_previews WHERE id=${id}`;
  return row??null;
}
export async function identifyImport(input:unknown):Promise<IdentityPreview>{
  const b=importPreviewInput.parse(input),pdf=b.pdfBase64===undefined?null:decodePaperPdf(b.pdfBase64);
  if(!pdf&&!b.input)throw bad('请提供 DOI、arXiv 链接或 PDF');
  const hash=pdf?createHash('sha256').update(pdf).digest('hex'):null;
  const key=pdf?'pdf:'+hash:'link:'+b.input;
  const old=await sql<{id:string}[]>`SELECT id FROM paper_import_previews WHERE input_key=${key}`;
  if(old[0]){
    if(hash){const duplicate=await duplicateCandidate(hash);if(duplicate){const previous=(await getImportPreview(old[0].id))!;
      const result={...previous.result,candidates:[duplicate],selected_key:duplicate.key,needs_ocr:false,warnings:[]};
      await sql`UPDATE paper_import_previews SET state='ready',result=${sql.json(result as never)},error=NULL WHERE id=${old[0].id}`;
    }else{const previous=(await getImportPreview(old[0].id))!;
      if(previous.state==='ready'&&!previous.result.needs_ocr&&!previous.result.candidates.some(c=>c.match==='matched')){
        const result=await verifyPdfIdentity(await extractPdfHints(pdf!),old[0].id,hash);
        for(const c of result.candidates)c.metadata.identity_checked_at=new Date().toISOString();
        await sql`UPDATE paper_import_previews SET result=${sql.json(result as never)},updated_at=now() WHERE id=${old[0].id}`;
      }
    }}
    return (await getImportPreview(old[0].id))!;
  }
  const id=randomUUID();let result=empty();
  if(pdf){const hints=await extractPdfHints(pdf);
    if(b.input){try{const doi=normalizePaperDoi(b.input);if(doi)hints.doi_hints=[...new Set([doi,...hints.doi_hints])].slice(0,3);}catch{/* Only known identifiers are lookup hints; arbitrary PDF source URLs are not fetched. */}}
    result=await verifyPdfIdentity(hints,id,hash!);
  }
  else if(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i.test(b.input)){
    const c=await arxivCandidate(b.input.replace(/^.*\/(?:abs|pdf)\//i,'').replace(/\.pdf$/i,''));c.match='record';c.checks=['arXiv 元数据查询成功；尚未核验所持 PDF'];
    result={...result,candidates:[c],selected_key:c.key};
  }else{
    const doi=normalizePaperDoi(b.input);if(!doi)throw bad('请输入有效 DOI');
    let record;try{record=await crossref('/'+encodeURIComponent(doi));}catch{throw bad('Crossref 暂时不可用，请稍后重试；也可上传 PDF 或手动导入');}
    const c=record?candidateFromCrossref(record):null;
    if(!c||c.doi!==doi)throw bad('未找到对应 Crossref DOI 记录；仍可上传 PDF 或手动保存');
    c.match='record';c.checks=['DOI 登记记录查询成功；尚未核验所持 PDF'];result={...result,candidates:[c],selected_key:c.key};
  }
  for(const c of result.candidates)if(c.source_kind!=='existing')c.metadata.identity_checked_at=new Date().toISOString();
  const [created]=await sql<{id:string}[]>`INSERT INTO paper_import_previews(id,input_key,pdf_sha256,pdf_data,result)
    VALUES(${id},${key},${hash},${pdf},${sql.json(result as never)}) ON CONFLICT(input_key) DO UPDATE SET input_key=EXCLUDED.input_key RETURNING id`;
  if(result.needs_ocr&&process.env.MINERU_CALLS_ENABLED==='true'&&credential('integrations','MINERU_API_TOKEN'))await enqueueIdentityOcr(created.id);
  return (await getImportPreview(created.id))!;
}
export async function enqueueIdentityOcr(id:string){
  if(process.env.MINERU_CALLS_ENABLED!=='true'||!credential('integrations','MINERU_API_TOKEN'))throw conflict('MinerU OCR 未启用或未配置，请手动补充身份');
  await getBoss();
  await sql.begin(async tx=>{
    const [row]=await tx`SELECT state,pdf_data,material FROM paper_import_previews WHERE id=${id} FOR UPDATE`;
    if(!row?.pdf_data)throw bad('没有可供 OCR 的预览 PDF');
    const active=await tx`SELECT id FROM pgboss.job WHERE name='papers.identity' AND data->>'previewId'=${id} AND state IN ('created','retry','active') LIMIT 1`;
    if(active.length||row.material)return;
    await tx`UPDATE paper_import_previews SET state='queued',error=NULL,updated_at=now() WHERE id=${id}`;
    await enqueueOn(paperIdentityQueue,{previewId:id},{singletonKey:id},tx);
  });
}
export const paperIdentityQueue=defineQueue<{previewId:string}>({name:'papers.identity',options:{policy:'short',retryLimit:0,expireInSeconds:900},worker:{batchSize:1},async run(jobs){
  for(const {previewId:id} of jobs){
    const [row]=await sql`UPDATE paper_import_previews SET state='running',updated_at=now() WHERE id=${id} AND state='queued' RETURNING pdf_data,pdf_sha256`;
    if(!row?.pdf_data)continue;
    try{
      if(process.env.MINERU_CALLS_ENABLED!=='true')throw new Error('MinerU OCR 已关闭，请开启后重试或手动补充');
      const parsed=await parsePdfWithMineru({pdf:row.pdf_data,sourceId:id,sourceUrl:'urn:paper-pulse:local:'+id});
      const first=parsed.blocks.filter(b=>b.page===1&&['heading','text'].includes(b.kind));
      const hints=pdfHints(first.map((b,index)=>({text:b.text,size:b.kind==='heading'?20:10,x:0,y:b.bbox?1000*(1-b.bbox[1]):1000-index*8})));
      const result=await verifyPdfIdentity(hints,id,row.pdf_sha256);result.needs_ocr=false;
      for(const c of result.candidates)if(c.source_kind!=='existing')c.metadata.identity_checked_at=new Date().toISOString();
      if(hints.needs_ocr)result.warnings.push('OCR 后首页线索仍不足，请手动补充身份');
      await sql`UPDATE paper_import_previews SET state='ready',result=${sql.json(result as never)},material=${sql.json({...parsed,parser:'mineru_api'} as never)},error=NULL,updated_at=now() WHERE id=${id}`;
    }catch(error){const failure=paperTaskFailure(error);await sql`UPDATE paper_import_previews SET state=${paperTaskWaits(error)?'waiting':'failed'},error=${failure.error},updated_at=now() WHERE id=${id}`;}
  }
}});
export async function recoverIdentityPreviews(){
  await getBoss();
  const rows=await sql<{id:string;received:boolean}[]>`SELECT p.id,
    EXISTS(SELECT 1 FROM receipts r WHERE r.subject='paper:'||p.id::text AND r.purpose='paper_material' AND r.status IN ('received','completed')) AS received
    FROM paper_import_previews p WHERE p.state IN ('queued','running','waiting') AND p.pdf_data IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM pgboss.job j WHERE j.name='papers.identity' AND j.data->>'previewId'=p.id::text AND j.state IN ('created','retry','active'))
      AND NOT EXISTS(SELECT 1 FROM receipts r WHERE r.subject='paper:'||p.id::text AND r.status IN ('pending','unknown')) ORDER BY p.updated_at LIMIT 5`;
  if(process.env.MINERU_CALLS_ENABLED!=='true')return {resumed:0};
  const available=await budgetAvailable('mineru');let resumed=0;
  for(const row of rows){if(!row.received&&!available)continue;await enqueueIdentityOcr(row.id);resumed++;}
  return {resumed};
}
export const paperIdentityRecoverySchedule:Scheduled={name:'papers.identity-recovery',cron:'*/5 * * * *',missed:'skip',run:recoverIdentityPreviews};

export async function resolveImportSelection(id:string,key:string,pdf:Buffer|null){
  const [row]=await sql<{state:string;result:IdentityResult;pdf_data:Buffer|null;pdf_sha256:string|null;material:PreviewMaterial|null}[]>`SELECT state,result,pdf_data,pdf_sha256,material FROM paper_import_previews WHERE id=${id}`;
  if(!row||row.state!=='ready')throw conflict('身份预览尚未准备好，请等待或手动导入');
  const candidate=row.result.candidates.find(c=>c.key===key);if(!candidate)throw bad('请选择本次预览中有效的论文身份');
  if(pdf&&createHash('sha256').update(pdf).digest('hex')!==row.pdf_sha256)throw conflict('PDF 已改变，请重新识别后保存');
  if(!row.pdf_sha256&&pdf)throw conflict('新增了 PDF，请重新识别以核对身份');
  return {candidate,pdf:pdf??row.pdf_data,material:row.material};
}
