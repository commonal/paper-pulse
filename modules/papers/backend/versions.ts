import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sql,type Db} from '@aihot/backend/db';
import {getBoss} from '@aihot/backend/jobs/queue';
import type {Paper} from '../types.ts';
import type {PaperVersion,VersionSnapshot} from '../versions.ts';

const conflict=(message:string)=>Object.assign(new Error(message),{code:'conflict'});
const missing=()=>Object.assign(new Error('论文或原文版本不存在'),{statusCode:400});
const tables={material:'paper_materials',digest:'paper_digests',presentation:'paper_presentations',illustrations:'paper_illustrations',task:'paper_reading_tasks'} as const;

async function snapshot(id:string,db:Db):Promise<VersionSnapshot>{
  const [p]=await db`SELECT to_jsonb(p)-'pdf_data' AS paper FROM papers p WHERE id=${id}`;
  if(!p)throw missing();
  const data:any={paper:p.paper};
  for(const [key,table] of Object.entries(tables)){
    const [row]=await db`SELECT to_jsonb(t) AS value FROM ${db(table)} t WHERE paper_id=${id}`;data[key]=row?.value??null;
  }
  return data;
}
export async function ensureCurrentVersion(id:string,db:Db):Promise<string>{
  const [p]=await db`SELECT * FROM papers WHERE id=${id} FOR UPDATE`;
  if(!p)throw missing();
  if(p.active_version_id)return p.active_version_id;
  const value=await snapshot(id,db),vid=randomUUID();
  await db`INSERT INTO paper_versions(id,paper_id,version_key,label,kind,source_url,pdf_url,pdf_sha256,pdf_data,snapshot)
    VALUES(${vid},${id},${'original:'+id},${p.version},'uploaded',${p.source_url},${p.pdf_url},${p.pdf_sha256},${p.pdf_data},${db.json(value as never)})`;
  await db`UPDATE papers SET active_version_id=${vid} WHERE id=${id}`;
  return vid;
}
export async function captureCurrentVersion(id:string,db:Db){
  const vid=await ensureCurrentVersion(id,db),value=await snapshot(id,db);
  await db`UPDATE paper_versions v SET pdf_data=p.pdf_data,pdf_sha256=p.pdf_sha256,snapshot=${db.json(value as never)}
    FROM papers p WHERE p.id=${id} AND v.id=${vid}`;
  return vid;
}
export async function listVersions(id:string):Promise<PaperVersion[]>{
  return sql<PaperVersion[]>`SELECT v.id,v.label,v.kind,v.source_url,v.pdf_url,
    CASE WHEN v.id=p.active_version_id THEN p.pdf_sha256 ELSE v.pdf_sha256 END AS pdf_sha256,
    CASE WHEN v.id=p.active_version_id THEN p.pdf_data IS NOT NULL ELSE v.pdf_data IS NOT NULL END AS has_pdf,
    v.id=p.active_version_id AS is_current,
    CASE WHEN v.id=p.active_version_id THEN d.status='ready' ELSE v.snapshot->'digest'->>'status'='ready' END AS has_reading,v.created_at
    FROM paper_versions v JOIN papers p ON p.id=v.paper_id LEFT JOIN paper_digests d ON d.paper_id=p.id
    WHERE v.paper_id=${id} ORDER BY v.created_at,v.id`;
}
export async function archivedVersion(id:string,versionId:string):Promise<VersionSnapshot|null>{
  const [v]=await sql`SELECT v.snapshot,p.active_version_id FROM paper_versions v JOIN papers p ON p.id=v.paper_id WHERE v.id=${versionId} AND v.paper_id=${id}`;
  if(!v)throw missing();
  return v.active_version_id===versionId?null:v.snapshot;
}
export async function versionPdf(id:string,versionId:string){
  const [v]=await sql`SELECT CASE WHEN v.id=p.active_version_id THEN p.pdf_data ELSE v.pdf_data END AS pdf_data,
    CASE WHEN v.id=p.active_version_id THEN p.pdf_sha256 ELSE v.pdf_sha256 END AS pdf_sha256
    FROM paper_versions v JOIN papers p ON p.id=v.paper_id WHERE v.paper_id=${id} AND v.id=${versionId}`;
  return v??null;
}
export const versionInput=z.object({label:z.string().trim().min(1).max(100),kind:z.enum(['preprint','published','uploaded']).default('uploaded'),
  sourceUrl:z.string().trim().max(2000).default('').refine(s=>{if(!s)return true;try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}},'请输入有效来源链接'),
  pdfBase64:z.string().max(28_000_000).optional(),previewId:z.uuid().optional(),identityKey:z.string().max(500).optional(),
  confirmSamePaper:z.literal(true)});
