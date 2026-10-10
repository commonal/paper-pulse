import type {Note,NoteAnchor} from '../types.ts';

export interface NoteDraft {id:string;title:string;markdown:string;note:Note|null;anchor:NoteAnchor|null;status:'clean'|'dirty'|'saving'|'error'|'conflict';error:string;remote?:Note}
type Storage={read:()=>string|null;write:(value:string)=>void};
export class NoteSaveError extends Error {status:number;constructor(message:string,status=0){super(message);this.status=status;}}
const equal=(draft:Pick<NoteDraft,'title'|'markdown'>,note:Pick<Note,'title'|'markdown'>)=>draft.title.trim()===note.title&&draft.markdown.trim()===note.markdown;
const fromNote=(note:Note):NoteDraft=>({id:note.id,title:note.title,markdown:note.markdown,note,anchor:note.anchor??null,status:'clean',error:''});

// One in-flight write per draft; late replies advance its revision without replacing newer typing.
export class NoteAutosave {
  drafts=new Map<string,NoteDraft>();cacheWarning='';
  #timers=new Map<string,ReturnType<typeof setTimeout>>();#running=new Set<string>();#disposed=false;
  #save:(draft:NoteDraft)=>Promise<Note>;#get:(id:string)=>Promise<Note>;#changed:()=>void;#storage?:Storage;
  #delay:number;
  constructor({notes,save,get,changed,storage,delay=900}:{notes:Note[];save:(draft:NoteDraft)=>Promise<Note>;get:(id:string)=>Promise<Note>;changed:()=>void;storage?:Storage;delay?:number}){
    this.#save=save;this.#get=get;this.#changed=changed;this.#storage=storage;this.#delay=delay;
    for(const note of notes)this.drafts.set(note.id,fromNote(note));
  }
  restore(){
    this.#disposed=false;
    try{const entries=JSON.parse(this.#storage?.read()??'[]');if(!Array.isArray(entries))return;
      for(const value of entries){
        if(typeof value?.id!=='string'||typeof value.title!=='string'||typeof value.markdown!=='string'||value.title.length>200||value.markdown.length>50000)continue;
        const server=this.drafts.get(value.id)?.note;
        if(server&&equal(value,server))continue;
        const base=value.note&&typeof value.note.revision==='number'?value.note:null;
        const note=server&&base&&equal(base,server)?server:base;
        const draft:NoteDraft={id:value.id,title:value.title,markdown:value.markdown,note,anchor:value.anchor??null,status:value.status==='conflict'?'conflict':'dirty',error:value.status==='conflict'?'保留的草稿与服务器版本冲突，请先核对':''};
        this.drafts.set(draft.id,draft);if(draft.status==='dirty')this.#schedule(draft.id);
      }
    }catch{this.cacheWarning='本地草稿恢复不可用，请确认服务器已保存的内容。';}
    this.#notify();
  }
  merge(notes:Note[]){
    for(const note of notes){const draft=this.drafts.get(note.id);if(!draft||(draft.status==='clean'&&(!draft.note||note.revision>draft.note.revision)))this.drafts.set(note.id,fromNote(note));}
    this.#notify();
  }
  create(anchor:NoteAnchor,id:string){
    const match=[...this.drafts.values()].find(d=>d.anchor?.kind===anchor.kind&&d.anchor?.targetId===anchor.targetId&&(anchor.kind==='paper'?d.anchor.versionId===anchor.versionId:d.anchor.readingSignature===anchor.readingSignature));
    if(match)return match.id;
    this.drafts.set(id,{id,title:anchor.kind==='paper'?'阅读笔记':anchor.label+' · 批注',markdown:'',note:null,anchor,status:'clean',error:''});this.#notify();return id;
  }
  update(id:string,field:'title'|'markdown',text:string){
    const draft=this.drafts.get(id);if(!draft)return;draft[field]=text;
    if(draft.status!=='conflict'){draft.status=this.#running.has(id)?'saving':draft.note&&equal(draft,draft.note)?'clean':'dirty';draft.error='';if(draft.status==='dirty')this.#schedule(id);}
    this.#notify();
  }
  #schedule(id:string){
    if(this.#disposed)return;const old=this.#timers.get(id);if(old)clearTimeout(old);
    this.#timers.set(id,setTimeout(()=>{this.#timers.delete(id);void this.save(id);},this.#delay));
  }
  async save(id:string,retry=false){
    const draft=this.drafts.get(id),timer=this.#timers.get(id);if(timer)clearTimeout(timer);this.#timers.delete(id);
    if(!draft||this.#running.has(id)||draft.status==='clean'||draft.status==='conflict'||(draft.status==='error'&&!retry))return;
    if(!draft.title.trim()||!draft.markdown.trim()){draft.status=draft.note?'error':'dirty';draft.error=draft.note?'标题与内容不能为空；原笔记仍保留。':'';this.#notify();return;}
    const submitted={...draft,note:draft.note?{...draft.note}:null};this.#running.add(id);draft.status='saving';draft.error='';this.#notify();
    try{const saved=await this.#save(submitted);draft.note=saved;draft.anchor=saved.anchor??null;draft.status=equal(draft,saved)?'clean':'dirty';}
    catch(error){draft.status=error instanceof NoteSaveError&&error.status===409?'conflict':'error';draft.error=(error as Error).message||'保存失败，草稿保留。';}
    finally{this.#running.delete(id);this.#notify();if(draft.status==='dirty')this.#schedule(id);}
  }
  async loadRemote(id:string){const d=this.drafts.get(id);if(!d)return;try{d.remote=await this.#get(id);}catch(error){d.error=(error as Error).message;}this.#notify();}
  acceptRemote(id:string){const d=this.drafts.get(id);if(!d?.remote)return;this.drafts.set(id,fromNote(d.remote));this.#notify();}
  keepDraft(id:string){const d=this.drafts.get(id);if(!d?.remote)return;d.note=d.remote;d.remote=undefined;d.status='dirty';d.error='';this.#notify();void this.save(id);}
  reframe(id:string,anchor:NoteAnchor,newId:string){const d=this.drafts.get(id);if(!d||d.note)return id;
    this.drafts.set(newId,{...d,id:newId,anchor,status:'dirty',error:'',markdown:(d.anchor?.excerpt?'原批注关联（解读已更新）：\n> '+d.anchor.excerpt.replace(/\n/g,'\n> ')+'\n\n':'')+d.markdown});this.drafts.delete(id);this.#notify();void this.save(newId);return newId;}
  hasUnsaved(){return [...this.drafts.values()].some(d=>d.status!=='clean'&&(!!d.note||!!d.markdown.trim()));}
  flush(){for(const d of this.drafts.values())if(d.status==='dirty')void this.save(d.id);}
  dispose(){this.#disposed=true;this.flush();for(const timer of this.#timers.values())clearTimeout(timer);this.#timers.clear();}
  #notify(){
    try{this.#storage?.write(JSON.stringify([...this.drafts.values()].filter(d=>d.status!=='clean'&&(!!d.note||!!d.markdown.trim())).map(({remote,...d})=>d)));}
    catch{this.cacheWarning='本地草稿备份不可用，离开前请确认保存。';}
    if(!this.#disposed)this.#changed();
  }
}
