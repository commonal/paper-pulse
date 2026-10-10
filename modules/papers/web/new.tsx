import {useEffect,useState} from 'react';
import {Link,useLoaderData,useNavigate} from 'react-router';
import {useWrite} from './shared.tsx';
import {identity} from './identity.server.ts';
import type {Paper} from '../types.ts';
import type {IdentityPreview,IdentityCandidate} from '../identity.ts';
import {DIRECTIONS} from '../directions.ts';
export const handle={tab:'reading',name:'导入论文'};
export const meta=()=>[{title:'导入论文 · 研脉'}];
export const headers=()=>({'Cache-Control':'private, no-store'});
export async function loader({request}:{request:Request}){return {me:await identity(request)};}
const filenameTitle=(name:string)=>name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim()||'未命名论文';
async function fileBase64(file:File){
  if(file.size>20*1024*1024)throw new Error('PDF 文件不能超过20 MB');
  return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('无法读取 PDF 文件'));reader.readAsDataURL(file);});
}
export default function NewPaper(){
  const {me}=useLoaderData<typeof loader>(),navigate=useNavigate(),{write,busy,error,setError}=useWrite(me.csrf);
  const [sourceUrl,setSourceUrl]=useState(''),[doi,setDoi]=useState(''),[title,setTitle]=useState(''),[authors,setAuthors]=useState('');
  const [published,setPublished]=useState(''),[abstract,setAbstract]=useState(''),[version,setVersion]=useState('未标注'),[topic,setTopic]=useState('');
  const [pdfUrl,setPdfUrl]=useState(''),[codeUrl,setCodeUrl]=useState(''),[file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState<IdentityPreview|null>(null),[selected,setSelected]=useState(''),[parseBusy,setParseBusy]=useState(false);
  const processing=!!preview&&['queued','running','waiting'].includes(preview.state),disabled=busy||parseBusy||processing;
  function choose(candidate:IdentityCandidate){
    setSelected(candidate.key);setSourceUrl(candidate.source_url);setDoi(candidate.doi);setTitle(previous=>candidate.title||previous||(file?filenameTitle(file.name):''));
    setAuthors(candidate.authors);setPublished(candidate.published?.slice(0,10)||'');setAbstract(candidate.abstract);setVersion(candidate.version);setPdfUrl(candidate.pdf_url);
  }
  function accept(next:IdentityPreview){setPreview(next);const candidate=next.result.candidates.find(c=>c.key===next.result.selected_key);if(candidate)choose(candidate);}
  async function resolve(nextFile:File|null=file,input=sourceUrl||doi){
    setParseBusy(true);setError('');
    try{const next=await write<IdentityPreview>('/api/admin/papers/import-preview','POST',{input,pdfBase64:nextFile?await fileBase64(nextFile):undefined});if(next)accept(next);}
    catch(e){setError((e as Error).message);}finally{setParseBusy(false);}
  }
  useEffect(()=>{
    if(!preview||!['queued','running','waiting'].includes(preview.state))return;
    let active=true;const controller=new AbortController();
    const timer=setInterval(async()=>{if(document.visibilityState!=='visible')return;try{
      const response=await fetch('/api/admin/papers/import-preview/'+preview.id,{signal:controller.signal});if(!response.ok)return;
      const next=await response.json() as IdentityPreview;if(active){setPreview(next);if(next.state==='ready'){const candidate=next.result.candidates.find(c=>c.key===next.result.selected_key);if(candidate)choose(candidate);}}
    }catch{/* Polling never retries an external request. */}},4000);
    return()=>{active=false;controller.abort();clearInterval(timer);};
  },[preview?.id,preview?.state]);
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');const form=new FormData(event.currentTarget),read=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='read';
    if(!sourceUrl.trim()&&!file&&!preview){setError('请提供论文链接、DOI 或 PDF');return;}
    if(processing){setError('OCR 正在处理或等待恢复，请等待识别完成');return;}
    if(!preview&&/^10\.\d{4,9}\//.test(sourceUrl.trim())){setError('请先查询 DOI，再保存论文');return;}
    try{
      const paper=await write<Paper>('/api/admin/papers','POST',{title:title.trim()||(file?filenameTitle(file.name):'未命名论文'),authors,published,topic,abstract,
        sourceUrl:sourceUrl.trim(),doi,pdfUrl,codeUrl,version:version||'未标注',pdfBase64:file?await fileBase64(file):undefined,
        ...(preview?.state==='ready'?{previewId:preview.id,identityKey:selected}:{}),
        collection:{read,reason:String(form.get('reason')??''),tags:String(form.get('tags')??'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),directions:form.getAll('directions')}});
      if(paper)navigate('/papers/'+paper.id,{state:{paperReturn:'/papers/mine'}});
    }catch(e){setError((e as Error).message);}
  }
  const chosen=preview?.result.candidates.find(c=>c.key===selected),noFulltext=!file&&chosen?.source_kind==='crossref';
  const matchLabel={matched:'已对照匹配',candidate:'可能匹配，需核对',record:'登记记录已查询',local:'本地 PDF，身份待核验'};
  const option=(c:IdentityCandidate)=><label className="pp-identity-option" key={c.key}><input type="radio" name="identity" value={c.key} checked={selected===c.key} onChange={()=>choose(c)}/><span><strong>{c.title||'本地 PDF（请补充标题）'}</strong><small>{c.source_kind==='existing'?'同一 PDF 已收录':matchLabel[c.match]} · {c.authors||'作者待补全'}{c.doi?' · DOI '+c.doi:''}</small></span></label>;
  return <div className="pp-page"><Link className="pp-back" to="/papers/mine">← 我的论文</Link>
    <div className="pp-heading"><div><h1>导入论文</h1><p>上传 PDF 自动识别首页线索并对照身份，也可查询 DOI 或 arXiv。确认后选择仅保存或完整精读。</p></div></div>
    <form className="pp-form pp-panel" onSubmit={submit}>
      <label>DOI 或论文链接<div className="pp-inline"><input value={sourceUrl} disabled={disabled} onChange={e=>{setSourceUrl(e.target.value);setPreview(null);setSelected('');}} maxLength={2000} placeholder="10.18653/v1/N19-1423 或 https://arxiv.org/abs/…"/><button type="button" disabled={disabled} className="pp-button secondary" onClick={()=>resolve()}>{parseBusy?'核验中…':'识别与核验'}</button></div></label>
      <p className="pp-muted">DOI 查询使用 Crossref；文字版 PDF 在本地提取首页。扫描版由后台 MinerU OCR，经过现有预算与回执。识别不会开始精读。</p>
      <label>上传 PDF（20 MB 以内）<input name="pdf" type="file" accept="application/pdf,.pdf" disabled={disabled} onChange={e=>{const next=e.target.files?.[0]??null;setFile(next);setPreview(null);setSelected('');if(next){setTitle(filenameTitle(next.name));void resolve(next,sourceUrl);}}}/>{file&&<small>{file.name}</small>}</label>
      {preview&&<section className="pp-preview" aria-label="身份核验结果"><strong>{preview.state==='ready'?'身份预览':preview.state==='waiting'?'OCR 等待恢复':preview.state==='failed'?'OCR 未完成':'后台 OCR 处理中'}</strong>
        {preview.error&&<p className="pp-error" role="alert">{preview.error}</p>}{preview.result.warnings.map((warning,i)=><p className="pp-muted" key={i}>{warning}</p>)}
        {preview.state==='ready'&&chosen&&option(chosen)}
        {preview.state==='ready'&&preview.result.candidates.length>1&&<details><summary>其他身份候选与本地 PDF（{preview.result.candidates.length-1}）</summary>{preview.result.candidates.filter(c=>c.key!==selected).map(option)}</details>}
        {chosen&&<ul>{chosen.checks.map((check,i)=><li key={i}>{check}</li>)}</ul>}
        {preview.result.excerpt&&<details><summary>首页线索与提取信息</summary><p>标题线索：{preview.result.title_hint||'未识别'}</p><p>作者线索：{preview.result.author_hint||'未识别'}</p><pre className="pp-identity-excerpt">{preview.result.excerpt.slice(0,2000)}</pre></details>}
        {(preview.state==='failed'||preview.state==='waiting'||preview.result.needs_ocr)&&<button type="button" className="pp-button secondary" disabled={busy||preview.state==='queued'||preview.state==='running'} onClick={async()=>{if(await write('/api/admin/papers/import-preview/'+preview.id+'/ocr','POST',{}))setPreview({...preview,state:'queued',error:null});}}>继续 OCR 识别</button>}
      </section>}
      <details open={!!preview}><summary>核对或补充论文信息</summary><p className="pp-muted">不确定的字段留空；修改标题、作者或来源后会标记为手动修改。CCF 来源名称匹配不代表单篇类型已核验。</p>
        <div className="pp-form-grid"><label>标题<input value={title} disabled={disabled} onChange={e=>setTitle(e.target.value)} maxLength={500}/></label><label>作者<input value={authors} disabled={disabled} onChange={e=>setAuthors(e.target.value)} maxLength={2000}/></label><label>发表日期<input type="date" value={published} disabled={disabled} onChange={e=>setPublished(e.target.value)}/>{chosen?.metadata.publication_year&&!published&&<small>已取得发表年份（具体日期未核验）：{chosen.metadata.publication_year}</small>}</label><label>论文版本<input value={version} disabled={disabled} onChange={e=>setVersion(e.target.value)} maxLength={100}/></label><label>研究方向<input value={topic} disabled={disabled} onChange={e=>setTopic(e.target.value)} maxLength={100}/></label></div>
        <label>DOI<div className="pp-inline"><input value={doi} disabled={disabled} onChange={e=>setDoi(e.target.value)} maxLength={300}/><button type="button" disabled={disabled||!doi} className="pp-button secondary" onClick={()=>resolve(file,doi)}>核验 DOI</button></div></label>
        <label>原始摘要<textarea value={abstract} disabled={disabled} onChange={e=>setAbstract(e.target.value)} rows={5} maxLength={20000}/></label>
      </details>
      <details><summary>关联代码（可选）</summary><label>代码仓库<input value={codeUrl} onChange={e=>setCodeUrl(e.target.value)} type="url" maxLength={2000}/></label></details>
      <label>个人标签（逗号分隔）<input name="tags" maxLength={500}/></label><label>想读原因<textarea name="reason" maxLength={1000} rows={2}/></label>
      <fieldset><legend>个人研究方向（可多选）</legend>{DIRECTIONS.map(d=><label key={d.id}><input type="checkbox" name="directions" value={d.id}/>{d.title}</label>)}</fieldset>
      {noFulltext&&<p className="pp-muted">已取得书目信息，尚未取得全文。可以先保存，或上传 PDF 后精读。</p>}<p className="pp-muted">同篇论文会复用已有记录与解读；已有收录的标签、原因和笔记保留，个人信息可在“我的论文”中管理。</p>{error&&<p role="alert" className="pp-error">{error}</p>}
      <div className="pp-collection-actions"><button className="pp-button secondary" type="submit" value="save" disabled={disabled}>仅保存到我的论文</button><button className="pp-button" type="submit" value="read" disabled={disabled||noFulltext}>保存并精读</button></div>
    </form></div>;
}
