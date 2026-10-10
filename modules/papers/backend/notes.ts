import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {marked} from 'marked';
import sanitizeHtml from 'sanitize-html';
import {sql,type Db} from '@aihot/backend/db';
import type {Note,NoteAnchor,NoteContext,Paper,PaperDigest,PaperIllustration,PaperMaterial} from '../types.ts';
import {illustrationSignature} from './illustration-plan.ts';

const conflict=(message:string)=>Object.assign(new Error(message),{code:'conflict'});
const base=z.object({title:z.string().trim().min(1).max(200),markdown:z.string().trim().min(1).max(50000),page:z.number().int().min(1).max(10000).nullable().default(null)});
const target=z.object({kind:z.enum(['paper','claim','figure']),targetId:z.string().min(1).max(200).optional()}).refine(t=>t.kind==='paper'||!!t.targetId,'批注需要对应段落或图表');
const createInput=base.extend({id:z.uuid().optional(),versionId:z.uuid().optional(),readingSignature:z.string().regex(/^[a-f0-9]{64}$/).optional(),target:target.optional()});
const editInput=base.extend({revision:z.number().int().positive()});

export function renderNote(note:Omit<Note,'html'>):Note{
  return {...note,html:sanitizeHtml(marked.parse(note.markdown,{async:false}),{
    allowedTags:sanitizeHtml.defaults.allowedTags.concat(['h1','h2']),allowedAttributes:{a:['href','title'],code:['class']},
    allowedSchemes:['https','http','mailto'],allowProtocolRelative:false,disallowedTagsMode:'discard',exclusiveFilter:frame=>frame.tag==='img',
  })};
}
export function noteContext(versionId:string|undefined|null,digest:PaperDigest|null,illustrations:PaperIllustration[]):NoteContext|null{
  if(!versionId||digest?.status!=='ready')return null;
  return {versionId,receiptId:digest.receipt_id,readingSignature:createHash('sha256').update(JSON.stringify([digest.receipt_id,digest.sections,
    illustrations.map(i=>[i.block_id,i.title,i.explanation,i.evidence_block_ids,i.image_sha256])])).digest('hex')};
}
export async function notesForVersion(paper:Paper,versionId:string|undefined|null,db:Db=sql):Promise<Note[]>{
  const rows=await db<Omit<Note,'html'>[]>`SELECT * FROM paper_notes WHERE paper_id=${paper.id} AND
    ((anchor IS NOT NULL AND anchor->>'versionId'=${versionId??null}) OR (anchor IS NULL AND
      (pdf_sha256=${paper.pdf_sha256} OR (pdf_sha256 IS NULL AND ${paper.pdf_sha256}::text IS NULL AND version=${paper.version})))) ORDER BY updated_at DESC,id`;
  return rows.map(renderNote);
}
export async function noteById(paperId:string,id:string,db:Db=sql){
  const [note]=await db<Omit<Note,'html'>[]>`SELECT * FROM paper_notes WHERE id=${id} AND paper_id=${paperId}`;
  return note?renderNote(note):null;
}
async function noteSource(paper:Paper,versionId:string,db:Db){
  let p=paper,digest:PaperDigest|null,blocks:PaperMaterial['blocks']=[],illustrations:PaperIllustration[]=[];
  if(versionId!==paper.active_version_id){
    const [v]=await db`SELECT snapshot FROM paper_versions WHERE id=${versionId} AND paper_id=${paper.id}`;
    if(!v)throw conflict('所选原文版本不存在，请刷新页面');
    p={...paper,...v.snapshot.paper,id:paper.id};digest=v.snapshot.digest;blocks=v.snapshot.material?.blocks??[];
    const i=v.snapshot.illustrations,m=v.snapshot.material;
    if(i&&m&&digest&&i.input_signature===illustrationSignature(p,m,digest))illustrations=i.selections;
  }else{
    const [d]=await db<PaperDigest[]>`SELECT * FROM paper_digests WHERE paper_id=${paper.id}`;digest=d??null;
    const [m]=await db<PaperMaterial[]>`SELECT * FROM paper_materials WHERE paper_id=${paper.id}`;blocks=m?.blocks??[];
    const [i]=await db`SELECT * FROM paper_illustrations WHERE paper_id=${paper.id}`;
    if(i&&m&&digest&&i.input_signature===illustrationSignature(p,m,digest))illustrations=i.selections;
  }
  return {paper:p,digest,blocks,illustrations,context:noteContext(versionId,digest,illustrations)};
}
export async function addNote(paperId:string,input:unknown):Promise<Note|null>{
  const b=createInput.parse(input);
  if(b.target&&(!b.id||!b.versionId||!b.readingSignature))throw conflict('解读笔记缺少原文及解读版本，请刷新页面');
  return sql.begin(async db=>{
    const [p]=await db<Paper[]>`SELECT * FROM papers WHERE id=${paperId} FOR UPDATE`;if(!p)return null;
    if(b.id){
      const existing=await noteById(paperId,b.id,db);
      if(existing){
        if(b.target&&(existing.anchor?.versionId!==b.versionId||existing.anchor?.readingSignature!==b.readingSignature||existing.anchor?.kind!==b.target.kind||existing.anchor?.targetId!==b.target.targetId))throw conflict('笔记编号已绑定另一处内容');
        return existing;
      }
      if((await db`SELECT id FROM paper_notes WHERE id=${b.id}`).length)throw conflict('笔记编号已被其他论文使用');
    }
    let anchor:NoteAnchor|null=null,page=b.page,paper=p;
    if(b.target){
      const source=await noteSource(p,b.versionId!,db);paper=source.paper;
      if(!source.context||source.context.readingSignature!==b.readingSignature)throw conflict('解读已更新，尚未创建笔记；草稿保留，请刷新后核对关联段落');
      anchor={...source.context,kind:b.target.kind,label:'整篇阅读笔记',excerpt:'',evidenceBlockIds:[]};
      if(b.target.kind==='claim'){
        const section=source.digest!.sections.find(s=>s.claims.some(c=>c.id===b.target!.targetId)),claim=section?.claims.find(c=>c.id===b.target!.targetId);
        if(!claim)throw conflict('关联解读段落不存在，请刷新页面');
        anchor={...anchor,targetId:claim.id,sectionId:section!.id,label:section!.title,excerpt:claim.text,evidenceBlockIds:claim.evidence_block_ids};
      }else if(b.target.kind==='figure'){
        const figure=source.illustrations.find(i=>i.block_id===b.target!.targetId);if(!figure)throw conflict('关联图表不存在，请刷新页面');
        anchor={...anchor,targetId:figure.block_id,label:figure.title,excerpt:figure.explanation,evidenceBlockIds:figure.evidence_block_ids??[figure.block_id],imageSha256:figure.image_sha256};
      }
      page=source.blocks.find(block=>anchor!.evidenceBlockIds.includes(block.id)&&block.page)?.page??null;
    }
    const [note]=await db<Omit<Note,'html'>[]>`INSERT INTO paper_notes(id,paper_id,title,markdown,page,version,pdf_sha256,anchor)
      VALUES(${b.id??randomUUID()},${paperId},${b.title},${b.markdown},${page},${paper.version},${paper.pdf_sha256},${anchor?db.json(anchor as never):null}) RETURNING *`;
    return renderNote(note!);
  });
}
export async function editNote(paperId:string,noteId:string,input:unknown):Promise<Note|null>{
  const b=editInput.parse(input);
  const [note]=await sql<Omit<Note,'html'>[]>`UPDATE paper_notes SET title=${b.title},markdown=${b.markdown},
    page=CASE WHEN anchor IS NULL THEN ${b.page} ELSE page END,revision=revision+1,updated_at=now()
    WHERE id=${noteId} AND paper_id=${paperId} AND revision=${b.revision} RETURNING *`;
  if(note)return renderNote(note);
  if(await noteById(paperId,noteId))throw conflict('笔记已在另一个页面更新，当前草稿保留，请对照服务器版本再保存');
  return null;
}
