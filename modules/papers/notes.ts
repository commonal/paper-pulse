import type {Note,NoteAnchor,PaperDigest,PaperIllustration} from './types.ts';

export function noteAnchorMatches(anchor:NoteAnchor|undefined|null,digest:PaperDigest|null,figures:PaperIllustration[]){
  if(!anchor||anchor.kind==='paper')return true;
  if(anchor.kind==='claim')return !!digest?.sections.some(s=>s.id===anchor.sectionId&&s.claims.some(c=>c.id===anchor.targetId&&c.text===anchor.excerpt&&JSON.stringify(c.evidence_block_ids)===JSON.stringify(anchor.evidenceBlockIds)));
  return figures.some(f=>f.block_id===anchor.targetId&&f.title===anchor.label&&f.explanation===anchor.excerpt&&f.image_sha256===anchor.imageSha256);
}
export const noteOrigin=(note:Pick<Note,'anchor'|'page'>)=>note.anchor?.kind==='claim'?`解读段落 · ${note.anchor.label}`:note.anchor?.kind==='figure'?`图表 · ${note.anchor.label}`:note.anchor?.kind==='paper'?'整篇阅读笔记':note.page?`已有笔记 · 第 ${note.page} 页`:'已有阅读笔记';
