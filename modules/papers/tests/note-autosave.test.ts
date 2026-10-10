import test from 'node:test';
import assert from 'node:assert/strict';
import {NoteAutosave,NoteSaveError,type NoteDraft} from '../web/note-autosave.ts';
import type {Note,NoteAnchor} from '../types.ts';
const anchor:NoteAnchor={kind:'claim',versionId:'version',readingSignature:'signature',receiptId:1,targetId:'c1',label:'方法',excerpt:'原句',evidenceBlockIds:['b1']};
const tick=(n=20)=>new Promise(resolve=>setTimeout(resolve,n));
function saved(d:NoteDraft,revision=1):Note{return {id:d.id,paper_id:'paper',title:d.title.trim(),markdown:d.markdown.trim(),html:'',page:1,version:'v1',pdf_sha256:'pdf',anchor:d.anchor,revision,updated_at:new Date().toISOString()};}
test('停顿后合并输入，保存中继续输入不被旧回答覆盖，串行使用最新修订号',async()=>{
  const calls:NoteDraft[]=[];let release:(value:Note)=>void=()=>{};
  const c=new NoteAutosave({notes:[],changed:()=>{},delay:5,get:async()=>{throw Error();},save:d=>{calls.push(d);return new Promise(resolve=>{release=resolve;});}});
  c.create(anchor,'id');c.update('id','markdown','第一');c.update('id','markdown','第一次想法');await tick();assert.equal(calls.length,1);
  c.update('id','markdown','保存期间的新想法');release(saved(calls[0]));await tick();assert.equal(calls.length,2);assert.equal(calls[1].note!.revision,1);assert.equal(c.drafts.get('id')!.markdown,'保存期间的新想法');
  release(saved(calls[1],2));await tick();assert.equal(c.drafts.get('id')!.status,'clean');
  c.merge([saved(calls[0],1)]);assert.equal(c.drafts.get('id')!.note!.revision,2);assert.equal(c.drafts.get('id')!.markdown,'保存期间的新想法');c.dispose();
});
test('保存结果未知保留稳定ID与本地草稿；刷新恢复，已落库内容不重复保存',async()=>{
  let cache='',persisted:Note|null=null,calls=0;
  const storage={read:()=>cache,write:(s:string)=>{cache=s;}};
  const c=new NoteAutosave({notes:[],changed:()=>{},storage,delay:5,get:async()=>persisted!,save:async d=>{calls++;persisted=saved(d);throw new NoteSaveError('连接中断');}});
  c.create(anchor,'same-id');c.update('same-id','markdown','断线前的想法');await tick();assert.equal(c.drafts.get('same-id')!.status,'error');assert.match(cache,/断线前/);c.dispose();
  const restored=new NoteAutosave({notes:[persisted!],changed:()=>{},storage,delay:5,get:async()=>persisted!,save:async d=>{calls++;return saved(d);}});restored.restore();await tick();assert.equal(calls,1);assert.equal(restored.hasUnsaved(),false);restored.dispose();
});
test('409保留本地输入，不自动覆盖服务器，显式比较后保存仍走修订号检查',async()=>{
  const initial=saved({id:'id',title:'笔记',markdown:'旧',anchor} as NoteDraft),remote={...initial,markdown:'其他页面的新内容',revision:2};let calls=0;
  const c=new NoteAutosave({notes:[initial],changed:()=>{},delay:5,get:async()=>remote,save:async d=>{calls++;if(d.note!.revision!==2)throw new NoteSaveError('冲突',409);return saved(d,3);}});
  c.update('id','markdown','我的草稿');await tick();assert.equal(c.drafts.get('id')!.status,'conflict');assert.equal(calls,1);c.update('id','markdown','继续写我的草稿');await tick();assert.equal(calls,1);
  await c.loadRemote('id');assert.equal(c.drafts.get('id')!.remote!.markdown,remote.markdown);assert.equal(c.drafts.get('id')!.markdown,'继续写我的草稿');c.keepDraft('id');await tick();assert.equal(c.drafts.get('id')!.note!.revision,3);assert.equal(c.drafts.get('id')!.status,'clean');c.dispose();
});
test('关闭面板可刷出待保存内容，尚未落库的旧解读草稿可保留原句另存整篇笔记',async()=>{
  let calls=0;const c=new NoteAutosave({notes:[],changed:()=>{},delay:1000,get:async()=>{throw Error();},save:async d=>{calls++;return saved(d);}});
  c.create(anchor,'old');c.update('old','markdown','自己的疑问');c.reframe('old',{...anchor,kind:'paper',targetId:undefined,readingSignature:'new'},'new');await tick();assert.equal(calls,1);assert.match(c.drafts.get('new')!.markdown,/原句/);assert.match(c.drafts.get('new')!.markdown,/自己的疑问/);c.dispose();
});
