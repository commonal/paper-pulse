import {parseArgs} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {enqueueQualitySnapshot} from '../backend/quality-evaluation.ts';
import {buildReviewerCalibration} from '../backend/reviewer-calibration.ts';
import {QUALITY_RUBRIC_VERSION,type QualityInput} from '../backend/quality-contract.ts';
import {sameSourceQuotes,withTableRows} from '../backend/quality-sources.ts';

const {values}=parseArgs({options:{from:{type:'string'},kind:{type:'string'},out:{type:'string'}}});
try{
  const id=z.uuid().parse(values.from),kind=z.enum(['bert','dropout']).parse(values.kind);
  const [baseline]=await sql<{paper_id:string;input:QualityInput}[]>`SELECT paper_id,input FROM paper_quality_evaluations WHERE id=${id} AND status='ready'`;
  if(!baseline)throw new Error('需要已有完成报告的冻结原文作为校准来源');
  const {detail}=await import('../backend/store.ts'),{coveredMaterial,readingQuoteCatalog}=await import('../backend/skill-reading.ts');
  const original=await detail(baseline.paper_id,baseline.input.versionId);
  if(original?.material?.status!=='ready')throw new Error('冻结原文材料不可用');
  const blocks=coveredMaterial(original.material).blocks;
  if(!sameSourceQuotes(readingQuoteCatalog(blocks),baseline.input.sources))throw new Error('原文与冻结基线不一致，不能添加其他版本的表格');
  baseline.input.sources=withTableRows(baseline.input.sources,blocks);
  const input=buildReviewerCalibration(baseline.input,kind),evaluation=await enqueueQualitySnapshot(baseline.paper_id,input);
  const file=values.out??`.data/eval/reviewer-calibration/${QUALITY_RUBRIC_VERSION}/${kind}.json`;
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify({baselineId:id,evaluation,rubricVersion:QUALITY_RUBRIC_VERSION,scope:'受控文字核查样本，完整冻结原文；不发布文章、不评原图。',input},null,2),{flag:'wx'});
  console.log(JSON.stringify({evaluation,manifest:file,cases:input.calibration!.expected.length}));
}finally{await stopBoss();await closeDb();}
