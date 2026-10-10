import {load} from 'cheerio';
import type {PaperBlock} from '../types.ts';
import type {QualityInput} from './quality-contract.ts';

// JSONB may reorder object keys. Compare the frozen evidence fields, not serialization order.
export function sameSourceQuotes(left:QualityInput['sources'],right:QualityInput['sources']):boolean{
  const canonical=(sources:QualityInput['sources'])=>JSON.stringify(sources.map(source=>({
    block_id:source.block_id,page:source.page??null,section:source.section,
    quotes:source.quotes.map(quote=>({quote_id:quote.quote_id,text:quote.text})),
  })));
  return canonical(left)===canonical(right);
}

export function sourceHasValue(text:string,value:string):boolean{
  if(!/^-?\d+(?:\.\d+)?%?$/.test(value))return text.includes(value);
  const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('(?<![\\d.])'+escaped+'(?!\\d|\\.\\d)').test(text);
}

// Only remove a model-added % when the real table column explicitly gives that unit.
export function percentTableValue(source:QualityInput['sources'][number],quoteId:string,value:string):string|null{
  if(!/^\d+(?:\.\d+)?%$/.test(value)||!source.table_rows?.length)return null;
  const rows=source.table_rows;
  if(rows.some(row=>row.spans?.length))return null;
  const bare=value.slice(0,-1),columns=rows[0].cells.flatMap((cell,i)=>cell.includes('%')?[i]:[]);
  const quote=source.quotes.find(q=>q.quote_id===quoteId);
  return quote&&rows.slice(1).some(row=>row.quote_ids.includes(quoteId)&&columns.some(i=>row.cells[i]===bare)&&quote.text.includes(row.cells.join(' ')))?bare:null;
}

export function withTableRows(sources:QualityInput['sources'],blocks:PaperBlock[]):QualityInput['sources']{
  return sources.map(source=>{
    const block=blocks.find(b=>b.id===source.block_id);
    if(block?.kind!=='table'||!block.table_html)return source;
    const $=load(block.table_html),table=$('table').first();
    const quotes=source.quotes.filter(q=>q.quote_id.includes(':text:'));
    const text=quotes.map(q=>q.text).join('');
    const table_rows=table.find('tr').toArray().filter(tr=>$(tr).closest('table')[0]===table[0]).map((tr,row)=>{
      const cells=$(tr).children('th,td').toArray().map(td=>$(td).text().replace(/\s+/g,' ').trim());
      const rowText=cells.join(' '),start=rowText?text.indexOf(rowText):-1,end=start+rowText.length;
      let offset=0;
      const quote_ids=quotes.filter(q=>{const left=offset;offset+=q.text.length;return start>=0&&left<end&&offset>start;}).map(q=>q.quote_id);
      const spans=$(tr).children('th,td').toArray().flatMap((td,column)=>{
        const rowspan=Number($(td).attr('rowspan')??1),colspan=Number($(td).attr('colspan')??1);
        return Number.isInteger(rowspan)&&Number.isInteger(colspan)&&(rowspan>1||colspan>1)?[{column,rowspan,colspan}]:[];
      });
      return {row:row+1,cells,quote_ids,...(spans.length?{spans}:{})};
    });
    return {...source,table_rows};
  });
}
