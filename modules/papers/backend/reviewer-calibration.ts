import type {PaperDigestClaim} from '../types.ts';
import type {QualityInput} from './quality-contract.ts';
import type {QualityVerdict} from '../evaluation.ts';

export const REVIEWER_CALIBRATION_SUITE='reviewer-calibration-v1';
export function buildReviewerCalibration(baseline:QualityInput,kind:'bert'|'dropout'):QualityInput{
  const sources=baseline.sources;
  const requireSource=(id:string,text:string)=>{
    if(!sources.find(s=>s.block_id===id)?.quotes.some(q=>q.text.includes(text)))throw new Error('校准原文与固定核对样本不一致：'+id);
    return id;
  };
  const cases:{claim:PaperDigestClaim;verdict:QualityVerdict}[]=[];
  const add=(id:string,text:string,support:PaperDigestClaim['support'],blocks:string[],verdict:QualityVerdict)=>cases.push({claim:{id,text,support,evidence_block_ids:blocks},verdict});
  if(kind==='bert'){
    const table=requireSource('mineru-176450b3b4ea7bf4','BERTLARGE(Sgl.+TriviaQA) 84.2 91.1 85.1 91.8');
    requireSource('mineru-2191df5cd048d70f','batch size of 32');
    requireSource('mineru-eb38fb502d88de33','several random restarts');
    add('c01','原文未报告多次随机种子下的方差或统计显著性检验，也未说明是否做过此类检验；仅凭原文无法判断相应稳定性或显著性，不能据此推断作者未执行检验或选择偏差成立。','not_stated',[],'supported');
    add('c02','SQuAD v1.1 中，BERT_LARGE 单模型配合 TriviaQA 的 Test F1 为91.8。','direct',[table],'supported');
    add('c03','SQuAD v1.1 中，BERT_LARGE 单模型配合 TriviaQA 的 Test F1 为91.9。','direct',[table],'contradicted');
    add('c04','论文未报告 SQuAD v1.1 微调的 batch size。','not_stated',[],'contradicted');
  }else{
    const body=requireSource('mineru-5b4450055d6f4148','for an 8-layer net the error reduces from 20.5% to 19.7%');
    const table=requireSource('mineru-04e1a841f06fa76b','DBN-pretrained NN (8 layers) (Mohamed et al., 2010) 20.7');
    add('c01','TIMIT 上，DBN预训练8层网络加Dropout后，音素错误率从20.5%降至19.7%。','direct',[body,table],'source_conflict');
    add('c02','TIMIT 上，6层普通网络音素错误率为29.4%，加Dropout降至11.8%。','direct',[body,table],'contradicted');
    add('c03','TIMIT 上，6层普通网络音素错误率为23.4%，加Dropout降至21.8%。','direct',[body,table],'supported');
  }
  return {...baseline,figures:[],figureBlocks:[],vision:false,
    digest:{...baseline.digest,receipt_id:null,sections:[{id:'calibration',title:'受控核查样本',claims:cases.map(c=>c.claim)}]},
    hardChecks:{...baseline.hardChecks,claims:cases.length,figures:0,visualFigures:0,unknownEvidenceIds:[],unreferencedDirectClaims:[]},
    calibration:{suite:REVIEWER_CALIBRATION_SUITE,label:kind==='bert'?'BERT · 未报告边界与数值归属':'Dropout · 原文冲突与错误数字',expected:cases.map(c=>({claimId:c.claim.id,verdict:c.verdict}))}};
}
