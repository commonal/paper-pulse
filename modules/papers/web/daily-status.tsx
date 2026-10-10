import {Link} from 'react-router';
import type {DailyReadingStatus} from '../types.ts';
import {dailyMessage,DAILY_MAX_PDF_PAGES} from '../daily.ts';

export function dailyTime(value:string|null){
  return value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'暂无成功记录';
}
export function DailyStatus({daily,busy,onRefresh}:{daily:DailyReadingStatus;busy:boolean;onRefresh:()=>void}){
  const message=dailyMessage(daily);const c=daily.counts;
  return <section className="pp-daily-status" data-state={daily.state} aria-label="今日更新状态">
    <div className="pp-daily-head"><span>今日更新 · {daily.date}</span><span>每天 {daily.time} · 北京时间</span></div>
    <div className="pp-daily-title"><h2>{message.title}</h2><button className="pp-text-button" disabled={busy} onClick={onRefresh}>{busy?'正在刷新…':'刷新状态'}</button></div>
    <p role="status">{message.description}</p>
    {daily.discovery&&daily.discovery.status!=='complete'&&<p className="pp-daily-note">检索方向：已完成 {daily.discovery.readyPlans} 个，等待恢复 {daily.discovery.pendingPlans} 个，失败 {daily.discovery.failedPlans} 个。{daily.discovery.nextRetryAt&&<>最早可重试：{dailyTime(daily.discovery.nextRetryAt)}；后台每五分钟检查。</>} 已入选论文的精读会独立继续。</p>}
    {!!daily.discovery?.errors.length&&<details className="pp-daily-note"><summary>查看检索原因</summary>{daily.discovery.errors.map((error,i)=><p key={i}>{error}</p>)}</details>}
    {!!daily.exclusions?.length&&<details className="pp-daily-note"><summary>已跳过 {daily.exclusions.length} 篇不符合自动精读条件的论文</summary>{daily.exclusions.map(item=><p key={item.paperId+item.removedAt}><Link to={`/papers/${item.paperId}`}>{item.title}</Link>：{item.reason}（{dailyTime(item.removedAt)}）</p>)}</details>}
    <dl className="pp-daily-counts">{[['今日入选',`${c.selected} / ${daily.dailyLimit}`],['解读可读',c.readable],['完整处理完成',c.completed],['处理中',c.processing],['等待恢复',c.waiting],['尚未完成',c.failed+c.notStarted]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="pp-daily-foot"><span>最近检索成功：{dailyTime(daily.lastSuccessAt)}</span>{daily.nextRunAt&&<span>下次计划：{dailyTime(daily.nextRunAt)}</span>}<Link to="/papers/settings">关注与检索设置 →</Link></div>
    <p className="pp-daily-note">06:00 是检索开始时间，解读会陆续完成；自动更新需要后台服务持续运行。自动日更只精读不超过 {DAILY_MAX_PDF_PAGES} 页的 PDF（含附录），超长论文保留在候选库。</p>
  </section>;
}
