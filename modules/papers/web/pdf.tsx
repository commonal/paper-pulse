import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PaperBlock } from "../types.ts";
import { completeFigureRegion, pdfRegion, type PdfRegion } from "./pdf-region.ts";
import {paragraphHighlight,pdfPageNumber,type PdfTextRun} from './pdf-highlight.ts';

const DocumentContext = createContext<{ doc: PDFDocumentProxy | null; error: string }>({ doc: null, error: "" });

// Inline visuals and the original tab share one local PDF load and one worker.
export function PdfDocumentProvider({ url, enabled, children }: { url: string; enabled: boolean; children: ReactNode }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true; let task: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
    setDoc(null); setError("");
    // Load on the client only: PDF.js browser rendering does not run during SSR.
    import("pdfjs-dist").then(async (lib) => {
      if (!active) return; lib.GlobalWorkerOptions.workerSrc = workerUrl;
      task = lib.getDocument({ url, withCredentials: true }); const loaded = await task.promise;
      if (active) setDoc(loaded);
    }).catch(() => { if (active) setError("PDF 无法解析或读取，请尝试独立窗口查看原文件。"); });
    return () => { active = false; void task?.destroy().catch(() => {}); };
  }, [url, enabled]);
  return <DocumentContext.Provider value={{ doc, error }}>{children}</DocumentContext.Provider>;
}

export interface PdfFocus {page:number;key:number;block?:PaperBlock}
type PageSize={width:number;height:number};

function PdfPageSurface({doc,number,size,root,block,forced}:{doc:PDFDocumentProxy;number:number;size:PageSize;root:HTMLDivElement|null;block?:PaperBlock;forced:boolean}){
  const frame=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const [near,setNear]=useState(false),[width,setWidth]=useState(0),[error,setError]=useState(''),[ready,setReady]=useState(false);
  const [highlight,setHighlight]=useState<{rects:PdfRegion[];kind:'page'|'lines'|'region'}>({rects:[],kind:'page'});
  const visible=near||forced;
  useEffect(()=>{
    if(!root||!frame.current)return;
    if(typeof IntersectionObserver==='undefined'){setNear(true);return;}
    const observer=new IntersectionObserver(([entry])=>setNear(entry.isIntersecting),{root,rootMargin:'600px'});
    observer.observe(frame.current);return()=>observer.disconnect();
  },[root]);
  useEffect(()=>{
    if(!frame.current)return;
    const target=frame.current,measure=()=>setWidth(Math.round(target.clientWidth));measure();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);observer.observe(target);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const target=canvas.current;
    if(!target)return;
    if(!visible){target.width=0;target.height=0;setReady(false);return;}
    if(!width)return;
    let active=true,task:import('pdfjs-dist').RenderTask|undefined;
    setReady(false);setError('');setHighlight({rects:[],kind:'page'});
    doc.getPage(number).then(async page=>{
      if(!active)return;
      const scale=Math.min(1600,width*Math.min(window.devicePixelRatio||1,2))/size.width;
      const viewport=page.getViewport({scale});target.width=Math.ceil(viewport.width);target.height=Math.ceil(viewport.height);
      task=page.render({canvas:target,viewport});
      const [,text]=await Promise.all([task.promise,block?page.getTextContent().catch(()=>null):Promise.resolve(null)]);
      if(!active)return;
      if(block){
        const {Util}=await import('pdfjs-dist');
        const runs:PdfTextRun[]=text?.items.flatMap(item=>{
          if(!('str' in item)||!item.str.trim())return [];
          const m=Util.transform(viewport.transform,item.transform),height=Math.hypot(m[2],m[3]);
          if(Math.abs(m[1])>0.1||Math.abs(m[2])>0.1)return [];
          return [{text:item.str,left:m[4],top:m[5]-height*(text.styles[item.fontName]?.ascent??1),width:item.width*viewport.scale,height}];
        })??[];
        if(active)setHighlight(paragraphHighlight(block.bbox,runs,viewport.width,viewport.height));
      }
      if(active)setReady(true);
    }).catch(()=>{if(active)setError(`第 ${number} 页暂时无法显示，可在独立窗口查看原文。`);});
    return()=>{active=false;task?.cancel();};
  },[doc,number,visible,width,size.width,block]);
  return <section className="pp-pdf-page" data-page-number={number} aria-label={`PDF 第 ${number} 页`}>
    <div ref={frame} className="pp-pdf-page-surface" style={{aspectRatio:`${size.width} / ${size.height}`}} aria-busy={visible&&!ready&&!error}>
      <canvas ref={canvas} role="img" aria-label={`论文 PDF 第 ${number} 页`} hidden={!ready||!!error}/>
      {!ready&&<p className={error?'pp-error':'pp-muted'} role={error?'alert':undefined}>{error||`PDF 第 ${number} 页${visible?' · 正在显示…':''}`}</p>}
      {ready&&highlight.rects.map((r,i)=><i key={i} className="pp-pdf-highlight" aria-label="引用段落高亮" data-highlight-kind={highlight.kind}
        style={{left:r.left/(canvas.current?.width||1)*100+'%',top:r.top/(canvas.current?.height||1)*100+'%',width:r.width/(canvas.current?.width||1)*100+'%',height:r.height/(canvas.current?.height||1)*100+'%'}}/>)}
    </div>
    <p className="pp-pdf-caption">PDF 第 {number} / {doc.numPages} 页{block&&ready&&(highlight.kind==='lines'?' · 黄色标出引用对应的原文段落':highlight.kind==='region'?' · 黄色标出解析器定位的段落区域':' · 缺少可靠段落坐标，仅定位到页')}</p>
  </section>;
}

