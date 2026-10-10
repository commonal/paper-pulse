import test from 'node:test';
import assert from 'node:assert/strict';
import {visualReadingSchema,illustrationPlanSchema,visualPlanSchema,visualReviewSchema,bodyCheckSchema} from '../backend/illustration-plan.ts';

test('BERT流程图的八条完整观察不会仅因排版条数被拒绝，也不截掉观察',()=>{
  const observations=['预训练框','预训练输入','预训练输出','微调框','微调输入','微调输出','参数传递箭头','下游任务标签'];
  const result=visualReadingSchema.parse({kind:'diagram',observations,unreadable:[],conflicts:[]});
  assert.deepEqual(result.observations,observations);
});
test('图表选择和核查接收六张、拒绝七张，正文核查可绑定六张，零张须有原因',()=>{
  const selections=Array.from({length:6},(_,i)=>({block_id:'f'+i,after_claim_id:'m1',title:'方法图',selection_reason:'展示方法',
    reading_guide:'按箭头阅读',takeaway:'解释流程',caveat:'不是实验结果',evidence_block_ids:['f'+i],
    visual_reading:{kind:'diagram',observations:['原图中可见流程箭头'],unreadable:[],conflicts:[]}}));
  const plan={selections,reason:'覆盖方法、结果与消融，不凑数'};
  const checks=selections.map(s=>({block_id:s.block_id,verdict:'supported',reason:'原图与正文一致',quote_ids:[s.block_id+':caption:0'],visual_consistent:true,visual_reason:'已看图'}));
  assert(illustrationPlanSchema.safeParse(plan).success);assert(visualPlanSchema.safeParse(plan).success);
  assert(visualReviewSchema.safeParse({publishable:true,blockers:[],checks,final:plan}).success);
  const seven={...plan,selections:[...selections,{...selections[0],block_id:'f6'}]};
  assert.equal(illustrationPlanSchema.safeParse(seven).success,false);assert.equal(visualPlanSchema.safeParse(seven).success,false);
  assert(bodyCheckSchema.safeParse({claim_id:'m1',verdict:'consistent',figure_ids:selections.map(s=>s.block_id),reason:'这些原图均支持该主张'}).success);
  assert(illustrationPlanSchema.safeParse({selections:[],reason:'没有可可靠定位的关键图表'}).success);
  assert.equal(illustrationPlanSchema.safeParse({selections:[],reason:''}).success,false);
});
test('观察仍须非空且逐条限制长度，不用排版条数代替事实核查',()=>{
  for(const observations of [[],[''],['x'.repeat(351)]]){
    assert.equal(visualReadingSchema.safeParse({kind:'diagram',observations,unreadable:[],conflicts:[]}).success,false);
  }
  assert.equal(visualReadingSchema.parse({kind:'table',observations:Array(14).fill('观察'),unreadable:[],conflicts:[]}).observations.length,14);
});
