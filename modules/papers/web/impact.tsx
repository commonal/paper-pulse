import {useEffect,useState} from 'react';
import {Form,Link,useLoaderData,useLocation,useNavigate,useRevalidator} from 'react-router';
import {adminGet} from '@aihot/web/lib/admin.server';
import {identity} from './identity.server.ts';
import {useWrite} from './shared.tsx';
import {PaperSectionNav} from './navigation.tsx';
import {impactFilters,impactUrl,type ImpactCandidate,type ImpactData} from '../impact.ts';
import {DIRECTIONS,HOT_DIRECTION} from '../directions.ts';
import type {Paper} from '../types.ts';
import './style.css';
import {CollectionActions} from './collection-actions.tsx';
export const handle={tab:'discovery',name:'高引论文'};
export const meta=()=>[{title:'CCF A 高引与经典论文 · 研脉'}];
export const headers=()=>({'Cache-Control':'private, no-store'});
export async function loader({request}:{request:Request}){
  const filters=impactFilters(new URL(request.url).searchParams),query=new URL(impactUrl(filters),'http://local').search;
  const [data,me]=await Promise.all([adminGet<ImpactData>(request,'/api/admin/papers/impact'+query),identity(request)]);
  return {...data,me};
}
function ImpactCard({candidate,csrf,returnTo}:{candidate:ImpactCandidate;csrf:string;returnTo:string}){
  const {write,busy,error,setError}=useWrite(csrf),navigate=useNavigate();
  const [file,setFile]=useState<File|null>(null);const paper=candidate.paper;
  async function start(){
    let pdfBase64:string|undefined;
    if(file){
      if(file.size>20*1024*1024){setError('PDF 文件不能超过20 MB');return;}
      try{pdfBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('无法读取 PDF 文件'));reader.readAsDataURL(file);});}
      catch(e){setError((e as Error).message);return;}
    }
    const result=await write<Paper>(`/api/admin/papers/impact/${candidate.openalex_id}/read`,'POST',{pdfBase64});
    if(result)navigate(`/papers/${result.id}`,{state:{paperReturn:returnTo}});
  }
  const processing=paper&&['queued','running','waiting'].includes(paper.reading_status??'');
  const label=paper?.digest_status==='ready'?'已有解读':processing?paper?.reading_status==='waiting'?'等待恢复':'精读处理中':paper?.reading_status==='failed'?'精读未完成':'尚未精读';
  return <article className="pp-card">
    <div className="pp-card-meta"><span className="pp-tag">CCF {candidate.ccf_rank} · {candidate.ccf_area}</span><span>{candidate.publication_year??'年份未知'}</span><span>OpenAlex 引用 {candidate.citation_count?.toLocaleString()??'未知'} 次</span><span className="pp-tag">{label}</span></div>
    <h2>{paper?.title_zh||candidate.title}</h2>{paper?.title_zh&&<p className="pp-title-original" lang="en">{candidate.title}</p>}
    <p className="pp-authors">{candidate.authors||'作者未标注'}</p>
    {(paper?.summary_zh||candidate.abstract)&&<p className="pp-abstract">{paper?.summary_zh||`原始摘要：${candidate.abstract}`}</p>}
    <div className="pp-impact-source"><span>{candidate.venue_type==='journal'?'期刊':'会议/来源'}：{candidate.venue_name||'未标注'}</span></div>
    <div className="pp-card-foot"><span>{candidate.plan_ids.map(id=>[...DIRECTIONS,HOT_DIRECTION].find(d=>d.id===id)?.title??id).join('、')}</span>
      <a href={candidate.open_access_url||candidate.doi_url||candidate.openalex_url} target="_blank" rel="noreferrer">论文来源 ↗</a>
      {paper?<Link to={`/papers/${paper.id}`} state={{paperReturn:returnTo}}>{paper.digest_status==='ready'?'阅读 AI 解读 →':'打开论文 →'}</Link>:<button className="pp-button secondary" disabled={busy} onClick={start}>{busy?'正在加入…':'加入并精读'}</button>}
    </div>
    {paper?<CollectionActions paper={paper} csrf={csrf}/>:<button className="pp-button secondary" disabled={busy} onClick={async()=>{const result=await write<Paper>(`/api/admin/papers/impact/${candidate.openalex_id}/save`,'POST',{});if(result)navigate(`/papers/${result.id}`,{state:{paperReturn:returnTo}});}}>加入我的论文（仅保存）</button>}
    {paper?.reading_wait&&<p className="pp-muted">{paper.reading_wait.title} · {paper.reading_wait.detail}</p>}
    {paper?.has_pdf&&paper.digest_status!=='ready'&&!processing&&<button className="pp-button secondary" disabled={busy} onClick={start}>继续精读</button>}
    {!paper?.has_pdf&&paper?.digest_status!=='ready'&&!processing&&<details className="pp-impact-upload"><summary>上传原文 PDF{paper?'并重试':'（开放全文不可用时）'}</summary><p className="pp-muted">使用你获得的原文 PDF，20 MB 以内。原文会保存在这篇论文下，再进行完整精读。</p>
      <label>原文 PDF<input type="file" accept="application/pdf,.pdf" aria-label={`上传 ${candidate.title} 的 PDF`} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
      <button className="pp-button secondary" disabled={busy||!file} onClick={start}>{busy?'正在保存…':paper?'补充 PDF 并重试':'上传并开始精读'}</button>
    </details>}
    {error&&<p className="pp-error" role="alert">{error}</p>}
  </article>;
}
export default function Impact(){
  const {status,candidates,venues,directions,filters,total,pageSize,me}=useLoaderData<typeof loader>(),location=useLocation();
  const {write,busy,error}=useWrite(me.csrf),revalidator=useRevalidator();const [refreshing,setRefreshing]=useState(false);
  useEffect(()=>{if(!refreshing&&status.state!=='running')return;const timer=setInterval(()=>{if(document.visibilityState==='visible')revalidator.revalidate();},4000);return()=>clearInterval(timer);},[refreshing,status.state,revalidator]);
  useEffect(()=>{if(status.captured_at)setRefreshing(false);},[status.captured_at]);
  const pages=Math.max(1,Math.ceil(total/pageSize));
  return <div className="pp-page"><PaperSectionNav group="discovery"/>
    <div className="pp-heading"><div><p className="pp-eyebrow">OPENALEX · CCF A VENUES</p><h1>CCF A 高引与经典论文</h1><p>按关注方向寻找高引用论文，选择一篇进入完整精读；已完成的解读也会出现在“已精读论文”。</p></div><button className="pp-button secondary" disabled={busy||refreshing||status.state==='running'} onClick={async()=>{const result=await write('/api/admin/papers/impact/refresh','POST',{});if(result){setRefreshing(true);revalidator.revalidate();}}}>{refreshing?'等待后台更新…':'更新高引论文'}</button></div>
    {error&&<p className="pp-error" role="alert">{error}</p>}
    <details className="pp-impact-note"><summary>引用量与 CCF 来源口径</summary><p className="pp-muted">首期白名单覆盖人工智能、数据库/内容检索、图形学与多媒体、交叉/综合相关 CCF A 来源，并非完整目录。引用量是 OpenAlex 的匹配记录，不等于论文质量；venue 命中不能证明 Full/Regular paper 身份。开放预印本与发表版本会分别标注，全文不完整时不生成解读。<a href="https://www.ccf.org.cn/Academic_Evaluation/By_category/2023-03-08/787209.shtml" target="_blank" rel="noreferrer">CCF 目录说明 ↗</a></p></details>
    {status.state==='running'&&<p role="status">高引检索正在运行。</p>}
    {status.state==='failed'&&<p className="pp-error" role="alert">最近检索失败：{status.error||'未知错误'}</p>}
    {status.captured_at&&<p className="pp-muted">检索区间：{status.query_start?.slice(0,10)} 至 {status.query_end?.slice(0,10)} · 更新于 {new Date(status.captured_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>}
    <section className="pp-panel pp-candidate-filters"><nav className="pp-direction-filters" aria-label="高引研究方向">{directions.map(d=><Link key={d.id} to={impactUrl(filters,{direction:d.id,page:1})} aria-current={filters.direction===d.id?'page':undefined}>{d.title}<span>{d.count}</span></Link>)}</nav>
      <Form method="get" key={JSON.stringify(filters)} className="pp-candidate-search"><input type="hidden" name="direction" value={filters.direction}/>
        <input aria-label="搜索高引论文" name="q" maxLength={200} defaultValue={filters.q} placeholder="搜索标题、作者、摘要…"/>
        <select aria-label="发表时间" name="age" defaultValue={filters.age}><option value="">全部年份</option><option value="older">发表5年以上</option><option value="recent">近5年</option></select>
        <select aria-label="论文来源" name="venue" defaultValue={filters.venue}><option value="">全部会议/期刊</option>{venues.map(v=><option key={v.venue_name} value={v.venue_name}>{v.venue_name} · {v.candidate_count}</option>)}</select>
        <select aria-label="精读状态" name="reading" defaultValue={filters.reading}><option value="">全部状态</option><option value="pending">待精读</option><option value="ready">已有解读</option></select>
        <button className="pp-button secondary">筛选</button>{(filters.direction||filters.q||filters.reading||filters.age||filters.venue)&&<Link to="/papers/impact">清除筛选</Link>}
      </Form><p className="pp-muted">按引用量排序；方向来自检索命中，可重叠。选择精读后由后台获取开放 PDF、检查正文、精读核查并解释关键图表。</p></section>
    <div className="pp-list-head"><h2>高引论文 · {total} 篇</h2>{total>0&&<span>第 {(filters.page-1)*pageSize+1}–{Math.min(filters.page*pageSize,total)} 篇</span>}</div>
    {candidates.length?<div className="pp-list">{candidates.map(c=><ImpactCard key={c.openalex_id} candidate={c} csrf={me.csrf} returnTo={location.pathname+location.search}/>)}</div>:<div className="pp-empty"><h2>{status.state==='idle'?'尚无高引论文':'没有匹配的论文'}</h2><p>{status.state==='idle'?'启用的 OpenAlex 检索由后台每周更新，浏览不会发起外部检索。':'可以切换方向、年份、来源或清除筛选。'}</p></div>}
    {pages>1&&<nav className="pp-candidate-pages" aria-label="高引论文分页">{filters.page>1&&<Link to={impactUrl(filters,{page:filters.page-1})}>上一页</Link>}<span>{filters.page} / {pages}</span>{filters.page<pages&&<Link to={impactUrl(filters,{page:filters.page+1})}>下一页</Link>}</nav>}
    <p className="pp-muted pp-impact-sources">引用来源：<a href="https://help.openalex.org/data/works/attributes/" target="_blank" rel="noreferrer">OpenAlex ↗</a> · 自动发现仅返回当前关注方向的检索子集，高引用不直接等同于经典。</p>
  </div>;
}
