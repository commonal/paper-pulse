import {parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {createCanvas} from '@napi-rs/canvas';
import {getDocument,Util,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pdfRegion,completeFigureRegion,type PdfRegion} from '../web/pdf-region.ts';
import type {PaperBlock} from '../types.ts';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const {pdf,pdfSha256,blocks}=workerData as {pdf:Uint8Array;pdfSha256:string;blocks:PaperBlock[]};
const assets=path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json'))).replace(/\\/g,'/')+'/';
const task=getDocument({data:pdf,disableFontFace:true,useSystemFonts:false,enableXfa:false,verbosity:0,maxImageSize:20_000_000,standardFontDataUrl:assets+'standard_fonts/',cMapUrl:assets+'cmaps/',cMapPacked:true,wasmUrl:assets+'wasm/'});
try{
  const doc=await task.promise;if(doc.numPages>500)throw new Error('PDF页数超过图表渲染范围');
  const images=[];
  for(const block of blocks){
    if(block.page!>doc.numPages)throw new Error('图表页码不属于当前PDF');
    const page=await doc.getPage(block.page!),viewport=page.getViewport({scale:2.5});
    if(viewport.width*viewport.height>16_000_000)throw new Error('原文页面尺寸超过图表渲染范围');
    let region=pdfRegion(block.bbox,viewport.width,viewport.height);if(!region)throw new Error('原文图表定位无效');
    if(block.kind==='figure'||block.kind==='table'){
      const [text,operators]=await Promise.all([page.getTextContent(),page.getOperatorList()]);
      const labels=text.items.flatMap(item=>{
        if(!('str' in item)||!item.str.trim()||item.transform[1]!==0||item.transform[2]!==0)return [];
        const m=Util.transform(viewport.transform,item.transform),height=Math.hypot(m[2],m[3]);
        return [{left:m[4],top:m[5]-height*(text.styles[item.fontName]?.ascent??1),width:item.width*viewport.scale,height}];
      });
      const boxes:PdfRegion[]=[],stack:number[][]=[];let matrix=[1,0,0,1,0,0];
      operators.fnArray.forEach((op,index)=>{
        if(op===OPS.save)stack.push([...matrix]);else if(op===OPS.restore)matrix=stack.pop()??[1,0,0,1,0,0];
        else if(op===OPS.transform)matrix=Util.transform(matrix,operators.argsArray[index]);
        else if(op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject){
          const m=Util.transform(viewport.transform,matrix),points=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
          const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys);boxes.push({left,top,width:Math.max(...xs)-left,height:Math.max(...ys)-top});
        }
      });
      region=completeFigureRegion(region,labels,boxes,viewport.width,viewport.height);
    }
    const canvas=createCanvas(Math.ceil(region.width),Math.ceil(region.height)),context=canvas.getContext('2d');
    await page.render({canvas:canvas as never,canvasContext:context as never,viewport,transform:[1,0,0,1,-region.left,-region.top]}).promise;
    const data=canvas.toBuffer('image/png');if(data.length>5*1024*1024)throw new Error('图表图片超过视觉输入大小范围');
    const bbox:[number,number,number,number]=[region.left/viewport.width*1000,region.top/viewport.height*1000,(region.left+region.width)/viewport.width*1000,(region.top+region.height)/viewport.height*1000].map(v=>Math.max(0,Math.min(1000,v))) as [number,number,number,number];
    images.push({blockId:block.id,page:block.page,bbox,width:canvas.width,height:canvas.height,pdfSha256,sha256:createHash('sha256').update(data).digest('hex'),renderer:'pdfjs-crop-v1',data});
    page.cleanup();
  }
  parentPort!.postMessage({images});
}catch(error){parentPort!.postMessage({error:(error as Error).name==='PasswordException'?'PDF已加密，无法进行视觉图表解读':(error as Error).message});}
finally{await task.destroy();parentPort!.close();}
