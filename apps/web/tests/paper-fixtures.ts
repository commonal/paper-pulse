import type {DailyReadingStatus} from '../../../modules/papers/types.ts';
import {DIRECTIONS,HOT_DIRECTION,defaultPreferences,type DiscoveryPlan} from '../../../modules/papers/directions.ts';

export function planFixtures():DiscoveryPlan[]{
  return [{...HOT_DIRECTION,kind:'hot' as const,enabled:true},...DIRECTIONS.map(d=>({...d,kind:'personal' as const,enabled:d.id==='personal-rag'}))]
    .map(d=>({id:d.id,title:d.title,kind:d.kind,enabled:d.enabled,categories:d.categories,keywords:[],preferences:defaultPreferences(),updated_at:''}));
}

export function dailyFixture():DailyReadingStatus{
  return {date:'2026-10-08',enabled:true,activePlans:4,dailyLimit:3,time:'06:00',timezone:'Asia/Shanghai',
    nextRunAt:'2026-10-08T22:00:00.000Z',lastRun:{started_at:'2026-10-07T22:00:00.000Z',finished_at:'2026-10-07T22:01:00.000Z',status:'ok'},
    lastSuccessAt:'2026-10-07T22:01:00.000Z',state:'empty',
    counts:{selected:0,readable:0,completed:0,processing:0,waiting:0,failed:0,notStarted:0,budgetWaiting:0}};
}
