import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeReadingRuns,type ReadingRun,type ReadingEvent,QUALITY_DIMENSIONS,failureCategory} from '../evaluation.ts';
import {visualReadingSchema} from '../backend/illustration-plan.ts';
import {qualityJudgeSchema,compileQualityResult,type QualityInput} from '../backend/quality-contract.ts';

const run=(id:string,patch:Partial<ReadingRun>={}):ReadingRun=>({run_id:id,paper_id:id,version_id:id,title:id,kind:'full',initial_observed:true,status:'ready',stage:'complete',cached_digest:false,started_at:'2026-10-10T00:00:00Z',updated_at:'2026-10-10T00:02:00Z',finished_at:'2026-10-10T00:02:00Z',error:null,receipt_id:1,...patch});
const event=(id:string,status:string,action='transition',stage='review'):ReadingEvent=>({id:1,run_id:id,stage,status,action,error:status==='failed'?'模型回答未通过解读结构校验':null,receipt_id:1,recorded_at:'2026-10-10T00:01:00Z'});
test('首次与恢复完成区分；旧记录、图表升级和未结算不伪造成功率',()=>{
  const runs=[run('first'),run('recovered'),run('waited'),run('failed',{status:'failed',stage:'review'}),run('waiting',{status:'waiting',stage:'reading',finished_at:null}),run('active',{status:'running',stage:'reading',finished_at:null}),run('old',{initial_observed:false}),run('figure',{kind:'illustrations'}),run('replaced',{status:'superseded'}),run('cached',{cached_digest:true})];
  const m=summarizeReadingRuns(runs,[event('recovered','failed'),event('recovered','queued','resume_manual'),event('waited','waiting'),event('waited','queued','resume_auto'),event('failed','failed')]);
  assert.deepEqual(m.firstPass,{numerator:2,denominator:5,percent:40});assert.deepEqual(m.completion,{numerator:4,denominator:5,percent:80});assert.equal(m.started,8);
  assert.equal(m.allStartedCompletion.denominator,8);assert.equal(m.recovered,1);assert.equal(m.waiting,1);assert.equal(m.active,1);assert.equal(m.figureOnly,1);assert.equal(m.legacy,1);assert.equal(m.cached,1);assert.equal(m.superseded,1);assert.equal(m.p95Seconds,120);
  assert.deepEqual(m.freshCompletion,{numerator:3,denominator:4,percent:75});
  assert.equal(m.failures[0]!.runs,2);
});
test('零样本显示未知而非100%；错误与材料不可用保留分母',()=>{
  assert.equal(summarizeReadingRuns([],[]).completion.percent,null);
  const m=summarizeReadingRuns([run('bad',{status:'unavailable',stage:'material'})],[event('bad','unavailable','transition','material')]);
  assert.equal(m.completion.percent,0);assert.equal(m.failed,1);
});
test('结构校验回执已保留不误归类为请求结果未知',()=>{
  assert.equal(failureCategory('模型回答未通过解读结构校验：字段 observations 超过上限12。失败回执已保留'),'结构或引用校验');
});
test('完整表格的14条短观察应进入独立视觉核查，不被排版条数拒绝',()=>{
  const data={kind:'table',observations:Array.from({length:14},(_,i)=>`第${i+1}行有一组参数与结果`),text_context:[],unreadable:[],conflicts:[]};
  assert.equal(visualReadingSchema.parse(data).observations.length,14);
  assert.equal(visualReadingSchema.safeParse({...data,observations:[]}).success,false);
  assert.equal(visualReadingSchema.safeParse({...data,observations:['a'.repeat(351)]}).success,false);
});
const input:QualityInput={paper:{id:'p',title:'study',version:'v1',pdf_sha256:null},versionId:'v',digest:{paper_id:'p',status:'ready',model:'fixture',prompt_version:'v1',sections:[{id:'experiments',title:'实验',claims:[{id:'c1',text:'90%',support:'direct',evidence_block_ids:['b1']}]}],material_updated_at:null,receipt_id:1,error:null,updated_at:''},figures:[],figureBlocks:[],sources:[{block_id:'b1',page:2,section:['Results'],quotes:[{quote_id:'q1',text:'Accuracy is 90% on test split.'}]}],hardChecks:{claims:1,sourceBlocks:1,sourceChars:37,figures:0,visualFigures:0,unknownEvidenceIds:[],unreferencedDirectClaims:[]},vision:false,parser:'fixture'};
const answer=()=>({summary:'基本准确',claim_checks:[{claim_id:'c1',verdict:'supported' as const,reason:'测试集数据对应',quote_ids:['q1']}],dimensions:QUALITY_DIMENSIONS.map(id=>({id,score:id==='figures'?null:3,reason:'对照原文判断',quote_ids:['q1']})),omissions:[]});
test('评分绑定实际原句；缺失/重复主张、未知证据和伪图表评分拒绝',()=>{
  const result=compileQualityResult(qualityJudgeSchema.parse(answer()),input,'fixture');assert.equal(result.quotes[0]!.text,input.sources[0]!.quotes[0]!.text);assert.equal(result.sameModel,true);assert.match(result.visualScope,/未实际看图/);
  assert.throws(()=>compileQualityResult({...answer(),claim_checks:[]},input,'fixture'),/逐条/);
  assert.throws(()=>compileQualityResult({...answer(),claim_checks:[...answer().claim_checks,...answer().claim_checks]},input,'fixture'),/逐条/);
  assert.throws(()=>compileQualityResult({...answer(),claim_checks:[{...answer().claim_checks[0]!,quote_ids:['unknown']}]},input,'fixture'),/未知/);
  assert.throws(()=>compileQualityResult({...answer(),claim_checks:[{...answer().claim_checks[0]!,quote_ids:[]}]},input,'fixture'),/证据/);
  assert.throws(()=>compileQualityResult({...answer(),dimensions:answer().dimensions.map(d=>({...d,score:4}))},input,'fixture'),/图表评分/);
  assert.throws(()=>compileQualityResult({...answer(),dimensions:answer().dimensions.map(d=>({...d,id:'factuality'}))},input,'fixture'),/维度/);
});

