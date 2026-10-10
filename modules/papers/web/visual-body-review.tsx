import type {PaperReadingTask,PaperBlock} from '../types.ts';

export function VisualBodyReviewPanel({task,blocks,onEvidence}:{task:PaperReadingTask|null|undefined;blocks:PaperBlock[];onEvidence:(block:PaperBlock)=>void}){
  const state=task?.coverage?.visualBodyReview;if(!state)return null;
  const done=state.status==='completed',conflicts=state.changes;
  return <details className="pp-reading-progress" open={!done&&conflicts.length>0}>
    <summary>{done?(conflicts.length?`图文闭环已完成 · 修订 ${conflicts.length} 处正文`:'已对照关键原图核查正文'):state.status==='failed'?'图文修订未完成':conflicts.length?'正在修订图文冲突':'正在核查正文与原图'}</summary>
    <p className="pp-muted">只对本次选中的原图检查；没有对应图像或看不清的内容不算已验证。</p>
    {state.error&&<p role="status">{state.error}</p>}
    {conflicts.map(change=><div key={change.claimId}>
      <p><a href={'#claim-'+change.claimId}>定位正文段落 ↗</a> · {change.reason}</p>
      <p>原文字：{change.before}</p>
      {change.after&&<p>{done?'已保存修订':'待核查修订'}：{change.after}</p>}
      {change.figureIds.map(id=>{const block=blocks.find(b=>b.id===id);return block?<button key={id} className="pp-text-button" onClick={()=>onEvidence(block)}>查看对应原图 · 第 {block.page} 页 ↗</button>:null;})}
    </div>)}
    {!conflicts.length&&<p>本次未发现明确图文矛盾；{state.checks.filter(c=>c.verdict==='not_assessable').length} 条主张无法由选中的原图判定。</p>}
  </details>;
}