export function PdfReader({target,onCount,onPage,reliableBoxes}:{target:PdfFocus;onCount:(count:number)=>void;onPage:(page:number)=>void;reliableBoxes:boolean}){
  const {doc,error:loadingError}=useContext(DocumentContext);
  const [root,setRoot]=useState<HTMLDivElement|null>(null),[layout,setLayout]=useState<{doc:PDFDocumentProxy;pages:PageSize[]}|null>(null),[error,setError]=useState('');
  const onPageRef=useRef(onPage);onPageRef.current=onPage;
  useEffect(()=>{
    if(!doc)return;onCount(doc.numPages);setError('');
    let active=true,next=0;const pages:PageSize[]=new Array(doc.numPages);
    // Establish every page's dimensions before jumping; late preceding pages must not move the target.
    const read=async()=>{while(active&&next<doc.numPages){const index=next++;const page=await doc.getPage(index+1),v=page.getViewport({scale:1});pages[index]={width:v.width,height:v.height};}};
    void Promise.all(Array.from({length:Math.min(4,doc.numPages)},read)).then(()=>{if(active)setLayout({doc,pages});}).catch(()=>{if(active)setError('无法读取PDF页面布局，请在独立窗口查看原文。');});
    return()=>{active=false;};
  },[doc,onCount]);
  const pages=layout?.doc===doc?layout.pages:[];
  const focusPage=pdfPageNumber(target.page,doc?.numPages||1);
  const focusedBlock=target.block?.page===focusPage?target.block:undefined;
  useEffect(()=>{
    if(!root||!pages.length)return;
    const frame=root.querySelector<HTMLElement>(`[data-page-number="${focusPage}"]`),surface=frame?.querySelector<HTMLElement>('.pp-pdf-page-surface');
    if(!frame||!surface)return;
    const box=reliableBoxes&&focusedBlock?pdfRegion(focusedBlock.bbox,1,1):null;
    const offset=box?focusedBlock!.bbox![1]/1000*surface.clientHeight:0;
    root.scrollTo({top:root.scrollTop+frame.getBoundingClientRect().top-root.getBoundingClientRect().top+offset-18,behavior:'instant'});
  },[root,pages,focusPage,target.key,reliableBoxes,focusedBlock]);
  useEffect(()=>{
    if(!root||!pages.length||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting)onPageRef.current(Number((entry.target as HTMLElement).dataset.pageNumber));
    },{root,rootMargin:'-35% 0px -55% 0px'});
    root.querySelectorAll('[data-page-number]').forEach(p=>observer.observe(p));return()=>observer.disconnect();
  },[root,pages]);
  const failure=loadingError||error;
  return <div ref={setRoot} className="pp-pdf-reader" role="region" aria-label="论文原文连续阅读" tabIndex={0} aria-busy={!failure&&!pages.length}>
    {target.block?.page&&doc&&target.block.page>doc.numPages&&<p className="pp-pdf-hint">该引用页码超出当前PDF范围，不能精确高亮。</p>}
    {failure?<p className="pp-error" role="alert">{failure}</p>:!pages.length?<p role="status">正在读取原文…</p>:
      doc&&pages.map((size,i)=><PdfPageSurface key={i} doc={doc} number={i+1} size={size} root={root} forced={i+1===focusPage}
        block={i+1===focusPage?reliableBoxes?focusedBlock:focusedBlock?{...focusedBlock,bbox:undefined}:undefined:undefined}/>) }
  </div>;
}

