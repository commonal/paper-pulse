import type {Paper,DailyReadingStatus} from './types.ts';

export const DAILY_DISCOVERY={time:'06:00',cron:'0 6 * * *',timezone:'Asia/Shanghai'} as const;
export const DAILY_MAX_PDF_PAGES=30;
export function readingDate(now:Date){
  return new Intl.DateTimeFormat('en-CA',{timeZone:DAILY_DISCOVERY.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function discoveryTime(date:string){return new Date(`${date}T${DAILY_DISCOVERY.time}:00+08:00`);}
export function nextDiscoveryTime(now:Date){
  const today=discoveryTime(readingDate(now));
  return new Date(today.getTime()+(now>=today?24*60*60*1000:0)).toISOString();
}
export function dailyCounts(papers:Paper[],waitingErrors:Map<string,string>){
  const counts={selected:papers.length,readable:0,completed:0,processing:0,waiting:0,failed:0,notStarted:0,budgetWaiting:0};
  for(const paper of papers){
    if(paper.digest_status==='ready')counts.readable++;
    if(paper.reading_status==='ready'&&paper.digest_status==='ready')counts.completed++;
    else if(paper.reading_status==='waiting'){
      counts.waiting++;
      if(waitingErrors.get(paper.id)?.includes('服务请求预算暂时不足'))counts.budgetWaiting++;
    }else if(paper.reading_status==='failed'||paper.reading_status==='unavailable')counts.failed++;
    else if(paper.reading_status==='queued'||paper.reading_status==='running'||paper.parse_status==='queued'||paper.parse_status==='parsing'||paper.digest_status==='queued'||paper.digest_status==='generating')counts.processing++;
    else if(paper.parse_status==='failed'||paper.digest_status==='failed')counts.failed++;
    else if(paper.digest_status!=='ready')counts.notStarted++;
  }
  return counts;
}
export function dailyState(status:Omit<DailyReadingStatus,'state'>,now:Date):DailyReadingStatus['state']{
  if(!status.enabled)return 'disabled';
  if(status.activePlans===0)return 'paused';
  const todayRun=status.lastRun&&readingDate(new Date(status.lastRun.started_at))===status.date?status.lastRun:null;
  if(todayRun?.status==='running')return 'discovering';
  if(status.counts.selected){
    if(status.counts.failed||status.counts.notStarted)return 'incomplete';
    if(status.counts.waiting)return 'waiting';
    if(status.counts.processing)return 'processing';
    return 'ready';
  }
  if(status.discovery?.status==='waiting')return 'discovery_waiting';
  if(status.discovery?.status==='failed'||todayRun?.status==='failed')return 'discovery_failed';
  if(todayRun?.status==='ok')return 'empty';
  return now<discoveryTime(status.date)?'scheduled':'overdue';
}

export function dailyMessage(status:DailyReadingStatus){
  const messages={
    disabled:{title:'自动更新尚未开启',description:'后台尚未注册每日检索任务。可以先回看已精读论文，开启自动更新后将在每天 06:00 开始检索。'},
    paused:{title:'关注方向已暂停',description:'目前没有启用的检索方向，请到关注与检索设置中启用需要的方向。'},
    scheduled:{title:'尚未到更新时间',description:'每天北京时间 06:00 开始检索，入选论文的精读会随后陆续完成。'},
    overdue:{title:'今日尚未更新',description:'已到今日更新时间，但尚无今天的检索完成记录。请确认后台服务正在运行；可先回看已精读论文。'},
    discovering:{title:'正在检索今日论文',description:'后台正在检索关注方向并选取论文，精读将在入选后继续处理。'},
    discovery_failed:{title:'今日检索未成功完成',description:'本次检索执行失败，已保存的论文与解读仍可阅读。请检查后台检索任务，再决定是否重试。'},
    discovery_waiting:{title:'今日检索等待恢复',description:'外部信源暂时限流或不可达，后台已保存进度并将延迟重试；仍符合时效与关注规则的已有候选可继续入选。'},
    empty:{title:'今日没有新的入选论文',description:'今日检索已完成，没有新的论文进入阅读队列。可能没有符合条件的候选，或近期已推荐过；今日配额允许留空。'},
    processing:{title:'今日论文正在精读',description:'入选论文正在解析、精读、核查或生成图表解释，可先打开已经可读的解读。'},
    waiting:{title:'部分论文等待继续处理',description:status.counts.budgetWaiting?`${status.counts.budgetWaiting} 篇因服务请求预算不足等待额度恢复；后台每五分钟检查恢复条件。其他等待原因可进入论文查看。`:'任务正在等待恢复，具体原因可进入论文查看；后台每五分钟检查恢复条件。'},
    incomplete:{title:'部分论文尚未完成',description:'有论文处理失败、暂不可用或尚未开始，可进入论文查看具体原因并继续处理；已生成的解读仍可阅读。'},
    ready:{title:'今日论文已可阅读',description:'今日入选论文的解读已可阅读，点击下方论文即可查看。'},
  };
  return messages[status.state];
}
