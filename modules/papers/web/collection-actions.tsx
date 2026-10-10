import {useState} from 'react';
import {useLocation,useNavigate,useRevalidator} from 'react-router';
import {useWrite} from './shared.tsx';
import {DIRECTIONS} from '../directions.ts';
import type {Paper} from '../types.ts';

export function CollectionActions({paper,csrf,edit=false,allowRead=true}:{paper:Paper;csrf:string;edit?:boolean;allowRead?:boolean}){
  const {write,busy,error}=useWrite(csrf),revalidator=useRevalidator(),navigate=useNavigate(),location=useLocation();
  const [message,setMessage]=useState('');const collection=paper.collection;
  const processing=['queued','running','waiting'].includes(paper.reading_status??'');
  async function save(read=false){
    const result=await write<Paper>(`/api/admin/papers/${paper.id}/collection`,'POST',{read,versionId:read?paper.active_version_id??undefined:undefined});
    if(result){setMessage(read?'已加入阅读流程':'已加入我的论文');if(read)navigate(`/papers/${paper.id}`,{state:{paperReturn:location.pathname+location.search}});else revalidator.revalidate();}
  }
  return <div className="pp-collection-actions">
    {!collection&&<button className="pp-button secondary" disabled={busy} onClick={()=>save()}>加入我的论文</button>}
    {allowRead&&paper.digest_status!=='ready'&&<button className="pp-button secondary" disabled={busy||processing} onClick={()=>save(true)}>{processing?'精读任务已存在':collection?'开始精读':'加入并精读'}</button>}
    {collection&&<span className="pp-muted">已收录{collection.pinned?' · 已置顶':''}</span>}
    {collection&&edit&&<details><summary>管理收录</summary><form key={JSON.stringify(collection)} className="pp-form" onSubmit={async e=>{
      e.preventDefault();const data=new FormData(e.currentTarget);
      if(await write(`/api/admin/papers/${paper.id}/collection`,'POST',{tags:String(data.get('tags')??'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),
        reason:String(data.get('reason')??''),directions:data.getAll('directions'),pinned:data.get('pinned')==='on'})){setMessage('收录信息已保存');revalidator.revalidate();}
    }}>
      <label>个人标签（逗号分隔）<input name="tags" defaultValue={collection.tags.join('，')} maxLength={500}/></label>
      <label>想读原因<textarea name="reason" defaultValue={collection.reason} maxLength={1000} rows={2}/></label>
      <fieldset><legend>研究方向</legend>{DIRECTIONS.map(d=><label key={d.id}><input type="checkbox" name="directions" value={d.id} defaultChecked={collection.directions.includes(d.id)}/>{d.title}</label>)}</fieldset>
      <label><input name="pinned" type="checkbox" defaultChecked={collection.pinned}/>置顶</label>
      <button className="pp-button secondary" disabled={busy}>保存收录信息</button>
      <button type="button" className="pp-text-button" disabled={busy} onClick={async()=>{if(await write(`/api/admin/papers/${paper.id}/collection`,'DELETE',{})){setMessage('已从我的论文移除，原文和解读保留');revalidator.revalidate();}}}>从我的论文移除</button>
    </form></details>}
    {message&&<p role="status" className="pp-muted">{message}</p>}{error&&<p role="alert" className="pp-error">{error}</p>}
  </div>;
}