test('真实块编号按整个已提供块展开，不猜段落；未知编号继续拒绝',()=>{
  const multiple={...input,sources:[{...input.sources[0]!,quotes:[...input.sources[0]!.quotes,{quote_id:'q2',text:'The result uses the same test split.'}]}]};
  const data={...answer(),claim_checks:[{...answer().claim_checks[0]!,quote_ids:['b1']}]};
  const result=compileQualityResult(data,multiple,'fixture');
  assert.deepEqual(result.claim_checks[0]!.quote_ids,['q1','q2']);
  assert.deepEqual(result.referenceRepairs,[{provided:'b1',resolved:['q1','q2'],scope:'whole_block'}]);
  assert.equal(data.claim_checks[0]!.quote_ids[0],'b1');
  assert.throws(()=>compileQualityResult({...data,claim_checks:[{...data.claim_checks[0]!,quote_ids:['b1:invented']}]},multiple,'fixture'),/未知/);
});

test('原文正文与表格冲突单列，必须绑定两个真实来源块而非当作解读无依据',()=>{
  const conflictInput={...input,sources:[...input.sources,{block_id:'b2',page:3,section:['Results'],quotes:[{quote_id:'q2',text:'Table reports 91% on the same test split.'}]}]};
  const data=qualityJudgeSchema.parse({...answer(),claim_checks:[{...answer().claim_checks[0]!,verdict:'source_conflict',quote_ids:['q1','q2']}]});
  const result=compileQualityResult(data,conflictInput,'fixture');assert.equal(result.claim_checks[0]!.verdict,'source_conflict');
  assert.throws(()=>compileQualityResult({...data,claim_checks:[{...data.claim_checks[0]!,quote_ids:['q1']}]},conflictInput,'fixture'),/两个/);
});

test('校准按冻结标签算判断命中，少项不能制造满分',()=>{
  const calibrated={...input,calibration:{suite:'fixture',label:'受控样本',expected:[{claimId:'c1',verdict:'supported' as const}]}};
  const result=compileQualityResult(answer(),calibrated,'fixture');assert.equal(result.calibration!.passed,1);
  assert.throws(()=>compileQualityResult(answer(),{...calibrated,calibration:{...calibrated.calibration,expected:[]}},'fixture'),/校准标签/);
});

