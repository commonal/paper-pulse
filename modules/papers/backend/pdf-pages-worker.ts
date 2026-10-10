import {parentPort,workerData} from 'node:worker_threads';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

const task=getDocument({data:new Uint8Array(workerData),disableFontFace:true,useSystemFonts:false,enableXfa:false,verbosity:0});
try{const pdf=await task.promise;parentPort!.postMessage({pages:pdf.numPages});}
catch{parentPort!.postMessage({error:'无法检查原文 PDF 页数，请检查文件是否有效或加密'});}
finally{await task.destroy();parentPort!.close();}
