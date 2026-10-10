import {forwardRef,useEffect,useImperativeHandle,useMemo,useReducer,useRef,useState} from 'react';
import type {Note,NoteAnchor,NoteContext,Paper,PaperDigest,PaperBlock,PaperIllustration} from '../types.ts';
import {noteAnchorMatches,noteOrigin} from '../notes.ts';
import {NoteAutosave,NoteSaveError,type NoteDraft} from './note-autosave.ts';

export type NoteTarget={kind:'paper'|'claim'|'figure';targetId?:string};
export interface ReadingNotesHandle {open:(target:NoteTarget)=>void;flush:()=>void}
function anchorFor(context:NoteContext,target:NoteTarget,digest:PaperDigest|null,figures:PaperIllustration[]):NoteAnchor{
  const anchor:NoteAnchor={...context,kind:target.kind,label:'整篇阅读笔记',excerpt:'',evidenceBlockIds:[]};
  if(target.kind==='claim'){
    const section=digest?.sections.find(s=>s.claims.some(c=>c.id===target.targetId)),claim=section?.claims.find(c=>c.id===target.targetId);
    if(!claim)throw new Error('关联解读段落不存在');return {...anchor,targetId:claim.id,sectionId:section!.id,label:section!.title,excerpt:claim.text,evidenceBlockIds:claim.evidence_block_ids};
  }
  if(target.kind==='figure'){
    const figure=figures.find(f=>f.block_id===target.targetId);if(!figure)throw new Error('关联图表不存在');
    return {...anchor,targetId:figure.block_id,label:figure.title,excerpt:figure.explanation,evidenceBlockIds:figure.evidence_block_ids??[figure.block_id],imageSha256:figure.image_sha256};
  }
  return anchor;
}
export const ReadingNotes=forwardRef<ReadingNotesHandle,{paper:Paper;viewingVersionId?:string|null;notes:Note[];context:NoteContext|null|undefined;digest:PaperDigest|null;blocks:PaperBlock[];figures:PaperIllustration[];csrf:string;adminName:string;open:boolean;onOpen:()=>void;onClose:()=>void;onEvidence:(block:PaperBlock)=>void}>(function ReadingNotes({paper,viewingVersionId,notes,context,digest,blocks,figures,csrf,adminName,open,onOpen,onClose,onEvidence},ref){
  const [,refresh]=useReducer(n=>n+1,0),[selected,setSelected]=useState<string|null>(null),[filter,setFilter]=useState<'all'|'annotations'>('all'),[preview,setPreview]=useState(false),[mobile,setMobile]=useState(false);
  const pane=useRef<HTMLElement>(null),editor=useRef<HTMLTextAreaElement>(null),csrfRef=useRef(csrf);csrfRef.current=csrf;
  const key='paperpulse:note-drafts:'+encodeURIComponent(adminName)+':'+paper.id+':'+(context?.versionId??viewingVersionId??paper.active_version_id??paper.version);
  const controller=useMemo(()=>{
    async function request<T>(path:string,method='GET',body?:unknown):Promise<T>{
      let response:Response;try{response=await fetch(path,{method,headers:{'content-type':'application/json','x-csrf-token':csrfRef.current},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new NoteSaveError('连接中断，尚未确认保存结果。草稿保留，请重试。');}
      let json;try{json=await response.json();}catch{throw new NoteSaveError('服务器暂未返回保存结果，草稿保留，请重试。',response.status);}
      if(!response.ok)throw new NoteSaveError(json.detail??'笔记保存失败，草稿保留。',response.status);return json;
    }
    return new NoteAutosave({notes,changed:refresh,storage:{read:()=>sessionStorage.getItem(key),write:value=>sessionStorage.setItem(key,value)},
      save:draft=>request<Note>(`/api/admin/papers/${paper.id}/notes`+(draft.note?'/'+draft.id:''),draft.note?'PATCH':'POST',{
        title:draft.title,markdown:draft.markdown,page:draft.note?.page??null,
        ...(draft.note?{revision:draft.note.revision}:{id:draft.id,versionId:draft.anchor?.versionId,readingSignature:draft.anchor?.readingSignature,target:{kind:draft.anchor?.kind,targetId:draft.anchor?.targetId}})}),
      get:id=>request<Note>(`/api/admin/papers/${paper.id}/notes/${id}`)});
  },[key]);
  useEffect(()=>{controller.restore();const beforeUnload=(event:BeforeUnloadEvent)=>{if(controller.hasUnsaved()){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',beforeUnload);return ()=>{window.removeEventListener('beforeunload',beforeUnload);controller.dispose();};},[controller]);
  useEffect(()=>controller.merge(notes),[notes,controller]);
  useEffect(()=>{const query=window.matchMedia('(max-width:1100px)');const update=()=>setMobile(query.matches);update();query.addEventListener('change',update);return ()=>query.removeEventListener('change',update);},[]);
  useEffect(()=>{
    if(!open||!mobile)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{document.body.style.overflow=old;};
  },[open,mobile]);
  useEffect(()=>{if(open)editor.current?.focus();},[selected,open]);
  function begin(target:NoteTarget){
    setPreview(false);
    if(context){setSelected(controller.create(anchorFor(context,target,digest,figures),crypto.randomUUID()));setFilter('all');}
    else setSelected([...controller.drafts.keys()][0]??null);
    onOpen();
  }
  useImperativeHandle(ref,()=>({open:begin,flush:()=>controller.flush()}));
  const draft=selected?controller.drafts.get(selected):null;
  const entries=[...controller.drafts.values()].filter(d=>!!d.note||!!d.markdown.trim());
  const matching=draft?noteAnchorMatches(draft.anchor,digest,figures):false;
  function close(){controller.flush();onClose();}
  function jump(){if(!draft?.anchor||!matching)return;const a=draft.anchor;const id=a.kind==='claim'?'claim-'+a.targetId:a.kind==='figure'?'figure-'+a.targetId:null;
    if(mobile)close();if(id)window.setTimeout(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'center'}),0);}
  function keys(event:React.KeyboardEvent<HTMLElement>){
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key!=='Tab'||!mobile)return;const controls=[...pane.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,a[href]')].filter(e=>e.offsetParent!==null);
    const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  const status=draft?.status==='saving'?'保存中…':draft?.status==='clean'?(draft.note?'已保存':'输入后自动保存'):draft?.status==='dirty'?'草稿待保存':draft?.status==='conflict'?'保存冲突 · 草稿保留':'保存失败 · 草稿保留';
  return <>
    {open&&mobile&&<button className="pp-notes-backdrop" aria-label="关闭我的笔记" onClick={close}/>}
    <aside ref={pane} className="pp-reading-notes pp-panel" hidden={!open} aria-label="我的阅读笔记" role={mobile?'dialog':'complementary'} aria-modal={mobile&&open?true:undefined} onKeyDown={keys}>
      <div className="pp-notes-heading"><h2>我的笔记</h2><button type="button" className="pp-text-button" onClick={close}>{mobile?'返回阅读':'收起'}</button></div>
      <div className="pp-notes-actions"><button type="button" className="pp-text-button" disabled={!context} onClick={()=>begin({kind:'paper'})}>整篇笔记</button><span className="pp-muted">{entries.length} 条</span></div>
      {!!entries.length&&<details className="pp-notes-list" open={!draft}><summary>已有笔记</summary><div className="pp-notes-filters"><button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>全部</button><button type="button" aria-pressed={filter==='annotations'} onClick={()=>setFilter('annotations')}>段落与图表</button></div>
        {entries.filter(d=>filter==='all'||['claim','figure'].includes(d.anchor?.kind??'')).map(d=><button type="button" className="pp-note-entry" aria-pressed={selected===d.id} key={d.id} onClick={()=>{controller.flush();setSelected(d.id);setPreview(false);}}><strong>{d.title}</strong><span>{noteOrigin({anchor:d.anchor,page:d.note?.page??null})}{d.status!=='clean'?' · 有草稿':''}</span></button>)}
      </details>}
      {draft?<>
        <div className="pp-note-anchor"><p>{noteOrigin({anchor:draft.anchor,page:draft.note?.page??null})} · {draft.note?.version||paper.version}</p>
          {!!draft.anchor?.excerpt&&<details><summary>关联时的解读文字</summary><blockquote>{draft.anchor.excerpt}</blockquote></details>}
          {!matching&&<p className="pp-muted">解读已更新，保留原批注文字；请对照原文核查。</p>}
          {matching&&draft.anchor?.targetId&&<button type="button" className="pp-text-button" onClick={jump}>定位解读 ↗</button>}
          {draft.anchor?.evidenceBlockIds.some(id=>blocks.find(b=>b.id===id)?.page)&&<button type="button" className="pp-text-button" onClick={()=>{const block=blocks.find(b=>draft.anchor!.evidenceBlockIds.includes(b.id)&&b.page);if(block){close();onEvidence(block);}}}>查看关联原文 ↗</button>}
        </div>
        <label className="pp-note-field">笔记标题<input value={draft.title} maxLength={200} onChange={e=>controller.update(draft.id,'title',e.target.value)}/></label>
        <label className="pp-note-field">我的理解与疑问<textarea ref={editor} aria-label="笔记内容" rows={9} maxLength={50000} value={draft.markdown} placeholder="写下你的理解、疑问或可借鉴的思路。支持 Markdown。" onChange={e=>controller.update(draft.id,'markdown',e.target.value)} onBlur={()=>void controller.save(draft.id)}/></label>
        <p className="pp-muted" role="status">{status}{draft.status==='clean'&&draft.note?' · '+new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}).format(new Date(draft.note.updated_at)):''}</p>
        {draft.error&&<p className="pp-error" role="alert">{draft.error}</p>}
        {draft.status==='error'&&<button type="button" className="pp-text-button" onClick={()=>void controller.save(draft.id,true)}>重试保存</button>}
        {draft.status==='conflict'&&(draft.note?<>
          <button type="button" className="pp-text-button" onClick={()=>void controller.loadRemote(draft.id)}>查看服务器版本</button>
          {draft.remote&&<div className="pp-note-conflict"><strong>{draft.remote.title}</strong><pre>{draft.remote.markdown}</pre><button type="button" className="pp-text-button" onClick={()=>controller.acceptRemote(draft.id)}>采用服务器版本</button><button type="button" className="pp-text-button" onClick={()=>controller.keepDraft(draft.id)}>保留我的草稿并保存</button></div>}
        </>:context&&<button type="button" className="pp-text-button" onClick={()=>setSelected(controller.reframe(draft.id,anchorFor(context,{kind:'paper'},digest,figures),crypto.randomUUID()))}>保留关联原句，另存为整篇笔记</button>)}
        {draft.note&&<><button type="button" className="pp-text-button" onClick={()=>setPreview(!preview)}>{preview?'收起预览':'查看已保存的 Markdown 预览'}</button>{preview&&<div className="pp-markdown pp-note-preview" dangerouslySetInnerHTML={{__html:draft.note.html}}/>}</>}
      </>:<p className="pp-muted">点击整篇笔记，或在解读段落、图表旁“记一笔”。</p>}
      {controller.cacheWarning&&<p className="pp-error">{controller.cacheWarning}</p>}
      <p className="pp-muted">未保存的草稿暂存在此浏览器标签页，刷新后可恢复；关闭标签页前请确认“已保存”。</p>
    </aside>
  </>;
});
