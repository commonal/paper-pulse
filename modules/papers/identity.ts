import type {PaperMetadata,PaperSourcePreview} from './types.ts';
export interface IdentityCandidate extends PaperSourcePreview {
  key:string;doi:string;metadata:PaperMetadata;match:'matched'|'candidate'|'record'|'local';checks:string[];existing_id?:string;
}
export interface IdentityResult {
  title_hint:string;author_hint:string;author_evidence?:string;excerpt:string;doi_hints:string[];arxiv_hints:string[];
  candidates:IdentityCandidate[];selected_key:string;warnings:string[];needs_ocr:boolean;
}
export interface IdentityPreview {id:string;state:'ready'|'queued'|'running'|'waiting'|'failed';result:IdentityResult;error:string|null}
export interface IdentityLine {text:string;size:number;y:number;x:number;vertical?:boolean}
export function identityText(text:string){return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');}
function authorLine(text:string){
  const clean=text.replace(/[^\s]+@[^\s]+/g,'').trim();
  if(/\b(university|department|institute|school|laboratory|language|editor)\b/i.test(clean))return '';
  const words=clean.match(/\p{L}[\p{L}\p{M}'-]*/gu)??[];
  return words.length>=2&&words.filter(w=>/^\p{Lu}/u.test(w)).length>=words.length/2?clean:'';
}
export function pdfHints(lines:IdentityLine[],metadataTitle=''){
  const ordered=lines.filter(l=>l.text.trim()).sort((a,b)=>b.y-a.y||a.x-b.x);
  const stop=ordered.findIndex(l=>/^\s*(references|bibliography|参考文献)\s*$/i.test(l.text));
  const own=(stop<0?ordered:ordered.slice(0,stop));
  const abstract=own.findIndex(l=>/^\s*(abstract|摘要)\b/i.test(l.text));
  const header=(abstract<0?own:own.slice(0,abstract)).filter(l=>!l.vertical);
  const max=Math.max(0,...header.filter(l=>l.text.length>8&&!/^(arxiv|https?:|submitted|published)/i.test(l.text)).map(l=>l.size));
  const titleLines=header.filter(l=>l.size>=max*.95&&l.text.length>3&&!/^(arxiv|https?:|submitted|published)/i.test(l.text));
  const body=own.map(l=>l.text).join('\n').slice(0,18000);
  const headingTitle=titleLines.map(l=>l.text.trim()).join(' ').slice(0,500);
  const title=metadataTitle.length>8&&identityText(headingTitle)===identityText(metadataTitle)?metadataTitle:headingTitle;
  const bottom=Math.min(...titleLines.map(l=>l.y));
  const authorLines=header.filter(l=>l.y<bottom&&l.size>=max*.65&&!/@|\b(university|department|institute|school|laboratory|editor|keywords)\b/i.test(l.text)).slice(0,8);
  const authorEvidence=header.filter(l=>l.y<bottom).slice(0,8).map(l=>authorLine(l.text)).filter(Boolean).join('\n');
  const dois=[...new Set([...body.matchAll(/\b10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+/g)].map(m=>m[0].replace(/[.,;]+$/,'').toLowerCase()))].slice(0,3);
  const arxiv=[...new Set([...body.matchAll(/(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)/gi)].map(m=>m[1]))].slice(0,2);
  return {title_hint:title,author_hint:authorLines.map(l=>l.text).join(', ').slice(0,2000),author_evidence:authorEvidence.slice(0,2000),excerpt:body.slice(0,6000),doi_hints:dois,arxiv_hints:arxiv,
    needs_ocr:body.replace(/\s/g,'').length<80};
}
export function matchIdentity(title:string,authors:string[],hints:Pick<IdentityResult,'title_hint'|'excerpt'|'author_hint'|'author_evidence'>){
  const titleMatch=identityText(title).length>12&&identityText(title)===identityText(hints.title_hint);
  const header=hints.author_evidence??hints.author_hint.split(',').map(authorLine).filter(Boolean).join('\n');
  const words=new Set(header.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
  const unique=[...new Set(authors.map(a=>a.normalize('NFKC').toLowerCase().trim()).filter(Boolean))];
  const matched=unique.filter(a=>a.split(/[\s-]+/).every(part=>words.has(part))).length;
  const authorMatch=unique.length>0&&matched>=Math.min(2,unique.length);
  return {matched:titleMatch&&authorMatch,checks:[titleMatch?'标题与 PDF 首页一致':'标题尚未与 PDF 首页一致',authorMatch?'作者姓氏在首页作者区得到对照':'作者尚未充分对照']};
}
