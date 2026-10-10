import {pdfRegion,type PdfRegion} from './pdf-region.ts';

export interface PdfTextRun extends PdfRegion {text:string}
// Adapted from research-pulse PdfViewer: parser coordinates bound native text-line highlights.
// PaperPulse's MinerU boxes are always 0–1000; never infer units from small coordinates.
export function paragraphHighlight(box:number[]|undefined,runs:PdfTextRun[],width:number,height:number){
  const base=pdfRegion(box,width,height);
  if(!base)return {rects:[] as PdfRegion[],kind:'page' as const};
  const candidates=runs.filter(r=>r.text.trim()&&[r.left,r.top,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0)
    .filter(r=>Math.min(base.left+base.width,r.left+r.width)-Math.max(base.left,r.left)>=Math.min(2,r.width*.2)
      &&Math.min(base.top+base.height,r.top+r.height)-Math.max(base.top,r.top)>=Math.min(2,r.height*.2))
    .sort((a,b)=>a.top-b.top||a.left-b.left);
  const lines:PdfRegion[]=[];
  for(const r of candidates){
    const line=lines.find(l=>Math.abs(l.top+l.height/2-r.top-r.height/2)<=Math.max(2,r.height*.5)
      &&r.left<=l.left+l.width+Math.max(2,r.height*1.5));
    if(line){const right=Math.max(line.left+line.width,r.left+r.width),bottom=Math.max(line.top+line.height,r.top+r.height);
      line.left=Math.min(line.left,r.left);line.top=Math.min(line.top,r.top);line.width=right-line.left;line.height=bottom-line.top;
    }else lines.push({...r});
  }
  const rects=lines.map(l=>{const left=Math.max(base.left,l.left),top=Math.max(base.top,l.top);
    return {left,top,width:Math.min(base.left+base.width,l.left+l.width)-left,height:Math.min(base.top+base.height,l.top+l.height)-top};
  }).filter(r=>r.width>0&&r.height>0);
  return rects.length?{rects,kind:'lines' as const}:{rects:[base],kind:'region' as const};
}

export function pdfPageNumber(value:number,count:number){return Math.max(1,Math.min(count,Number.isInteger(value)?value:1));}