test('数字审计拒绝漏读、伪数字及把不同来源值说成一致',()=>{
  assert.throws(()=>compileQualityResult(answer(),input,'fixture',true),/缺少逐项/);
  const second={block_id:'b2',page:3,section:['Results'],quotes:[{quote_id:'q2',text:'Accuracy is 91% on test split.'}]};
  const source={...input,sources:[...input.sources,second]};
  const numeric_audit=[{quantity:'测试集准确率',readings:[{quote_id:'q1',value:'90%'},{quote_id:'q2',value:'91%'}],agreement:'conflict' as const,reason:'同一条件正文与表格报告不同。'}];
  const data={...answer(),claim_checks:[{...answer().claim_checks[0]!,verdict:'source_conflict' as const,quote_ids:['q1','q2'],numeric_audit}]};
  assert.equal(compileQualityResult(data,source,'fixture',true).claim_checks[0]!.numeric_audit![0]!.readings.length,2);
  assert.throws(()=>compileQualityResult({...data,claim_checks:[{...data.claim_checks[0]!,numeric_audit:[{...numeric_audit[0]!,agreement:'consistent'}]}]},source,'fixture',true),/一致性/);
  assert.throws(()=>compileQualityResult({...data,claim_checks:[{...data.claim_checks[0]!,numeric_audit:[{...numeric_audit[0]!,readings:[{quote_id:'q1',value:'89%'}]}]}]},source,'fixture',true),/未逐字/);
});

test('只按原表明确百分比列恢复单元格原字，保留审计且不改模型判断',()=>{
  const table={block_id:'b2',page:3,section:['Results'],quotes:[{quote_id:'q2',text:'Method Accuracy% Model A 90'}],table_rows:[{row:1,cells:['Method','Accuracy%'],quote_ids:['q2']},{row:2,cells:['Model A','90'],quote_ids:['q2']}]};
  const data={...answer(),claim_checks:[{...answer().claim_checks[0]!,numeric_audit:[{quantity:'准确率',readings:[{quote_id:'q2',value:'90%'}],agreement:'single_source' as const,reason:'原表百分比列。'}]}]};
  const source={...input,sources:[...input.sources,table]};
  const result=compileQualityResult(data,source,'fixture',true);
  assert.equal(result.claim_checks[0]!.verdict,'supported');assert.equal(result.claim_checks[0]!.numeric_audit![0]!.readings[0]!.value,'90');
  assert.deepEqual(result.numericFormatRepairs,[{quoteId:'q2',provided:'90%',resolved:'90',basis:'table_percent_header'}]);
  assert.equal(data.claim_checks[0]!.numeric_audit[0]!.readings[0]!.value,'90%');
  assert.throws(()=>compileQualityResult(data,{...source,sources:[...input.sources,{...table,table_rows:[{row:1,cells:['Method','Score'],quote_ids:['q2']},table.table_rows[1]!]}]},'fixture',true),/未逐字/);
  assert.throws(()=>compileQualityResult({...data,claim_checks:[{...data.claim_checks[0]!,numeric_audit:[{...data.claim_checks[0]!.numeric_audit[0]!,readings:[{quote_id:'q2',value:'91%'}]}]}]},source,'fixture',true),/未逐字/);
});

test('数字读取不得把另一个数字的子串冒充原文值',()=>{
  const source={...input,sources:[{...input.sources[0]!,quotes:[{quote_id:'q1',text:'Accuracy is 190%.'}]}]};
  const data={...answer(),claim_checks:[{...answer().claim_checks[0]!,numeric_audit:[{quantity:'准确率',readings:[{quote_id:'q1',value:'90%'}],agreement:'single_source' as const,reason:'数值读取。'}]}]};
  assert.throws(()=>compileQualityResult(data,source,'fixture',true),/未逐字/);
});

test('supported必须核对当前直接主张的结果数字，不能读另一组正确数字代替',()=>{
  const data={...answer(),claim_checks:[{...answer().claim_checks[0]!,numeric_audit:[{quantity:'准确率',readings:[{quote_id:'q1',value:'90%'}],agreement:'single_source' as const,reason:'原文数字。'}]}]};
  const claim={...input.digest.sections[0]!.claims[0]!,text:'SQuAD v1.1 的准确率为89%。'};
  const source={...input,digest:{...input.digest,sections:[{...input.digest.sections[0]!,claims:[claim]}]}};
  assert.throws(()=>compileQualityResult(data,source,'fixture',true),/当前直接主张.*89/);
  assert.equal(compileQualityResult(data,{...source,digest:{...source.digest,sections:[{...source.digest.sections[0]!,claims:[{...claim,text:'SQuAD v1.1 的准确率为90%。'}]}]}},'fixture',true).claim_checks[0]!.verdict,'supported');
});