export async function addPaperVersion(id:string,input:unknown){
  const b=versionInput.parse(input),{decodePaperPdf,arxivId}=await import('./store.ts');
  let pdf:Buffer|null=b.pdfBase64===undefined?null:decodePaperPdf(b.pdfBase64);
  const selection=b.previewId?await (await import('./identity.ts')).resolveImportSelection(b.previewId,b.identityKey??'',pdf):null;
  if(selection)pdf=selection.pdf;
  if(!pdf)throw conflict('新增原文版本需要 PDF 文件');
  const hash=createHash('sha256').update(pdf).digest('hex');
  const result=await sql.begin(async db=>{
    await captureCurrentVersion(id,db);
    const [p]=await db<(Paper&{pdf_data:Buffer|null})[]>`SELECT *,(pdf_data IS NOT NULL) AS has_pdf FROM papers WHERE id=${id}`;
    const c=selection?.candidate;
    const source=b.sourceUrl||c?.source_url||p.source_url;
    let stableArxiv:string|null=null;try{stableArxiv=arxivId(source).replace(/v\d+$/,'');}catch{/* Uploaded PDFs may have no repository ID. */}
    if(c?.doi&&p.doi&&c.doi!==p.doi)throw conflict('这份 PDF 的 DOI 与当前论文不同，请先核对归属');
    if(c?.source_kind==='arxiv'&&p.arxiv_id&&arxivId(c.source_url).replace(/v\d+$/,'')!==p.arxiv_id)throw conflict('这份 PDF 的 arXiv 标识与当前论文不同');
    if(stableArxiv&&p.arxiv_id&&stableArxiv!==p.arxiv_id)throw conflict('来源链接的 arXiv 标识与当前论文不同');
    const [existing]=await db`SELECT id FROM paper_versions WHERE paper_id=${id} AND pdf_sha256=${hash}`;
    if(existing)return {versionId:existing.id,added:false};
    const {pdf_data:_,...base}=p;
    const vid=randomUUID(),value:VersionSnapshot={paper:{...base,active_version_id:vid,
      source_url:source,pdf_url:c?.pdf_url??'',version:c?.version??'PDF 版本未核验',pdf_sha256:hash,
      metadata:{...p.metadata,identity_status:'user_confirmed',identity_checks:['原文归属由使用者确认；本文件书目信息尚未自动核验']},
      ...(c?{title:c.title||p.title,authors:c.authors||p.authors,published:c.published,abstract:c.abstract,metadata:{...c.metadata,identity_status:c.match==='matched'?'matched':c.match==='record'?'record_found':'user_confirmed',identity_checks:c.checks}}:{})},
      material:selection?.material?{...selection.material,paper_id:id,status:'ready',receipt_id:selection.material.receiptId,error:null,updated_at:new Date().toISOString()}:null,
      digest:null,presentation:null,illustrations:null,task:null};
    await db`INSERT INTO paper_versions(id,paper_id,version_key,label,kind,source_url,pdf_url,pdf_sha256,pdf_data,snapshot)
      VALUES(${vid},${id},${'pdf:'+hash},${b.label},${b.kind},${value.paper.source_url},${value.paper.pdf_url},${hash},${pdf},${db.json(value as never)})`;
    if(c?.doi)await db`UPDATE papers SET doi=coalesce(doi,${c.doi}) WHERE id=${id}`;
    if(stableArxiv)await db`UPDATE papers SET arxiv_id=coalesce(arxiv_id,${stableArxiv}) WHERE id=${id}`;
    if(b.previewId)await db`UPDATE paper_import_previews SET pdf_data=NULL WHERE id=${b.previewId}`;
    return {versionId:vid,added:true};
  });
  return {...result,versions:await listVersions(id)};
}
async function idle(id:string,db:Db){
  const [t]=await db`SELECT status FROM paper_reading_tasks WHERE paper_id=${id}`;
  const jobs=await db`SELECT id FROM pgboss.job WHERE data->>'paperId'=${id} AND name IN ('papers.material','papers.digest','papers.illustrations') AND state IN ('created','retry','active') LIMIT 1`;
  const requests=await db`SELECT id FROM receipts WHERE subject=${'paper:'+id} AND status IN ('pending','unknown') LIMIT 1`;
  if(['queued','running','waiting'].includes(t?.status)||jobs.length||requests.length)throw conflict('当前版本有未结束的精读任务或请求，请完成处理后切换；仍可查看历史版本');
}
export async function selectPaperVersion(id:string,versionId:string,expected?:string,read=false){
  await getBoss();
  await sql.begin(async db=>{
    const current=await ensureCurrentVersion(id,db);
    if(expected&&expected!==current)throw conflict('当前原文已改变，请刷新版本列表后重试');
    if(current===versionId){if(read){const {saveCollection}=await import('./collection.ts');await saveCollection(id,{read:true},db);}return;}
    const [v]=await db`SELECT * FROM paper_versions WHERE id=${versionId} AND paper_id=${id}`;
    if(!v)throw missing();
    await idle(id,db);await captureCurrentVersion(id,db);
    const data=v.snapshot as VersionSnapshot;
    const p=data.paper;
    await db`UPDATE papers SET title=${p.title},authors=${p.authors},published=${p.published},topic=${p.topic},abstract=${p.abstract},
      source_url=${p.source_url},pdf_url=${p.pdf_url},version=${p.version},metadata=${db.json((p.metadata??{}) as never)},
      pdf_data=${v.pdf_data},pdf_sha256=${v.pdf_sha256},active_version_id=${versionId} WHERE id=${id}`;
    for(const [key,table] of Object.entries(tables)){
      await db`DELETE FROM ${db(table)} WHERE paper_id=${id}`;
      let record=(data as any)[key];
      if(key==='task'&&record)record={...record,run_id:randomUUID(),options:{...record.options,versionId},updated_at:new Date().toISOString()};
      if(record)await db`INSERT INTO ${db(table)} SELECT * FROM jsonb_populate_record(NULL::${db(table)},${db.json(record)})`;
    }
    await db`INSERT INTO paper_materials(paper_id,status) VALUES(${id},'unavailable') ON CONFLICT(paper_id) DO NOTHING`;
    await db`INSERT INTO paper_digests(paper_id,status) VALUES(${id},'unavailable') ON CONFLICT(paper_id) DO NOTHING`;
    if(read){const {saveCollection}=await import('./collection.ts');await saveCollection(id,{read:true},db);}
  });
  return {selected:versionId};
}
export async function saveDiscoveredVersion(id:string,paper:Record<string,unknown>,db:Db){
  await ensureCurrentVersion(id,db);
  const {pdf_data:_,...base}=paper;
  const key='arxiv:'+paper.source_url;
  const [v]=await db`INSERT INTO paper_versions(id,paper_id,version_key,label,kind,source_url,pdf_url,snapshot)
    VALUES(${randomUUID()},${id},${key},${paper.version as string},'preprint',${paper.source_url as string},${paper.pdf_url as string},${db.json({paper:base,material:null,digest:null,presentation:null,illustrations:null,task:null} as never)})
    ON CONFLICT(paper_id,version_key) DO UPDATE SET version_key=EXCLUDED.version_key RETURNING id`;
  return v.id;
}
export async function withReadableVersions(papers:Paper[]):Promise<Paper[]>{
  if(!papers.length)return papers;
  const rows=await sql`SELECT DISTINCT ON (paper_id) id,paper_id,snapshot,(pdf_data IS NOT NULL) AS has_pdf FROM paper_versions WHERE paper_id IN ${sql(papers.map(p=>p.id))}
    AND snapshot->'digest'->>'status'='ready' ORDER BY paper_id,created_at DESC`;
  const byId=new Map(rows.map(v=>[v.paper_id,v]));
  return papers.map(p=>{
    if(p.digest_status==='ready')return p;
    const v=byId.get(p.id);if(!v)return p;
    const s=v.snapshot as VersionSnapshot;
    return {...p,...s.paper,id:p.id,status:p.status,collection:p.collection,active_version_id:p.active_version_id,
      has_pdf:v.has_pdf,pdf_sha256:s.paper.pdf_sha256,digest_status:'ready',parse_status:s.material?.status,title_zh:s.presentation?.title_zh,summary_zh:s.presentation?.summary_zh,
      readable_version_id:v.id};
  });
}
