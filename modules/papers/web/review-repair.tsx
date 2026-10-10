import {useState} from 'react';
import {useRevalidator} from 'react-router';
import type {Paper,PaperBlock,PaperReadingTask} from '../types.ts';
import {reviewProblems,type ReviewFailure} from '../review.ts';
import {useWrite} from './shared.tsx';

export function ReviewRepairPanel({paper,task,blocks,current,csrf,onEvidence}:{paper:Paper;task:PaperReadingTask|null|undefined;blocks:PaperBlock[];current:boolean;csrf:string;onEvidence:(block:PaperBlock)=>void}){
  const failure=task?.coverage?.reviewFailure as ReviewFailure|undefined;
  return failure?<RepairCase key={`${failure.receiptId}:${failure.inputSignature}`} {...{paper,task,blocks,current,csrf,onEvidence}} failure={failure}/>:null;
}
function RepairCase({paper,task,blocks,current,csrf,onEvidence,failure}:{paper:Paper;task:PaperReadingTask|null|undefined;blocks:PaperBlock[];current:boolean;csrf:string;onEvidence:(block:PaperBlock)=>void;failure:ReviewFailure}){
  const {write,busy,error}=useWrite(csrf),revalidator=useRevalidator();
  const [notes,setNotes]=useState<Record<string,string>>(()=>Object.fromEntries((task?.options.reviewRepair?.inputSignature===failure.inputSignature?task.options.reviewRepair.instructions:[]).map(i=>[i.claimId,i.text]))),[submitted,setSubmitted]=useState(false);
  const problems=reviewProblems(failure),canRepair=current&&task?.status==='failed'&&task.stage==='review'&&paper.active_version_id===failure.versionId;
  return <section className="pp-review-repair" aria-label="核查问题与修订">
    <h3>核查问题与修订</h3>
    <p className="pp-muted">以下内容尚未通过核查，没有发布。修订复用已解析正文与初稿，只处理问题项，再独立对照原文；通过后继续图表解读。已有文章保留。</p>
    {problems.map((problem,index)=><details key={problem.claim.id} open={problems.length===1}>
      <summary>{index+1}. {problem.section} · {problem.messages[0]}</summary>
      <p><strong>待修订文字：</strong>{problem.claim.text}</p>
      {problem.reviewVerdict&&<p className="pp-muted">文字证据标记：{({direct:'原文直接支持',synthesis:'综合原文推断',not_stated:'原文未说明'})[problem.claim.support]} · 核查判断：{({supported:'有原文支撑',corrected:'已纠正',not_stated:'原文未说明'})[problem.reviewVerdict]}</p>}
      <ul>{problem.messages.map((message,i)=><li key={i}>{message}</li>)}</ul>
      {problem.reviewReason&&<p><strong>核查说明：</strong>{problem.reviewReason}</p>}
      <div className="pp-review-evidence">{problem.blockIds.flatMap(id=>{const block=blocks.find(b=>b.id===id);return block?[<details key={id}><summary>对应原文 · {block.page?`PDF 第 ${block.page} 页`:'页码未知'} · {block.section_path.join(' / ')||'正文'}</summary>
        <p>{block.text||block.caption}</p>{block.caption&&block.caption!==block.text&&<p>{block.caption}</p>}<button type="button" className="pp-text-button" onClick={()=>onEvidence(block)}>查看原文{block.page?`第 ${block.page} 页`:''} ↗</button></details>]:[];})}</div>
      <label>修订建议（可选）<textarea aria-label={`核查项 ${index+1} 修订建议`} value={notes[problem.claim.id]??''} maxLength={2000} rows={3} disabled={!canRepair||busy||submitted} placeholder="可填写建议的新表述、需要补足的条件，或指出具体原文。留空则按原文自动修订。" onChange={e=>setNotes({...notes,[problem.claim.id]:e.target.value})}/></label>
    </details>)}
    {canRepair&&<button type="button" className="pp-button secondary" disabled={busy||submitted} onClick={async()=>{
      const result=await write(`/api/admin/papers/${paper.id}/review-repair`,'POST',{versionId:paper.active_version_id,receiptId:failure.receiptId,inputSignature:failure.inputSignature,
        instructions:Object.entries(notes).filter(([,text])=>text.trim()).map(([claimId,text])=>({claimId,text:text.trim()}))});
      if(result){setSubmitted(true);revalidator.revalidate();}
    }}>{busy?'提交中…':submitted?'修订已排队':'修订并继续核查'}</button>}
    {!current&&<p className="pp-muted">历史版本仅供查看；修订前请先设为当前版本。</p>}
    {current&&task?.status==='waiting'&&<p className="pp-muted">修订等待恢复，已有输入与回执保留，可从处理进度继续。</p>}
    {current&&['queued','running'].includes(task?.status??'')&&<p role="status">修订或核查正在处理，完成后自动更新。</p>}
    {error&&<p role="alert" className="pp-error">{error}</p>}
  </section>;
}
