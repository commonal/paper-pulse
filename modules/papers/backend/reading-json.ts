import {escapeControlCharsInStrings} from '@aihot/backend/providers/llm';

export type ClosingRepair={originalSuffix:string;repairedSuffix:string;policy:'terminal-delimiters-only'};
/** Only a normally stopped, complete value can have its terminal container delimiters corrected. */
export function decodeReadingJson(content:string,finishReason?:string):{data:unknown;repair?:ClosingRepair}{
  if(finishReason==='length')throw new Error('论文回答达到输出上限，禁止用补括号接受截断内容');
  let text=content.trim();const fence=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);if(fence)text=fence[1]!.trim();
  text=escapeControlCharsInStrings(text);
  try{return {data:JSON.parse(text)};}catch(error){
    if(finishReason!=='stop'||!text.startsWith('{'))throw error;
    const tail=/[\s}\]]+$/.exec(text);if(!tail)throw error;
    const prefix=text.slice(0,tail.index),stack:string[]=[];
    let inString=false,escaped=false;
    for(const c of prefix){
      if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
      if(c==='"')inString=true;
      else if(c==='{')stack.push('}');else if(c==='[')stack.push(']');
      else if(c==='}'||c===']'){if(stack.pop()!==c)throw error;}
    }
    if(inString||!stack.length||stack.length>8)throw error;
    const originalSuffix=tail[0].replace(/\s/g,''),repairedSuffix=stack.reverse().join('');
    if(Math.abs(originalSuffix.length-repairedSuffix.length)>4)throw error;
    const data=JSON.parse(prefix+repairedSuffix);
    return {data,repair:{originalSuffix,repairedSuffix,policy:'terminal-delimiters-only'}};
  }
}
