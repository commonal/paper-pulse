import type {Paper} from '../types.ts';
export function publicationLabel(paper:Paper){
  return paper.metadata?.date_precision==='year'?String(paper.metadata.publication_year??'年份未知'):paper.published?.slice(0,10)||'日期未标注';
}
export function PaperMetadataDetails({paper}:{paper:Paper}){
  const meta=paper.metadata;
  return <details className="pp-impact-note"><summary>论文元信息</summary><dl>
    {meta?.metadata_source_url&&<><dt>元信息出处</dt><dd><a href={meta.metadata_source_url} target="_blank" rel="noreferrer">{meta.source==='crossref'?'Crossref 登记记录':meta.source==='arxiv'?'arXiv 元数据':'来源记录'} ↗</a></dd></>}
    {meta?.identity_status&&<><dt>身份核验</dt><dd>{{matched:'已自动对照匹配',record_found:'登记记录已查询，尚未核验 PDF',user_confirmed:'候选记录由使用者选定',unverified:'身份待核验',user_modified:'核验后经过手动修改'}[meta.identity_status]}{meta.identity_checked_at?' · '+new Date(meta.identity_checked_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):''}{meta.identity_checks?.map((check,i)=><p key={i}>{check}</p>)}</dd></>}
    <dt>标识符</dt><dd>{paper.doi?'DOI：'+paper.doi:'DOI 待补全'}{paper.arxiv_id?' · arXiv：'+paper.arxiv_id:''}{meta?.openalex_id?' · OpenAlex：'+meta.openalex_id:''}</dd>
    <dt>发表来源</dt><dd>{meta?.venue_name||'待补全'}{meta?.ccf_rank?' · CCF '+meta.ccf_rank+' 来源名称匹配（单篇类型待核验）':''}</dd>
    {meta?.ccf_catalog&&<><dt>目录口径</dt><dd>{meta.ccf_catalog}</dd></>}
    <dt>发表时间</dt><dd>{publicationLabel(paper)}{meta?.date_precision==='year'?'（仅展示年份）':''}</dd>
    {meta?.citation_count!=null&&<><dt>引用统计</dt><dd>OpenAlex {meta.citation_count.toLocaleString()} 次{meta.citation_updated_at?' · 更新于 '+new Date(meta.citation_updated_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):''}</dd></>}
    <dt>原文版本</dt><dd>{paper.version} · {paper.has_pdf?'已保存 PDF':'尚无本地 PDF'}</dd>
  </dl></details>;
}
