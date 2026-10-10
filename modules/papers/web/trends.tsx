import { useLoaderData } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import "./style.css";
import {PaperSectionNav} from './navigation.tsx';
export const handle={tab:'discovery',name:'方向趋势'};

type Trend = {
  plan_id: string; kind: "hot" | "personal"; title: string; observed_on: string | null;
  window_start: string | null; window_end: string | null; recent_count: number | null; previous_count: number | null;
  source: string | null; captured_at: string | null;
};
export const meta = () => [{ title: "论文趋势 · 研脉" }];
export const headers = () => ({ "Cache-Control": "private, no-store" });
export async function loader({ request }: { request: Request }) {
  return adminGet<{ trends: Trend[] }>(request, "/api/admin/papers/trends");
}

export default function Trends() {
  const { trends } = useLoaderData<typeof loader>();
  return <div className="pp-page">
    <PaperSectionNav group="discovery"/>
    <div className="pp-heading"><div><p className="pp-eyebrow">ARXIV · OBSERVED COUNTS</p><h1>方向趋势</h1><p>对比最近 7 天与前 7 天 arXiv 检索结果数。它表示预设检索条件下的新论文数量，不代表论文质量或领域重要性。</p></div></div>
    <div className="pp-trend-grid">{trends.map((trend) => {
      const recent = trend.recent_count;
      const previous = trend.previous_count;
      const change = recent === null || previous === null ? null : previous === 0 ? (recent ? "基线为 0" : "持平") : `${recent > previous ? "+" : ""}${Math.round((recent - previous) / previous * 100)}%`;
      return <section className="pp-panel pp-trend-card" key={trend.plan_id}>
        <div className="pp-card-meta"><span className="pp-tag">{trend.kind === "hot" ? "热点方向" : "个人关注"}</span><span>{trend.source ?? "等待首次运行"}</span></div>
        <h2>{trend.title}</h2>
        {recent === null ? <p className="pp-muted">尚无检索快照。启用 PAPER_DISCOVERY_ENABLED 并等待每日任务运行。</p> : <>
          <div className="pp-trend-values"><div><span>最近 7 天</span><strong>{recent}</strong></div><div><span>前 7 天</span><strong>{previous}</strong></div><div><span>变化</span><strong>{change}</strong></div></div>
          <p className="pp-muted">窗口：{trend.window_start} 至 {trend.window_end} · 更新于 {trend.captured_at ? new Date(trend.captured_at).toLocaleString("zh-CN") : "未知"}</p>
        </>}
      </section>;
    })}</div>
  </div>;
}
