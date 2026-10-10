import {Form,Link,useLoaderData,useLocation} from 'react-router';
import {adminGet} from '@aihot/web/lib/admin.server';
import {candidateFilters,candidateUrl,type CandidatePage} from '../candidates.ts';
import {PaperHeading,PaperSummary} from './paper-heading.tsx';
import {PaperSectionNav} from './navigation.tsx';
import './style.css';
import {identity} from './identity.server.ts';
import {CollectionActions} from './collection-actions.tsx';
export const handle={tab:'discovery',name:'候选论文'};

export const meta = () => [{ title: "候选论文 · 研脉" }];
export const headers = () => ({ "Cache-Control": "private, no-store" });
export async function loader({ request }: { request: Request }) {
  const filters=candidateFilters(new URL(request.url).searchParams);
  const query=new URLSearchParams({direction:filters.direction,q:filters.q,reading:filters.reading,page:String(filters.page)});
  const [data,me]=await Promise.all([adminGet<CandidatePage>(request,'/api/admin/papers/candidates?'+query),identity(request)]);
  return {...data,me};
}

export default function Candidates() {
  const {candidates,directions,filters,total,pageSize,days,me}=useLoaderData<typeof loader>();
  const location=useLocation(),pages=Math.max(1,Math.ceil(total/pageSize));
  const narrowed=!!(filters.direction||filters.q||filters.reading);
  return <div className="pp-page">
    <PaperSectionNav group="discovery"/>
    <div className="pp-heading"><div><p className="pp-eyebrow">DISCOVERY · LAST {days} DAYS</p><h1>候选论文</h1>
      <p>浏览最近{days}天发现的论文，按研究方向快速找到感兴趣的内容。</p></div><Link className="pp-text-button" to="/papers/settings">管理关注方向 →</Link></div>
    <section className="pp-candidate-filters" aria-label="候选论文筛选">
      <nav className="pp-direction-filters" aria-label="研究方向">{directions.map(d=><Link key={d.id} to={candidateUrl(filters,{direction:d.id,page:1})}
        aria-current={filters.direction===d.id?'page':undefined}><span>{d.title}</span><span className="pp-filter-count">{d.count}</span></Link>)}</nav>
      <p className="pp-muted">方向按标题与摘要匹配；一篇论文可属于多个方向，列表已去重。</p>
      <Form method="get" action="/papers/candidates" className="pp-candidate-search" key={filters.direction+filters.q+filters.reading}>
        {filters.direction&&<input type="hidden" name="direction" value={filters.direction}/>}
        <input name="q" aria-label="搜索候选论文" placeholder="搜索标题、作者、摘要…" maxLength={200} defaultValue={filters.q}/>
        <select name="reading" aria-label="精读状态" defaultValue={filters.reading}><option value="">全部状态</option><option value="pending">待精读</option><option value="ready">已有解读</option></select>
        <button className="pp-button secondary" type="submit">筛选</button>
        {narrowed&&<Link className="pp-text-button" to="/papers/candidates">清除筛选</Link>}
      </Form>
    </section>
    <div className="pp-list-head"><h2>{filters.direction?directions.find(d=>d.id===filters.direction)?.title:'全部候选'} · {total} 篇</h2>
      {total>0&&<span className="pp-muted">第 {(filters.page-1)*pageSize+1}–{Math.min(filters.page*pageSize,total)} 篇</span>}</div>
    {candidates.length ? <div className="pp-list">{candidates.map((candidate) => <article className="pp-card" key={candidate.paper_id}>
      <div className="pp-card-meta">{candidate.directions.map(d=><span className="pp-tag" key={d.id}>{d.title}</span>)}<span>{candidate.published || "日期未标注"}</span><span className="pp-chip">{candidate.digest_status==='ready'?'已有解读':candidate.selected_date?'已进入阅读队列':'待精读'}</span></div>
      <Link to={`/papers/${candidate.paper_id}`} state={{paperReturn:location.pathname+location.search}}><PaperHeading paper={candidate}/></Link><p className="pp-authors">{candidate.authors || "作者未标注"}</p><PaperSummary paper={candidate}/>
      <div className="pp-card-foot"><span>发现于 {new Date(candidate.first_discovered_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})} · 来源：{candidate.matches.map(m=>m.plan_title).join('、')}</span><span>{candidate.version}</span><span>打开论文 →</span></div>
      <p className="pp-candidate-reasons">{candidate.matches.map(m=><span key={m.plan_id}>{m.kind==='hot'?'热点发现':'关注命中'}：{m.reason}</span>)}</p>
      <CollectionActions paper={candidate} csrf={me.csrf}/>
    </article>)}</div> : <div className="pp-empty"><h2>{narrowed?'没有符合筛选条件的论文':'暂时没有候选论文'}</h2>
      <p>{narrowed?'可以切换方向、调整关键词或精读状态。':'自动检索尚未运行，或最近一段时间没有符合关注计划的论文。'}</p>
      <Link className="pp-button" to={narrowed?'/papers/candidates':'/papers/settings'}>{narrowed?'查看全部候选':'查看检索设置'}</Link></div>}
    {pages>1&&<nav className="pp-candidate-pages" aria-label="候选论文分页">
      {filters.page>1&&<Link className="pp-button secondary" to={candidateUrl(filters,{page:filters.page-1})}>上一页</Link>}
      <span>第 {filters.page} / {pages} 页</span>
      {filters.page<pages&&<Link className="pp-button secondary" to={candidateUrl(filters,{page:filters.page+1})}>下一页</Link>}
    </nav>}
  </div>;
}
