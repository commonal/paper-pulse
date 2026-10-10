import {parentPort,workerData} from 'node:worker_threads';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pdfHints,type IdentityLine} from '../identity.ts';
const task=getDocument({data:new Uint8Array(workerData),disableFontFace:true,useSystemFonts:false,enableXfa:false,verbosity:0});
try{
  const pdf=await task.promise,page=await pdf.getPage(1),content=await page.getTextContent();
  if(content.items.length>10000)throw new Error('PDF 首页内容过于复杂，请手动补充身份');
  const raw=content.items.filter(i=>'str'in i).map(i=>({text:i.str,size:i.height,y:i.transform[5],x:i.transform[4],vertical:Math.abs(i.transform[1])>Math.abs(i.transform[0])}));
  const lines:IdentityLine[]=[];
  for(const item of raw.sort((a,b)=>b.y-a.y||a.x-b.x)){
    const previous=lines.at(-1);
    if(previous&&Math.abs(previous.y-item.y)<2&&!previous.vertical&&!item.vertical){previous.text+=' '+item.text;previous.size=Math.max(previous.size,item.size);}
    else lines.push({...item});
  }
  const metadata=await pdf.getMetadata();
  parentPort!.postMessage({result:pdfHints(lines,String((metadata.info as {Title?:unknown})?.Title??''))});
}catch(error){parentPort!.postMessage({error:(error as Error).name==='PasswordException'?'PDF 已加密，请提供可读取的文件': 'PDF 无法读取，请检查文件或手动填写身份'});}
finally{await task.destroy();parentPort!.close();}
