import { Link, Form, useLoaderData, useRevalidator, useLocation } from "react-router";
import { useEffect, useState } from "react";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { Paper,DailyReadingStatus } from "../types.ts";
import { statusLabel } from "./shared.tsx";
import { getWeeklyReadingCount } from "./reading-signal.ts";
import { PaperHeading, PaperSummary } from "./paper-heading.tsx";
import { readingStatusLabel,ReadingWaitMessage } from "./reading-progress.tsx";
import { PaperSectionNav } from "./navigation.tsx";
import {DailyStatus} from './daily-status.tsx';
import {dailyMessage} from '../daily.ts';
export const handle = { tab: "reading", name: "阅读" };
export const meta = () => [{ title: "论文阅读 · 研脉" }];
export const headers = () => ({ "Cache-Control": "private, no-store" });
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url); const q = url.searchParams.get("q") ?? "";
  // Single-fetch navigation keeps its .data suffix on the loader request URL.
  const pathname = url.pathname.replace(/\.data$/, "");
  const view = pathname === "/papers/history" ? "history" : pathname === "/papers/library" ? "library" : "today";
  const requested = url.searchParams.get("status") ?? (view === "history" ? "active" : "");
  const status = ["", "active", "unread", "reading", "done"].includes(requested) ? requested : "";
  const today = view === "today" && !q;
  const endpoint = today ? "/api/admin/papers/today" : "/api/admin/papers?q=" + encodeURIComponent(q) + "&status=" + encodeURIComponent(status) + (view === "library" ? "&digest=ready" : "");
  const result=today?await adminGet<{papers:Paper[];daily:DailyReadingStatus}>(request,endpoint)
    :{...await adminGet<{papers:Paper[]}>(request,endpoint),daily:null};
  return { ...result, q, today, view, status };
}
export default function Home() {
  const { papers, q, today, view, status, daily } = useLoaderData<typeof loader>();
  const location = useLocation(); const returnTo = location.pathname + location.search;
  const revalidator = useRevalidator();
  const processing = papers.some(p => p.reading_status?p.reading_status==='queued'||p.reading_status==='running':p.digest_status==='queued'||p.digest_status==='generating');
  const waiting=papers.some(p=>p.reading_status==='waiting');
  useEffect(() => {
    if (!processing && !waiting && !daily?.enabled) return;
    const timer = window.setInterval(() => {if(document.visibilityState==='visible'&&revalidator.state==='idle')revalidator.revalidate();}, processing?4000:30000);
    return () => window.clearInterval(timer);
  }, [processing, waiting,daily?.enabled, revalidator]);
  const [weeklyReadCount, setWeeklyReadCount] = useState(0);
  useEffect(() => {
    const refresh = () => setWeeklyReadCount(getWeeklyReadingCount());
    refresh(); window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const heading = view === "history" ? "阅读记录" : view === "library" ? "已精读论文" : q ? "论文搜索" : "今天值得读的论文";
  const description = view === "history" ? "按手动标记的阅读状态回看论文；页面停留不会自动标记为读完。"
    : view === "library" ? "集中查看已生成 AI 精读解读的论文，按解读更新时间排序，可搜索标题、作者或研究方向。"
    : "追踪研究热点，用 AI 把论文讲清楚，并把每个结论带回原文证据。";
  type QueuePaper = Paper & { reason?: string; source_kind?: "hot" | "personal" };
  return <div className="pp-page">
    <PaperSectionNav group="reading"/>
    <div className="pp-heading"><div><p className="pp-eyebrow">PAPER PULSE · READING</p><h1>{heading}</h1><p>{description}</p></div><Link className="pp-button" to="/papers/new">＋ 导入论文</Link></div>
    {daily?<DailyStatus daily={daily} busy={revalidator.state!=='idle'} onRefresh={()=>revalidator.revalidate()}/>:<div className="pp-stats"><div><span>当前列表</span><strong>{papers.length}</strong></div><div><span>AI 解读</span><strong>{papers.filter(p => p.digest_status === "ready").length}</strong></div><div><span>正文已解析</span><strong>{papers.filter(p => p.parse_status === "ready").length}</strong></div></div>}
    {view === "today" && <p className="pp-weekly-reading">本周阅读停留 ≥30 秒：{weeklyReadCount} 篇</p>}
    <div className="pp-list-head"><h2>{q ? "搜索结果" : today ? "今日阅读队列" : heading}</h2>
      <Form method="get" className="pp-search" action={location.pathname}>
        {view === "history" && <select name="status" aria-label="筛选阅读状态" defaultValue={status} key={status}>
          <option value="active">阅读中与已读</option><option value="unread">待读</option><option value="reading">阅读中</option><option value="done">已读</option><option value="">全部状态</option>
        </select>}
        <input key={q} name="q" aria-label="搜索论文" defaultValue={q} placeholder="搜索论文标题、作者、方向…" maxLength={200}/><button className="pp-button secondary">搜索</button>
      </Form>
    </div>
    {!today && papers.length === 200 && <p className="pp-muted">当前展示{view === "library" ? "最近完成解读" : "最近收录"}的最多 200 篇，可用搜索进一步定位。</p>}
    {papers.length === 0 ? <div className="pp-empty"><h2>{q ? "没有找到相关论文" : view === "history" ? "当前状态下没有阅读记录" : view === "library" ? "暂时没有已精读论文" : daily ? dailyMessage(daily).title : "今天暂时没有入选论文"}</h2><p>{view === "history" ? "可以调整状态筛选，或打开论文后标记阅读状态。" : q ? "换一个关键词再试试。" : view === "library" ? "完成 AI 精读后，论文会自动出现在这里。" : daily ? "你可以先回看已精读论文，或浏览候选论文。" : "换一个关键词，或导入一篇论文。"}</p><Link to={view === "history" ? "/papers/library" : today || view === "library" ? "/papers/candidates" : "/papers/new"} className="pp-button">{view === "history" ? "浏览已精读论文" : today || view === "library" ? "查看候选论文" : "导入论文"}</Link>{today && <Link className="pp-text-button" to="/papers/library">回看已精读论文 →</Link>}</div>
    : <div className="pp-list">{papers.map(p => { const queued = p as QueuePaper; return <Link className="pp-card" key={p.id} to={"/papers/" + p.id+(p.readable_version_id?"?version="+p.readable_version_id:"")} state={{ paperReturn: returnTo }}>
      <div className="pp-card-meta"><span className="pp-tag">{queued.source_kind === "hot" ? "热点发现" : p.topic || "个人关注"}</span><span>{p.published || "日期未标注"}</span><span className="pp-chip">{p.reading_status && p.reading_status !== "ready" ? readingStatusLabel(p.reading_status, p.reading_stage,p.reading_wait,p.reading_error) : p.digest_status === "ready" ? "AI 解读已生成" : p.digest_status === "generating" || p.digest_status === "queued" ? "解读排队中" : p.parse_status === "ready" ? "正文已解析" : statusLabel[p.status]}</span><span>{statusLabel[p.status]}</span></div>
      <ReadingWaitMessage wait={p.reading_wait}/><PaperHeading paper={p}/><p className="pp-authors">{p.authors || "作者未标注"}</p><PaperSummary paper={p}/><div className="pp-card-foot"><span>{p.digest_status === "ready" ? "可回跳证据" : p.has_pdf ? "本地 PDF" : "原文链接"}</span><span className="pp-match-reason">{queued.reason ? "命中：" + queued.reason : p.topic}</span><span>{p.digest_status === "ready" ? "打开 AI 解读 →" : "打开论文 →"}</span></div>
    </Link>; })}</div>}
  </div>;
}
