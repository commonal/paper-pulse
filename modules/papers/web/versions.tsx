import {useRef,useState} from 'react';
import {Link,useLocation,useNavigate,useRevalidator} from 'react-router';
import type {Paper} from '../types.ts';
import type {PaperVersion} from '../versions.ts';
import type {IdentityPreview} from '../identity.ts';
import {useWrite} from './shared.tsx';

export function VersionManager({paper,versions,viewing,current,csrf}:{paper:Paper;versions:PaperVersion[];viewing?:string|null;current:boolean;csrf:string}){
  const {write,busy,error,setError}=useWrite(csrf),navigate=useNavigate(),location=useLocation(),revalidator=useRevalidator();
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<IdentityPreview|null>(null),[loading,setLoading]=useState(false);
  const [label,setLabel]=useState(''),[kind,setKind]=useState('uploaded'),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState('');
  const [sourceUrl,setSourceUrl]=useState('');
  const [identityKey,setIdentityKey]=useState('');const fileInput=useRef<HTMLInputElement>(null);
  const showing=versions.find(v=>v.id===viewing),selected=versions.find(v=>v.is_current);
  async function bytes(){
    if(!file)throw new Error('请选择 PDF');if(file.size>20*1024*1024)throw new Error('PDF 文件不能超过20 MB');
    return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('无法读取文件'));reader.readAsDataURL(file);});
  }
  async function identify(){setLoading(true);try{const result=await write<IdentityPreview>('/api/admin/papers/import-preview','POST',{pdfBase64:await bytes()});if(result){setPreview(result);setIdentityKey(result.result.selected_key);setConfirmed(false);}}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  const wait=preview&&['queued','running','waiting'].includes(preview.state);
  const candidate=preview?.result.candidates.find(c=>c.key===identityKey);
  return <section className="pp-panel pp-version-panel" aria-label="原文版本管理">
    <div><strong>原文与解读版本</strong><span className="pp-muted"> · 查看：{showing?.label||paper.version}{!current?'（历史版本，可记笔记）':'（当前阅读版本）'}</span></div>
    {!current&&<p className="pp-muted">当前处理的是“{selected?.label||'另一原文'}”。这里的解读、图表、引用和 PDF 都来自所选历史版本。</p>}
    <div className="pp-version-list">{versions.map(v=><div key={v.id} className="pp-version-row">
      <Link to={`/papers/${paper.id}?version=${v.id}`} state={location.state}>{v.label}</Link><span className="pp-muted">{v.kind==='preprint'?'预印本':v.kind==='published'?'发表版':'上传原文'} · {v.has_pdf?'PDF 已保存':'待获取全文'} · {v.has_reading?'已有解读':'尚未精读'}{v.is_current?' · 当前':''}</span>
      {!v.is_current&&<><button type="button" className="pp-text-button" disabled={busy} onClick={async()=>{if(await write(`/api/admin/papers/${paper.id}/versions/${v.id}/select`,'POST',{expectedVersionId:paper.active_version_id})){setMessage('已切换原文，旧版本与解读保留');navigate(`/papers/${paper.id}`,{state:location.state});revalidator.revalidate();}}}>设为当前</button>
      <button type="button" className="pp-text-button" disabled={busy} onClick={async()=>{if(await write(`/api/admin/papers/${paper.id}/versions/${v.id}/select`,'POST',{expectedVersionId:paper.active_version_id,read:true})){navigate(`/papers/${paper.id}`,{state:location.state});revalidator.revalidate();}}}>{v.has_reading?'切换并阅读':'切换并精读'}</button></>}
    </div>)}</div>
    <details><summary>添加另一份原文</summary><p className="pp-muted">先保存为另一版本，当前原文与文章保持；切换和精读分别选择。同一 PDF 不重复添加。</p>
      <label>版本名称<input value={label} onChange={e=>setLabel(e.target.value)} maxLength={100} placeholder="例如 arXiv v1、正式发表版"/></label>
      <label>原文类型<select value={kind} onChange={e=>setKind(e.target.value)}><option value="uploaded">上传原文（版本未核验）</option><option value="preprint">预印本</option><option value="published">发表版（本人确认）</option></select></label>
      <label>这份原文的来源（可选）<input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} type="url" maxLength={2000} placeholder="对应版本的 arXiv 或出版页面"/></label>
      <label>另一版本 PDF<input ref={fileInput} type="file" accept="application/pdf,.pdf" disabled={busy||loading} onChange={e=>{const next=e.target.files?.[0]??null;setFile(next);setPreview(null);setIdentityKey('');setConfirmed(false);}}/></label>
      <button type="button" className="pp-button secondary" disabled={!file||busy||loading} onClick={identify}>{loading?'识别中…':'核对这份原文'}</button>
      {preview&&<p className="pp-muted">{wait?'扫描识别仍在后台处理；可稍后重新核对。':candidate?.title||'未能确认身份，请核对原文'}{preview.error?' · '+preview.error:''}</p>}
      {preview?.state==='ready'&&<>
        {preview.result.candidates.length>1&&<label>采用的身份记录<select value={identityKey} onChange={e=>{setIdentityKey(e.target.value);setConfirmed(false);}}>{preview.result.candidates.map(c=><option key={c.key} value={c.key}>{c.source_kind==='arxiv'?'arXiv':c.doi?'DOI':'本地 PDF'} · {c.title||'身份未确认'} · {c.version}</option>)}</select></label>}
        {candidate?.checks.map((check,i)=><p className="pp-muted" key={i}>{check}</p>)}
        {preview.result.warnings.map((warning,i)=><p className="pp-muted" key={i}>{warning}</p>)}
      </>}
      <label className="pp-version-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我确认这份 PDF 属于同一篇论文；原文类型和版本名称由我核对</label>
      <button type="button" className="pp-button secondary" disabled={!file||!label.trim()||!confirmed||busy||loading||!!wait} onClick={async()=>{
        try{const result=await write<{versionId:string;added:boolean}>(`/api/admin/papers/${paper.id}/versions`,'POST',{label:label.trim(),kind,sourceUrl,confirmSamePaper:true,pdfBase64:await bytes(),
          ...(preview?.state==='ready'?{previewId:preview.id,identityKey}:{})});
          if(result){setMessage(result.added?'新原文已保存，当前版本和解读保留':'这份 PDF 已存在，已复用原版本');setFile(null);if(fileInput.current)fileInput.current.value='';setPreview(null);setIdentityKey('');setConfirmed(false);revalidator.revalidate();}
        }catch(e){setError((e as Error).message);}
      }}>仅保存新版本</button>
    </details>
    {message&&<p role="status" className="pp-muted">{message}</p>}{error&&<p role="alert" className="pp-error">{error}</p>}
  </section>;
}
