import { useEffect, useRef, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { statusLabel, useWrite } from "./shared.tsx";
import { identity } from "./identity.server.ts";
import type { PaperBlock, PaperDetail, PaperDigestClaim, PaperIllustration } from "../types.ts";
import { PdfCrop, PdfDocumentProvider, PdfReader } from "./pdf.tsx";
import { citationNumbers } from "./digest-layout.ts";
import { recordWeeklyReading } from "./reading-signal.ts";
import { PaperHeading, PaperSummary } from "./paper-heading.tsx";
import { ReadingProgress } from "./reading-progress.tsx";
import {PaperBackLink} from './navigation.tsx';
import {CollectionActions} from './collection-actions.tsx';
import {PaperMetadataDetails,publicationLabel} from './paper-metadata.tsx';
import {VersionManager} from './versions.tsx';
import {ReviewRepairPanel} from './review-repair.tsx';
import {VisualBodyReviewPanel} from './visual-body-review.tsx';
import {ReadingNotes,type ReadingNotesHandle,type NoteTarget} from './reading-notes.tsx';
export const handle={home:'reading',name:'论文解读'};

export const meta = () => [{ title: "论文解读 · 研脉" }];
export const headers = () => ({ "Cache-Control": "private, no-store" });

export async function loader({ request, params }: { request: Request; params: { id?: string } }) {
  const query=new URL(request.url).searchParams.get('version');
  const [data, me] = await Promise.all([adminGet<PaperDetail>(request, `/api/admin/papers/${params.id}`+(query?'?version='+encodeURIComponent(query):'')), identity(request)]);
  return { ...data, me };
}

function materialLabel(status?: string,started=true) {
  if(!started&&status==='unavailable')return '正文尚未解析';
  return status === "ready" ? "正文已解析" : status === "parsing" ? "正文解析中" : status === "failed" ? "正文解析失败" : status === "unavailable" ? "正文暂不可用" : "正文待解析";
}

function digestLabel(status?: string) {
  return status === "ready" ? "AI 解读已生成" : status === "generating" ? "AI 解读生成中" : status === "failed" ? "AI 解读失败" : status === "unavailable" ? "AI 解读尚未生成" : "AI 解读等待处理";
}

type EvidenceProps = { blocks: PaperBlock[]; numbers: Map<string, number>; onEvidence: (block: PaperBlock) => void;onNote?:(target:NoteTarget)=>void };
function Citations({ claim, blocks, numbers, onEvidence }: EvidenceProps & { claim: PaperDigestClaim }) {
  if (claim.support === "not_stated") return <span className="pp-evidence-missing">原文未明确说明</span>;
  return <sup className="pp-citations">{claim.evidence_block_ids.map(id => {
    const block = blocks.find(item => item.id === id); const number = numbers.get(id);
    return block && number ? <button key={id} className="pp-citation" title={`引用 ${number}${block.page ? ` · PDF 第 ${block.page} 页` : ""}`}
      aria-label={`引用 ${number}${block.page ? `，查看原文第 ${block.page} 页` : "，查看原文"}`} onClick={() => onEvidence(block)}>[{number}]</button>
      : <span key={id} className="pp-evidence-missing">出处缺失</span>;
  })}</sup>;
}

function Claim({claim,illustrations,...evidence}:EvidenceProps&{claim:PaperDigestClaim;illustrations:PaperIllustration[]}){
  return <div id={'claim-'+claim.id} className="pp-noteable-claim">{(!illustrations.length||illustrations.some(i=>i.explanation!==claim.text))&&<p className="pp-digest-paragraph">{claim.text}<Citations claim={claim} {...evidence}/>{evidence.onNote&&<button type="button" className="pp-note-inline" aria-label="为这段解读记一笔" onClick={()=>evidence.onNote?.({kind:'claim',targetId:claim.id})}>记一笔</button>}</p>}
    {illustrations.map(illustration=><Illustration key={illustration.block_id} claim={claim} illustration={illustration} {...evidence}/>)}</div>;
}
function Illustration({ claim, illustration, ...evidence }: EvidenceProps & { claim: PaperDigestClaim; illustration: PaperIllustration }) {
  const block = illustration && evidence.blocks.find(block => block.id === illustration.block_id);
  const separateExplanation = illustration?.explanation !== claim.text;
  return <>
    {illustration && block && <figure id={'figure-'+illustration.block_id} className="pp-article-figure">
      <PdfCrop block={illustration.bbox ? { ...block, bbox: illustration.bbox } : block} title={illustration.title} onOpen={() => evidence.onEvidence(block)}/>
      <figcaption><div className="pp-figure-heading"><strong>{illustration.title}</strong><button onClick={() => evidence.onEvidence(block)}>查看原文 · 第 {block.page} 页 ↗</button></div>
        <div className="pp-figure-note-row"><p className="pp-muted">{illustration.input_basis==='vision'?'已结合原图独立核查':'依据图注、表格文本和正文解读'}</p>{evidence.onNote&&<button type="button" className="pp-note-inline" aria-label={'为图表「'+illustration.title+'」记一笔'} onClick={()=>evidence.onNote?.({kind:'figure',targetId:illustration.block_id})}>记一笔</button>}</div>
        {illustration.visual_reading&&<details className="pp-figure-caption"><summary>查看图像观察与不确定之处</summary><ul>{illustration.visual_reading.observations.map((text,i)=><li key={i}>{text}</li>)}</ul>
          {!!illustration.visual_reading.text_context?.length&&<><strong>图注与正文补充</strong><ul>{illustration.visual_reading.text_context.map((text,i)=><li key={i}>{text}</li>)}</ul></>}
          {illustration.visual_reading.unreadable.length>0&&<><strong>无法从原图确认</strong><ul>{illustration.visual_reading.unreadable.map((text,i)=><li key={i}>{text}</li>)}</ul></>}
          {illustration.visual_reading.conflicts.length>0&&<><strong>图文需要对照的差异</strong><ul>{illustration.visual_reading.conflicts.map((text,i)=><li key={i}>{text}</li>)}</ul></>}
        </details>}
        {illustration.reading_guide ? <dl className="pp-figure-guide">
          <div><dt>怎么看</dt><dd>{illustration.reading_guide}</dd></div>
          <div><dt>说明什么</dt><dd>{illustration.takeaway}</dd></div>
          <div><dt>需要注意</dt><dd>{illustration.caveat}</dd></div>
        </dl> : <p>{illustration.explanation}{!separateExplanation && <Citations claim={claim} {...evidence}/>}</p>}
        {illustration.reading_guide && <p><Citations claim={{ ...claim, evidence_block_ids: illustration.evidence_block_ids ?? [block.id] }} {...evidence}/></p>}
        {illustration.selection_reason && <details className="pp-figure-caption"><summary>为什么选这张图</summary><p>{illustration.selection_reason}</p></details>}
        {block.caption && <details className="pp-figure-caption"><summary>原文图注</summary><p>{block.caption}</p></details>}
      </figcaption>
    </figure>}
  </>;
}

export default function Detail() {
  const { paper, material, digest, notes=[],note_context,illustrations = [], illustration_status, illustration_error, illustration_mode='text',illustration_upgrade_available=false,reading_task, me,versions=[],viewing_version_id,is_current_version=true } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const { write, busy, error, setError } = useWrite(me.csrf);
  const [tab, setTab] = useState("digest");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pdfFocus,setPdfFocus]=useState<import('./pdf.tsx').PdfFocus>({page:1,key:0});
  const [notesOpen,setNotesOpen]=useState(false);const notesRef=useRef<ReadingNotesHandle>(null),notesButton=useRef<HTMLButtonElement>(null),noteTrigger=useRef<HTMLElement|null>(null);
  const openNote=(target:NoteTarget)=>{noteTrigger.current=document.activeElement as HTMLElement;notesRef.current?.open(target);};
  const closeNotes=()=>{setNotesOpen(false);(noteTrigger.current?.isConnected?noteTrigger.current:notesButton.current)?.focus({preventScroll:true});};
  const detailPage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = detailPage.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    let visible = false;
    let elapsed = 0;
    let previous = performance.now();
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
    observer.observe(target);
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (visible && document.visibilityState === "visible") elapsed += now - previous;
      previous = now;
      if (elapsed >= 30_000) {
        recordWeeklyReading(paper.id);
        window.clearInterval(timer);
        observer.disconnect();
      }
    }, 500);
    return () => { window.clearInterval(timer); observer.disconnect(); };
  }, [paper.id]);
  useEffect(() => { const n = Number(new URLSearchParams(window.location.search).get("page")),initial=Number.isInteger(n)&&n>=1&&n<=10000?n:1; setPageCount(0);setPage(initial);setPdfFocus(current=>({page:initial,key:current.key+1}));if (Number.isInteger(n) && n >= 1 && n <= 10000) setTab("original"); }, [paper.id,viewing_version_id]);
  useEffect(() => {
    const materialBusy = material?.status === "queued" || material?.status === "parsing";
    const digestBusy = digest?.status === "queued" || digest?.status === "generating";
    const readingBusy=reading_task?.status==="queued"||reading_task?.status==="running"||reading_task?.status==="waiting";
    const illustrationBusy = illustration_status === "queued" || illustration_status === "generating";
    if (!is_current_version||(!materialBusy && !digestBusy && !readingBusy && !illustrationBusy)) return;
    const timer = window.setInterval(() => revalidator.revalidate(), 4000);
    return () => window.clearInterval(timer);
  }, [digest?.status, material?.status, reading_task?.status, illustration_status, is_current_version,viewing_version_id,revalidator]);
  const pdfUrl = `/api/admin/papers/${paper.id}/pdf`+(viewing_version_id?'?version='+encodeURIComponent(viewing_version_id):'');
  const pdf = `${pdfUrl}#page=${page}`;
  const blocks = material?.blocks ?? [];
  const numbers = citationNumbers(digest?.sections ?? [], blocks, illustrations);
  const canParse = paper.has_pdf || !!paper.metadata?.openalex_id || /^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i.test(paper.source_url);
  const taskBusy = !is_current_version|| (reading_task ? ["queued","running","waiting"].includes(reading_task.status)
    : material?.status === "queued" || material?.status === "parsing" || digest?.status === "queued" || digest?.status === "generating");
  const generate = async () => { setError(""); if (await write(`/api/admin/papers/${paper.id}/digest`, "POST", {versionId:paper.active_version_id??undefined})) revalidator.revalidate(); };
  const parse = async () => { setError(""); if (await write(`/api/admin/papers/${paper.id}/material`, "POST", {versionId:paper.active_version_id??undefined})) revalidator.revalidate(); };
  const showEvidence = (block: PaperBlock) => { const n=block.page||1;setPage(n);setPdfFocus(current=>({page:n,key:current.key+1,block}));setTab("original"); window.setTimeout(() => document.getElementById("paper-resources")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };
  return <div className="pp-page" ref={detailPage}>
    <PaperBackLink/>
    <VersionManager paper={paper} versions={versions} viewing={viewing_version_id} current={is_current_version} csrf={me.csrf}/>
    <CollectionActions paper={paper} csrf={me.csrf} edit allowRead={is_current_version}/>
    <PaperMetadataDetails paper={paper}/>
    <div className="pp-detail-heading"><span className="pp-tag">{paper.topic || "未分类"}</span><PaperHeading paper={paper} detail/><p>{paper.authors || "作者未标注"}</p>{paper.summary_zh && <PaperSummary paper={paper}/>}<div className="pp-card-meta"><span>{publicationLabel(paper)}</span><span>{paper.version}</span><span className="pp-chip">{materialLabel(material?.status, !!reading_task)}</span><span className="pp-chip">{digestLabel(digest?.status ?? paper.digest_status)}</span><label>阅读状态 <select aria-label="阅读状态" value={paper.status} disabled={busy} onChange={async e => { if (await write(`/api/admin/papers/${paper.id}/status`, "PATCH", { status: e.target.value })) revalidator.revalidate(); }}>{Object.entries(statusLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>{paper.source_url.startsWith("http") && <a href={paper.source_url} target="_blank" rel="noreferrer">来源 ↗</a>}</div></div>
    <PdfDocumentProvider key={pdfUrl} url={pdfUrl} enabled={paper.has_pdf && (tab === "original" || illustrations.length > 0)}>
    <div className={'pp-reading '+(notesOpen&&tab==='digest'?'pp-reading-with-notes':'pp-reading-single')}><section id="paper-resources" className="pp-resource pp-panel"><nav className="pp-tabs" aria-label="论文资料">{[["digest", "AI 解读"], ["original", "原文"], ["code", "代码与资源"]].map(([v, l]) => <button key={v} aria-pressed={tab === v} onClick={() => {setTab(v);if(v!=='digest'){notesRef.current?.flush();setNotesOpen(false);}}}>{l}</button>)}{tab==='digest'&&<button ref={notesButton} className="pp-notes-toggle" aria-expanded={notesOpen} onClick={()=>{if(notesOpen){notesRef.current?.flush();closeNotes();}else openNote({kind:'paper'});}}>我的笔记</button>}</nav>
      {tab === "digest" && <div className="pp-resource-body pp-digest">
        <ReviewRepairPanel paper={paper} task={reading_task} blocks={blocks} current={is_current_version} csrf={me.csrf} onEvidence={showEvidence}/>
        <ReadingProgress task={reading_task} busy={busy||!is_current_version} canReread={is_current_version&&material?.status==="ready"} onResume={material?.status==="ready"?generate:parse} onReread={async()=>{
          if(await write(`/api/admin/papers/${paper.id}/digest`,"POST",{reread:true,versionId:paper.active_version_id??undefined}))revalidator.revalidate();
        }}/>
        <VisualBodyReviewPanel task={reading_task} blocks={blocks} onEvidence={showEvidence}/>
        <div className="pp-overview-head"><div><p className="pp-eyebrow">PAPER PULSE · READING</p><h2>这篇论文讲了什么</h2><p className="pp-muted">从研究问题到实验结论，点按文中序号可查看原文。</p></div><span className="pp-status-pill">{digestLabel(digest?.status ?? paper.digest_status)}</span></div>
        {digest?.status === "ready" ? <article className="pp-digest-sections" aria-label="论文解读正文">{digest.sections.map(section => <section className="pp-digest-section" key={section.id}><h3>{section.title}</h3>{section.claims.map(claim => <Claim key={claim.id} claim={claim} blocks={blocks} numbers={numbers} onEvidence={showEvidence} onNote={note_context?openNote:undefined} illustrations={illustrations.filter(item => item.after_claim_id === claim.id)}/>)}</section>)}</article> : <div className="pp-digest-empty"><h3>{digestLabel(digest?.status ?? paper.digest_status)}</h3><p>{material?.status === "ready" ? "正文已经准备好，可以生成一份带证据回跳的结构化解读。" : material?.status === "parsing" ? "正文正在解析，完成后会自动进入 AI 解读流程。" : "先解析正文，模型才会基于完整论文而不是摘要生成解读。"}</p><button className="pp-button" disabled={busy || taskBusy || !!reading_task?.coverage?.reviewFailure || (!canParse && material?.status !== "ready")} onClick={material?.status === "ready" ? generate : parse}>{!is_current_version ? "切为当前版本后精读" : reading_task?.coverage?.reviewFailure ? "请先处理上方核查问题" : busy || taskBusy ? "等待处理…" : material?.status === "ready" ? "生成 AI 解读" : material?.status === "parsing" ? "解析中…" : canParse ? "解析正文" : "暂无可解析原文"}</button></div>}
        {numbers.size > 0 && <details className="pp-article-sources"><summary>原文引用（{numbers.size}）</summary><ol>{[...numbers].map(([id, number]) => {
          const block = blocks.find(block => block.id === id)!;
          return <li key={id}><button onClick={() => showEvidence(block)}>[{number}] {block.page ? `PDF 第 ${block.page} 页` : "原文"} · {block.caption || block.section_path.join(" / ") || "正文段落"}</button></li>;
        })}</ol></details>}
        {is_current_version && digest?.status === "ready" && paper.has_pdf && <div className="pp-figure-task">
          {(illustration_status === "queued" || illustration_status === "generating") ? <span role="status">图表解读正在处理…{illustration_error && ` ${illustration_error}`}</span>
            : (illustration_status === "failed" || (material?.parser === "mineru_api" && (!illustrations.length || illustrations.some(item => !item.reading_guide)|| (illustration_mode==='vision'&&(illustration_upgrade_available||illustrations.some(item=>item.input_basis!=='vision')))))) && <><span>{illustration_error || (illustration_mode==='vision'?'可将已选图表的原图交给模型，补充并核查视觉解释。':'可自动挑选关键图表并补充解释。')}</span><button className="pp-text-button" disabled={busy||taskBusy} onClick={async () => {
              if (await write(`/api/admin/papers/${paper.id}/illustrations`, "POST", {versionId:paper.active_version_id??undefined})) revalidator.revalidate();
            }}>{illustration_status === "failed" ? "重试图表解读" : illustration_mode==='vision'&&illustrations.length ? "结合原图重新解读" : illustrations.length ? "优化图表解读" : "补充图表解读"}</button></>}
        </div>}
        {paper.abstract && <details className="pp-original-summary"><summary>查看论文原始摘要</summary><p className="pp-full-abstract">{paper.abstract}</p></details>}
        <div className="pp-boundary"><strong>可追溯边界</strong><span>解析器：{material?.parser || "尚未运行"} · 证据块：{blocks.length} · {materialLabel(material?.status, !!reading_task)}</span>{material?.error && <span className="pp-error">{material.error}</span>}{digest?.error && <span className="pp-error" role="status">{digest.error}</span>}{error && <span className="pp-error">{error}</span>}</div>
      </div>}
      {tab === "original" && <div className="pp-resource-body"><div className="pp-pdf-toolbar"><label>PDF 页码 <input aria-label="PDF 页码" type="number" min={1} max={pageCount || 10000} value={page} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= (pageCount||10000)){setPage(n);setPdfFocus(current=>({page:n,key:current.key+1}));} }}/></label><span>{pageCount?`/ ${pageCount} 页 · 上下滚动阅读`:'上下滚动阅读'}</span>{paper.has_pdf && <a href={pdf} target="_blank" rel="noreferrer">独立窗口 ↗</a>}</div>{pdfFocus.block&&!pdfFocus.block.page&&<p className="pp-pdf-hint">该引用缺少PDF页码，无法在原图中精确定位。</p>}{pdfFocus.block&&<details className="pp-source-excerpt"><summary>查看关联原文片段</summary><p>{pdfFocus.block.text||pdfFocus.block.caption}</p></details>}{paper.has_pdf ? <PdfReader target={pdfFocus} onCount={setPageCount} onPage={setPage} reliableBoxes={material?.parser==='mineru_api'}/> : <div className="pp-empty"><p>这篇论文尚未上传本地 PDF。</p>{(paper.pdf_url || paper.source_url.startsWith("http")) && <a className="pp-button" href={paper.pdf_url || paper.source_url} target="_blank" rel="noreferrer">打开外部原文 ↗</a>}</div>}<p className="pp-pdf-hint">上下滚动可连续阅读；点击解读引用会定位并以黄色标出对应原文段落。缺少可靠坐标时仅定位到页，不猜测句子位置。</p></div>}
      {tab === "code" && <div className="pp-resource-body"><h2>代码与资源</h2>{paper.code_url ? <a className="pp-code-link" href={paper.code_url} target="_blank" rel="noreferrer">{paper.code_url} ↗</a> : <p>这篇论文尚未关联代码仓库。</p>}<dl className="pp-resource-facts"><div><dt>来源</dt><dd>{paper.source_url || "未记录"}</dd></div><div><dt>PDF</dt><dd>{paper.has_pdf ? "已保存本地副本" : "未保存本地副本"}</dd></div><div><dt>版本</dt><dd>{paper.version || "未标注"}</dd></div></dl></div>}
    </section><ReadingNotes key={paper.id+':'+viewing_version_id} ref={notesRef} paper={paper} viewingVersionId={viewing_version_id} notes={notes} context={note_context} digest={digest} blocks={blocks} figures={illustrations} csrf={me.csrf} adminName={me.name} open={notesOpen&&tab==='digest'} onOpen={()=>setNotesOpen(true)} onClose={closeNotes} onEvidence={showEvidence}/></div></PdfDocumentProvider>
  </div>;
}
