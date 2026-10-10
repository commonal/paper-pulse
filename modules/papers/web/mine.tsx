import {Form,Link,useLoaderData,useLocation} from 'react-router';
import {adminGet} from '@aihot/web/lib/admin.server';
import {identity} from './identity.server.ts';
import {PaperSectionNav} from './navigation.tsx';
import {PaperHeading,PaperSummary} from './paper-heading.tsx';
import {CollectionActions} from './collection-actions.tsx';
import {statusLabel} from './shared.tsx';
import {DIRECTIONS} from '../directions.ts';
import type {Paper} from '../types.ts';
import './style.css';
import {readingStatusLabel} from './reading-progress.tsx';
import {PaperMetadataDetails} from './paper-metadata.tsx';
export const handle={tab:'reading',name:'我的论文'};
export const meta=()=>[{title:'我的论文 · 研脉'}];
export const headers=()=>({'Cache-Control':'private, no-store'});
export async function loader({request}:{request:Request}){
  const params=new URL(request.url).searchParams,q=(params.get('q')??'').slice(0,200),tag=(params.get('tag')??'').slice(0,40);
  const requested=params.get('status')??'',status=['','unread','reading','done'].includes(requested)?requested:'';
  const direction=DIRECTIONS.some(d=>d.id===params.get('direction'))?params.get('direction')!:'';
  const digest=params.get('digest')==='ready'?'ready':'';
  const [data,me]=await Promise.all([adminGet<{papers:Paper[]}>(request,'/api/admin/papers?'+new URLSearchParams({mine:'true',q,status,digest,tag,direction})),identity(request)]);
  return {...data,me,q,status,digest,tag,direction};
}
export default function Mine(){
  const {papers,me,...filters}=useLoaderData<typeof loader>(),location=useLocation();
  return <div className="pp-page"><PaperSectionNav group="reading"/>
    <div className="pp-heading"><div><h1>我的论文</h1><p>管理手动导入和主动保存的论文；仅保存不会启动精读，原文与解读在各入口共用。</p></div><Link className="pp-button" to="/papers/new">＋ 添加论文</Link></div>
    <Form method="get" key={JSON.stringify(filters)} className="pp-candidate-search pp-panel">
      <input name="q" aria-label="搜索我的论文" placeholder="标题、作者、DOI、标签…" defaultValue={filters.q} maxLength={200}/>
      <select name="status" aria-label="个人阅读状态" defaultValue={filters.status}><option value="">全部阅读状态</option>{Object.entries(statusLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
      <select name="digest" aria-label="AI 精读状态" defaultValue={filters.digest}><option value="">全部精读状态</option><option value="ready">已精读</option></select>
      <select name="direction" aria-label="个人研究方向" defaultValue={filters.direction}><option value="">全部方向</option>{DIRECTIONS.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select>
      <input name="tag" aria-label="个人标签" placeholder="筛选个人标签" maxLength={40} defaultValue={filters.tag}/><button className="pp-button secondary">筛选</button><Link to="/papers/mine">清除筛选</Link>
    </Form><p className="pp-muted">置顶优先，其余按加入时间排序 · 当前 {papers.length} 篇{papers.length===200?'（最多展示200篇，请用筛选定位）':''}</p>
    {papers.length?<div className="pp-list">{papers.map(p=><article className="pp-card" key={p.id}>
      <div className="pp-card-meta"><span className="pp-tag">{statusLabel[p.status]}</span><span>{p.digest_status==='ready'?'已精读':p.reading_status?readingStatusLabel(p.reading_status,p.reading_stage,p.reading_wait,p.reading_error):'尚未精读'}</span><span>{p.collection?.pinned?'置顶 · ':''}加入于 {new Date(p.collection!.saved_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</span></div>
      <Link to={`/papers/${p.id}`} state={{paperReturn:location.pathname+location.search}}><PaperHeading paper={p}/></Link><p className="pp-authors">{p.authors||'作者待补全'}</p><PaperSummary paper={p}/>
      <p className="pp-muted">{p.metadata?.venue_name||'发表来源待补全'} · {p.metadata?.publication_year||p.published||'发表时间待补全'}{p.doi?' · DOI：'+p.doi:''}{p.metadata?.citation_count!=null?' · OpenAlex 引用 '+p.metadata.citation_count:''}</p>
      {!!p.collection?.tags.length&&<p>{p.collection.tags.join(' · ')}</p>}{p.collection?.reason&&<p>想读原因：{p.collection.reason}</p>}
      <CollectionActions paper={p} csrf={me.csrf} edit/>
      <PaperMetadataDetails paper={p}/>
    </article>)}</div>:<div className="pp-empty"><h2>没有符合条件的收录论文</h2><p>添加一篇论文，或在候选、高引论文中选择“加入我的论文”。已有论文也可以在详情页加入。</p><Link to="/papers/new" className="pp-button">添加论文</Link></div>}
  </div>;
}
