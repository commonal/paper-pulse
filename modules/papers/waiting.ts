import type {ReadingStage,ReadingWaitInfo,RequestBudgetSnapshot} from './types.ts';

export function requestBudget(service:string,limits:{per_minute:number;per_hour:number;per_day:number},attempts:Date[],now=new Date()):RequestBudgetSnapshot{
  const durations={minute:60000,hour:3600000,day:86400000};
  let next=now.getTime(),blocked=false,stopped=false;
  const windows=([['minute','每分钟',limits.per_minute],['hour','每小时',limits.per_hour],['day','滚动24小时',limits.per_day]] as const).map(([name,label,limit])=>{
    const starts=attempts.map(d=>d.getTime()).filter(t=>t>now.getTime()-durations[name]).sort((a,b)=>a-b);
    if(limit<=0){blocked=true;stopped=true;}
    else if(starts.length>=limit){blocked=true;next=Math.max(next,starts[starts.length-limit]!+durations[name]);}
    return {name,label,limit,used:starts.length};
  });
  return {service,windows,blocked,stopped,nextAvailableAt:blocked&&!stopped?new Date(next).toISOString():null};
}
export function nextRecoveryAt(now:Date,availableAt?:string|null){
  return new Date(Math.ceil(Math.max(now.getTime()+1,availableAt?new Date(availableAt).getTime():0)/300000)*300000).toISOString();
}
export function readingWait(error:string|null|undefined,stage:ReadingStage|undefined,budget:RequestBudgetSnapshot|undefined,now=new Date()):ReadingWaitInfo{
  if(error?.includes('预算')){
    const limiting=budget?.windows.filter(w=>w.limit<=0||w.used>=w.limit);
    const label=budget?.service==='mineru'?'正文解析':'模型请求';
    const title=budget?.stopped?`${label}额度已停用`:budget&&!budget.blocked?'额度已恢复，等待调度继续':`${label}额度等待`;
    const detail=budget?.stopped?'服务请求上限设为零，需要调整服务配置。':limiting?.length?limiting.map(w=>`${w.label}已用 ${w.used}/${w.limit}`).join('；'):'系统每五分钟检查一次并继续已保存的阶段。';
    return {kind:'budget',title,detail,nextRetryAt:budget?.stopped?null:nextRecoveryAt(now,budget?.nextAvailableAt),...(budget?{budget}:{})};
  }
  if(error?.includes('模型调用未启用'))return {kind:'model_disabled',title:'模型服务未启用',detail:'启用模型服务后，恢复任务会继续当前阶段。',nextRetryAt:null};
  if(error?.includes('结果尚未取回'))return {kind:'receipt_unknown',title:'等待请求回执',detail:'请求已发出，正在等待结果确认；不会重复发送同一请求。',nextRetryAt:null};
  if(error?.includes('同一请求正在执行'))return {kind:'receipt_busy',title:'已有请求执行中',detail:'等待当前请求保存结果后继续。',nextRetryAt:nextRecoveryAt(now)};
  return {kind:'interrupted',title:'任务中断，等待继续',detail:`${stage==='material'?'正文解析':'阅读处理'}任务等待恢复调度，将从已保存阶段继续。`,nextRetryAt:nextRecoveryAt(now)};
}
