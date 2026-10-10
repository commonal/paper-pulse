import type { PaperReadingTask, ReadingStage, ReadingStatus,ReadingWaitInfo } from "../types.ts";

export const readingStageLabel: Record<ReadingStage,string> = {
  material:"正文解析",coverage:"正文覆盖检查",reading:"Skill 精读",review:"原文核查",illustrations:"图表解释",complete:"阅读处理完成",
};
export function readingStatusLabel(status?:ReadingStatus,stage?:ReadingStage,wait?:ReadingWaitInfo|null,error?:string|null) {
  if(!status||!stage)return "";
  if(status==="ready")return "阅读处理完成";
  if(status==="waiting")return `${readingStageLabel[stage]} · ${wait?.title??'等待恢复'}`;
  if(status==="failed")return `${readingStageLabel[stage]} · ${error?.includes('HTTP 429')?'供应商限流':error?.includes('供应商暂时不可用')?'供应商暂不可用':'未完成'}`;
  if(status==="unavailable")return `${readingStageLabel[stage]} · 暂不可用`;
  return `${readingStageLabel[stage]} · ${status==="running"?"处理中":"等待处理"}`;
}
const localTime=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export function ReadingWaitMessage({wait}:{wait:ReadingWaitInfo|null|undefined}){
  return wait?<p className="pp-reading-message" role="status">{wait.detail}{wait.nextRetryAt&&<> · 预计 {localTime(wait.nextRetryAt)}（北京时间）检查并继续，其他请求可能影响时间。</>}</p>:null;
}
export function ReadingProgress({ task, busy, canReread, onResume, onReread }: {task:PaperReadingTask|null|undefined;busy:boolean;canReread:boolean;onResume:()=>void;onReread:()=>void}) {
  const stages=["material","coverage","reading","review","illustrations"] as const;
  const index=task?.stage==="complete"?stages.length:stages.findIndex(stage=>stage===task?.stage);
  return <details className="pp-reading-progress" open={!!task&&task.status!=="ready"}>
    <summary>{task?readingStatusLabel(task.status,task.stage,task.wait,task.error):"阅读处理详情"}</summary>
    {task&&<>
      <ol>{stages.map((stage,i)=><li key={stage} data-state={i<index?"done":i===index?"current":"pending"}>{readingStageLabel[stage]}</li>)}</ol>
      {task.coverage?.cached_digest?<p>沿用已生成的解读；没有自动重新购买精读。</p>:typeof task.coverage?.included_blocks==="number"&&<p>本次覆盖 {task.coverage.included_blocks} 个正文材料块；超过输入上限会停止，不静默裁剪。</p>}
      <p className="pp-muted">状态更新：{localTime(task.updated_at)}（北京时间）</p>
      {task.wait?<ReadingWaitMessage wait={task.wait}/>:task.error&&<p className="pp-reading-message" role="status">{task.error}</p>}
      {["waiting","failed","unavailable"].includes(task.status)&&!(task.status==='failed'&&task.coverage?.reviewFailure)&&<button className="pp-text-button" disabled={busy} onClick={onResume}>继续处理</button>}
    </>}
    {canReread&&(!task||task.status==="ready")&&<button className="pp-text-button" disabled={busy} onClick={onReread}>重新精读这篇论文</button>}
    {canReread&&task?.status==='failed'&&!!task.coverage?.reviewFailure&&<button className="pp-text-button" disabled={busy} onClick={onReread}>放弃本次修订，重新精读</button>}
  </details>;
}
