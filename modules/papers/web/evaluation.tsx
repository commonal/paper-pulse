import {useState} from 'react';
import {Link,useLoaderData,useRevalidator} from 'react-router';
import {adminGet} from '@aihot/web/lib/admin.server';
import {identity} from './identity.server.ts';
import {useWrite} from './shared.tsx';
import {stageLabels,dimensionLabels,failureCategory,type ReadingRun,type ReadingEvent,type QualityEvaluationSummary,type summarizeReadingRuns} from '../evaluation.ts';
import './style.css';

type Dashboard={generatedAt:string;days:number;metrics:ReturnType<typeof summarizeReadingRuns>;runs:ReadingRun[];events:ReadingEvent[];
  legacy:{paper_id:string;title:string;stage:ReadingRun['stage'];status:string;error:string|null}[];quality:QualityEvaluationSummary[];
  papers:{id:string;title:string;active_version_id:string|null}[];requests:{purpose:string;status:string;n:number}[]};
export const handle={tab:'me',name:'精读评测'};
export const meta=()=>[{title:'精读评测 · 研脉'}];
export const headers=()=>({'Cache-Control':'private, no-store'});
export async function loader({request}:{request:Request}){
  const days=new URL(request.url).searchParams.get('days')??'30';
  const [data,me]=await Promise.all([adminGet<Dashboard>(request,'/api/admin/papers/evaluation?days='+encodeURIComponent(days)),identity(request)]);
  return {...data,me};
}
const labels:Record<string,string>={queued:'排队中',running:'处理中',waiting:'等待恢复',failed:'失败',ready:'已完成',unavailable:'材料不可用',superseded:'已被新任务替代'};
const percent=(v:{percent:number|null;numerator:number;denominator:number})=>v.percent===null?'暂无样本':`${v.percent}%（${v.numerator}/${v.denominator}）`;
const time=(v:string)=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
function QualityReport({evaluation}:{evaluation:QualityEvaluationSummary}){
  const r=evaluation.result;if(!r)return null;
  const problems=r.claim_checks.filter(c=>c.verdict!=='supported');
  const original=(page?:number)=>`/papers/${evaluation.paper_id}?version=${evaluation.version_id}${page?'&page='+page:''}`;
  const verdictLabel={supported:'有支持',contradicted:'疑似与原文矛盾',insufficient:'依据不足',source_conflict:'原文自身冲突'};
  return <div className="pp-quality-report">
    <p>{r.summary}</p><p className="pp-muted">{r.visualScope} · {r.sameModel?'与生成模型相同，存在共同盲点':'使用不同评分模型'} · 尚未人工校准</p>
    {r.calibration&&<p className="pp-eval-warning">校准样本（含故意改错文字）：{r.calibration.passed}/{r.calibration.total} 条判断符合本批原文核对标签；标签由本轮原文审查建立，尚待人工复核，仅代表该批样本。{r.calibration.checks.map(c=><span key={c.claimId}> {c.claimId}：预期{verdictLabel[c.expected]} / 模型{verdictLabel[c.observed]}{c.matched?' ✓':' ✗'}；</span>)}</p>}
    {!r.calibration&&<div className="pp-eval-dimensions">{r.dimensions.map(d=><section key={d.id}><strong>{dimensionLabels[d.id]}：{d.score===null?'无法评分':`${d.score}/4`}</strong><p>{d.reason}</p></section>)}</div>}
    <p>模型主张核对：{r.claim_checks.filter(c=>c.verdict==='supported').length} 条有支持，{r.claim_checks.filter(c=>c.verdict==='contradicted').length} 条疑似矛盾，{r.claim_checks.filter(c=>c.verdict==='insufficient').length} 条依据不足，{r.claim_checks.filter(c=>c.verdict==='source_conflict').length} 条原文自身冲突。</p>
    {r.claim_checks.some(c=>c.numeric_audit?.length)&&<details><summary>逐项原文数字读取</summary>{r.claim_checks.flatMap(c=>(c.numeric_audit??[]).map((a,i)=><div key={c.claim_id+':'+i}><p><strong>{c.claim_id} · {a.quantity}</strong>：{a.agreement==='conflict'?'原文数值冲突':a.agreement==='consistent'?'来源一致':a.agreement==='single_source'?'单一来源':'条件不可直接比较'} · {a.reason}</p>{a.readings.map((n,j)=><p key={j}>{n.value} · {n.quote_id}</p>)}</div>))}</details>}
    {problems.length>0&&<details open><summary>需要核对的主张（{problems.length}）</summary>{problems.map(c=><div key={c.claim_id}><p><strong>{c.claim_id} · {verdictLabel[c.verdict]}</strong>：{c.reason}</p><blockquote>{evaluation.assessed_sections.flatMap(s=>s.claims).find(claim=>claim.id===c.claim_id)?.text??'请在下载报告中查看冻结的解读'}<p>证据：{c.quote_ids.join('、')||'没有足够证据'}</p></blockquote></div>)}</details>}
    {!r.calibration&&r.omissions.length>0&&<details open><summary>重要遗漏（{r.omissions.length}）</summary>{r.omissions.map((o,i)=><p key={i}><strong>{o.severity==='major'?'主要':'次要'}遗漏：</strong>{o.description}<br/>证据：{o.quote_ids.join('、')}</p>)}</details>}
    <details><summary>原文证据与硬性检查</summary><p>正文 {r.hardChecks.sourceBlocks} 块 / {r.hardChecks.sourceChars} 字符，主张 {r.hardChecks.claims} 条。未知证据ID：{r.hardChecks.unknownEvidenceIds.join('、')||'无'}；直接主张缺引用：{r.hardChecks.unreferencedDirectClaims.join('、')||'无'}。</p>
      {!!r.referenceRepairs?.length&&<p>模型返回的{r.referenceRepairs.length}个真实证据块编号已按整块展开为原文片段，未猜测单句；原始回答与展开记录保留在报告中。</p>}
      {!!r.numericFormatRepairs?.length&&<p>模型在{r.numericFormatRepairs.length}处给表格数字追加了百分号；仅依据原表明确的百分比列标题，恢复为真实单元格文字。原回答、列标题依据及格式修正记录保留；未改判断。</p>}
      {r.quotes.map(q=><blockquote key={q.quote_id}><Link to={original(q.page)}>{q.quote_id} · {q.page?`原文第${q.page}页`:'查看对应原文版本'}</Link><p>{q.text}</p></blockquote>)}</details>
    <p className="pp-muted">评测原文版本：{evaluation.version_id} · 被评解读回执：{evaluation.digest_receipt_id??'未知'} · 快照：{evaluation.input_hash.slice(0,12)} · 评分模型：{r.judgeModel} · 量表：{evaluation.rubric_version} · 评分回执：{evaluation.receipt_id}</p>
  </div>;
}
export default function Evaluation(){
  const data=useLoaderData<typeof loader>(),revalidator=useRevalidator();
  const [paperId,setPaperId]=useState(''),[notice,setNotice]=useState('');const {write,busy,error}=useWrite(data.me.csrf);
  const score=async()=>{const p=data.papers.find(p=>p.id===paperId);if(!p?.active_version_id)return;const r=await write<{id:string;reused:boolean}>('/api/admin/papers/quality-evaluations','POST',{paperId,versionId:p.active_version_id});if(r){setNotice(r.reused?'已复用相同版本的评测报告。':'质量评测已入队，完成后刷新查看。');revalidator.revalidate();}};
  const resume=async(id:string)=>{if(await write(`/api/admin/papers/quality-evaluations/${id}/resume`,'POST',{})){setNotice('已按原评测快照继续处理。');revalidator.revalidate();}};
  const m=data.metrics;
  return <div className="pp-page pp-evaluation">
    <Link className="pp-back" to="/more">← 我的</Link><div className="pp-heading"><div><p className="pp-eyebrow">READING · EVALUATION</p><h1>精读评测</h1><p>先看流程能否稳定完成，再对照原文检查解读质量。</p></div></div>
    <div className="pp-eval-actions"><Link to="?days=7">最近7天</Link><Link to="?days=30">最近30天</Link><Link to="?days=365">最近一年</Link><button className="pp-button secondary" disabled={revalidator.state!=='idle'} onClick={()=>revalidator.revalidate()}>刷新报告</button><a href={`/api/admin/papers/evaluation/report?days=${data.days}`}>下载 JSON 报告</a></div>
    <section className="pp-panel"><h2>正常执行率 · 最近{data.days}天</h2>
      <p className="pp-muted">从启用执行历史后开始统计完整精读任务。已结算 = 完整完成＋失败＋材料不可用；排队、运行、等待和被替代任务分别列出。旧记录、图表单独升级不用于计算首次成功率。</p>
      <div className="pp-eval-dimensions"><section><strong>首次无中断完成</strong><p>{percent(m.firstPass)}</p></section><section><strong>结算任务最终完成</strong><p>{percent(m.completion)}</p></section><section><strong>全部启动任务完成</strong><p>{percent(m.allStartedCompletion)}</p></section><section><strong>未复用正文解读的完成率</strong><p>{percent(m.freshCompletion)}</p></section></div>
      <p>启动 {m.started} · 完成 {m.completed} · 失败后恢复完成 {m.recovered} · 等待 {m.waiting} · 排队/运行 {m.active} · 失败 {m.failed} · 被替代 {m.superseded}</p>
      <p className="pp-muted">正文解读复用 {m.cached} · 图表单独升级 {m.figureOnly} · 不完整历史 {m.legacy}。完成耗时（包含等待）：P50 {m.p50Seconds===null?'暂无':Math.round(m.p50Seconds)+'秒'} / P95 {m.p95Seconds===null?'暂无':Math.round(m.p95Seconds)+'秒'}。{m.smallSample?'已结算少于20次，仅作观察，不据此宣称稳定。':''}</p>
      {m.failures.length>0&&<div className="pp-eval-table"><table><thead><tr><th>失败阶段</th><th>原因</th><th>涉及任务</th><th>失败记录</th></tr></thead><tbody>{m.failures.map(f=><tr key={f.stage+f.category}><td>{stageLabels[f.stage as ReadingRun['stage']]??f.stage}</td><td>{f.category}</td><td>{f.runs}</td><td>{f.events}</td></tr>)}</tbody></table></div>}
      <details><summary>执行历史与恢复过程（{data.runs.length}个任务）</summary>{data.runs.map(r=><details className="pp-eval-run" key={r.run_id}><summary>{r.title} · {labels[r.status]} · {stageLabels[r.stage]}{!r.initial_observed?' · 缺少起始历史':''}{r.kind==='illustrations'?' · 图表升级':''}</summary><p><Link to={`/papers/${r.paper_id}${r.version_id?'?version='+r.version_id:''}`}>打开对应论文版本</Link> · {r.run_id}</p>{data.events.filter(e=>e.run_id===r.run_id).map(e=><p key={e.id}>{time(e.recorded_at)} · {stageLabels[e.stage as ReadingRun['stage']]??e.stage} · {labels[e.status]??e.status} · {e.action}{e.error?'：'+e.error:''}{e.receipt_id?' · 回执 '+e.receipt_id:''}</p>)}</details>)}</details>
    </section>
    <section className="pp-panel"><h2>已有任务状态快照</h2><p className="pp-muted">这些任务在启用历史记录前已存在，过去的失败可能被恢复结果覆盖；只能查看当前状态，不能反推真实首次成功率。</p>
      <p>共 {data.legacy.length} 个：完成 {data.legacy.filter(r=>r.status==='ready').length}，失败/不可用 {data.legacy.filter(r=>['failed','unavailable'].includes(r.status)).length}，其他 {data.legacy.filter(r=>!['ready','failed','unavailable'].includes(r.status)).length}。</p>
      <details><summary>查看旧任务与错误</summary>{data.legacy.map(r=><p key={r.paper_id}><Link to={`/papers/${r.paper_id}`}>{r.title}</Link> · {labels[r.status]} · {stageLabels[r.stage]}{r.error?' · '+failureCategory(r.error)+'：'+r.error:''}</p>)}</details>
      <details><summary>历史供应商请求状态（不是整篇精读成功率）</summary>{data.requests.map(r=><p key={r.purpose+r.status}>{r.purpose} · {r.status}：{r.n}</p>)}</details>
    </section>
    <section className="pp-panel"><h2>Agent 对照原文评分</h2><p className="pp-muted">评分保存独立报告，不修改解读或笔记。0–4分是未人工校准的评测意见；无法确认时显示无法评分。点击开始会由 worker 调用模型，浏览和刷新不调用模型。</p>
      <div className="pp-eval-actions"><select aria-label="选择评分论文" value={paperId} onChange={e=>setPaperId(e.target.value)}><option value="">选择已有精读论文</option>{data.papers.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select><button className="pp-button" disabled={busy||!paperId} onClick={score}>开始质量评测</button></div>
      {notice&&<p role="status" className="pp-success">{notice}</p>}{error&&<p role="alert" className="pp-error">{error}</p>}
      {data.quality.length===0&&<p className="pp-muted">尚无质量评分，选择论文后可开始。</p>}
      {data.quality.map(e=><article className="pp-eval-run" key={e.id}><h3>{e.calibration_label?`校准样本 · ${e.calibration_label}`:e.title}</h3><p>{labels[e.status]} · {time(e.updated_at)} {['failed','waiting'].includes(e.status)&&<button className="pp-button secondary" disabled={busy} onClick={()=>resume(e.id)}>继续此评测</button>}</p>{e.error&&<p className="pp-error">{e.error}</p>}<QualityReport evaluation={e}/></article>)}
    </section>
    <p className="pp-muted">报告生成：{time(data.generatedAt)}（北京时间）。执行率来自真实任务记录；本地假模型回归测试不混入此统计。</p>
  </div>;
}
