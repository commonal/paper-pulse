import type { Paper } from "../types.ts";

export function PaperHeading({ paper, detail = false }: { paper: Paper; detail?: boolean }) {
  const Heading = detail ? "h1" : "h2";
  return <>
    <Heading>{paper.title_zh || paper.title}</Heading>
    {paper.title_zh && paper.title_zh !== paper.title && <p className="pp-title-original" lang="en">{paper.title}</p>}
  </>;
}

export function PaperSummary({ paper }: { paper: Paper }) {
  return paper.summary_zh
    ? <p className="pp-abstract pp-summary-zh">{paper.summary_zh}</p>
    : <p className="pp-abstract pp-summary-pending">{paper.abstract ? `原始摘要：${paper.abstract}` : "中文简介将在解读完成后显示。"}</p>;
}
