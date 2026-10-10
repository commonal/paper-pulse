import type {PaperDigestClaim,PaperDigestSection} from './types.ts';

export interface ReviewIssue {claimId:string|null;message:string}
export interface ReviewManuscript {title_zh:string;summary_zh:string;sections:PaperDigestSection[]}
export interface ReviewAnswer {publishable:boolean;blockers:string[];final:ReviewManuscript;checks:{claim_id:string;verdict:'supported'|'corrected'|'not_stated';reason:string;quote_ids:string[]}[]}
export interface ReviewFailure {
  receiptId:number;draftReceiptId:number;versionId:string|null;inputSignature:string;skillVersion:string;
  draft:ReviewManuscript;review:ReviewAnswer;issues:ReviewIssue[];createdAt:string;
}
export interface ReviewRepair {receiptId:number;inputSignature:string;instructions:{claimId:string;text:string}[]}
export interface ReviewProblem {claim:PaperDigestClaim;section:string;messages:string[];reviewReason:string;reviewVerdict?:ReviewAnswer['checks'][number]['verdict'];blockIds:string[]}
export function reviewProblems(failure:ReviewFailure):ReviewProblem[]{
  const all=failure.issues.filter(i=>!i.claimId).map(i=>i.message);
  return failure.draft.sections.flatMap(s=>s.claims.flatMap(original=>{
    const messages=[...all,...failure.issues.filter(i=>i.claimId===original.id).map(i=>i.message)];if(!messages.length)return [];
    const claim=failure.review.final.sections.flatMap(s=>s.claims).find(c=>c.id===original.id)??original;
    const check=failure.review.checks.find(c=>c.claim_id===claim.id);
    return [{claim,section:s.title,messages,reviewReason:check?.reason??'',reviewVerdict:check?.verdict,blockIds:[...new Set([...claim.evidence_block_ids,...original.evidence_block_ids,...(check?.quote_ids.map(id=>id.replace(/:(?:text|caption):\d+$/,''))??[])])]}];
  }));
}
