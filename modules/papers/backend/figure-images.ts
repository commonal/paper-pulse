import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {REPO_ROOT} from '@aihot/backend/config';
import type {PaperBlock} from '../types.ts';
import {validIllustrationBox,MAX_ILLUSTRATIONS} from './illustration-plan.ts';

export interface FigureImage {
  blockId:string;page:number;bbox:[number,number,number,number];width:number;height:number;
  pdfSha256:string;sha256:string;renderer:string;data:Buffer;
}
export function figureImageMetadata({data:_,...image}:FigureImage){return image;}
/** Render selected local PDF regions; pixels never come from external URLs or the browser. */
export async function renderFigureImages(pdf:Buffer,pdfSha256:string,blocks:PaperBlock[]):Promise<FigureImage[]>{
  if(pdf.length>20*1024*1024||createHash('sha256').update(pdf).digest('hex')!==pdfSha256)throw new Error('原文PDF与保存的版本哈希不一致，无法进行视觉核查');
  if(!blocks.length||blocks.length>MAX_ILLUSTRATIONS||new Set(blocks.map(b=>b.id)).size!==blocks.length||blocks.some(b=>!b.page||b.page<1||!Number.isInteger(b.page)||!validIllustrationBox(b)))throw new Error(`视觉解读需要1–${MAX_ILLUSTRATIONS}张有可靠页码和定位的图表`);
  const worker=new Worker(new URL('./pdf-figure-worker.ts',import.meta.url),{workerData:{pdf:new Uint8Array(pdf),pdfSha256,blocks},resourceLimits:{maxOldGenerationSizeMb:128}});
  const images=await new Promise<FigureImage[]>((resolve,reject)=>{
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('原文图表渲染超时，旧解读保留'));},45000);
    const done=()=>clearTimeout(timer);
    worker.once('message',message=>{done();if(message.error)reject(new Error(message.error));else resolve(message.images.map((image:FigureImage)=>({...image,data:Buffer.from(image.data)})));});
    worker.once('error',error=>{done();reject(error);});worker.once('exit',code=>{done();if(code!==0)reject(new Error('原文图表渲染进程失败'));});
  });
  const folder=path.join(REPO_ROOT,'.data/eval/paper-visual',pdfSha256);await mkdir(folder,{recursive:true});
  for(const image of images)await writeFile(path.join(folder,image.sha256+'.png'),image.data);
  return images;
}