export function PdfCrop({ block, title, onOpen }: { block: PaperBlock; title: string; onOpen: () => void }) {
  const { doc, error: loadingError } = useContext(DocumentContext);
  const [error, setError] = useState(""); const [rendering, setRendering] = useState(true); const [visible, setVisible] = useState(false);
  const container = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!container.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "300px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!doc || !visible || !block.page) return;
    let active = true; let task: import("pdfjs-dist").RenderTask | undefined;
    setRendering(true); setError("");
    doc.getPage(block.page).then(async pdfPage => {
      if (!active || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale: 2 });
      let region = pdfRegion(block.bbox, viewport.width, viewport.height);
      if (!region) throw new Error("invalid crop");
      if (block.kind === "figure") {
        const [{ Util, OPS }, text, operators] = await Promise.all([import("pdfjs-dist"), pdfPage.getTextContent(), pdfPage.getOperatorList()]);
        if (!active || !canvas.current) return;
        const labels = text.items.flatMap(item => {
          if (!("str" in item) || !item.str.trim() || item.transform[1] !== 0 || item.transform[2] !== 0) return [];
          const m = Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.hypot(m[2],m[3]), ascent = text.styles[item.fontName]?.ascent ?? 1;
          return [{left:m[4],top:m[5]-fontHeight*ascent,width:item.width*viewport.scale,height:fontHeight}];
        });
        const images: PdfRegion[] = []; const stack: number[][] = []; let matrix = [1,0,0,1,0,0];
        operators.fnArray.forEach((op,index) => {
          if (op === OPS.save) stack.push([...matrix]);
          else if (op === OPS.restore) matrix = stack.pop() ?? [1,0,0,1,0,0];
          else if (op === OPS.transform) matrix = Util.transform(matrix, operators.argsArray[index]);
          else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
            const m = Util.transform(viewport.transform,matrix);
            const points = [[0,0],[1,0],[0,1],[1,1]].map(([x,y]) => [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
            const xs = points.map(p=>p[0]), ys = points.map(p=>p[1]);
            const left = Math.min(...xs), top = Math.min(...ys);
            images.push({left,top,width:Math.max(...xs)-left,height:Math.max(...ys)-top});
          }
        });
        region = completeFigureRegion(region,labels,images,viewport.width,viewport.height);
      }
      const target = canvas.current; target.width = region.width; target.height = region.height;
      task = pdfPage.render({ canvas: target, viewport, transform: [1, 0, 0, 1, -region.left, -region.top] });
      await task.promise;
      if (active) setRendering(false);
    }).catch(() => { if (active) { setError("暂时无法显示图表，可点击查看原文。"); setRendering(false); } });
    return () => { active = false; task?.cancel(); };
  }, [doc, visible, block.page, block.bbox]);
  const failure = loadingError || error;
  return <div ref={container} className="pp-figure-image" aria-busy={!failure && rendering}>
    {rendering && !failure && <p className="pp-muted" role="status">{visible ? "正在读取原文图表…" : "原文图表"}</p>}
    {failure && <p className="pp-muted">{failure}</p>}
    <button className="pp-figure-open" aria-label={`${title}，查看原文第 ${block.page} 页`} onClick={onOpen}>
      <canvas ref={canvas} role="img" aria-label={`${title}（PDF 第 ${block.page} 页）`} hidden={rendering || !!failure}/>
      {failure && <span>查看原文 ↗</span>}
    </button>
  </div>;
}
