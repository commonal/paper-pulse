import test from 'node:test';
import assert from 'node:assert/strict';
import {paragraphHighlight,pdfPageNumber} from '../web/pdf-highlight.ts';

test('黄色段落高亮按真实文字行收窄，不涂空白或另一栏，缩放后坐标一致',()=>{
  const runs=[{text:'left first',left:100,top:100,width:180,height:12},{text:'left second',left:100,top:120,width:150,height:12},
    {text:'other column',left:600,top:100,width:150,height:12},{text:'next paragraph',left:100,top:180,width:100,height:12}];
  const result=paragraphHighlight([90,90,400,145],runs,1000,1000);
  assert.equal(result.kind,'lines');assert.equal(result.rects.length,2);assert.deepEqual(result.rects.map(r=>r.top),[100,120]);
  const doubled=paragraphHighlight([90,90,400,145],runs.map(r=>({...r,left:r.left*2,top:r.top*2,width:r.width*2,height:r.height*2})),2000,2000);
  assert.deepEqual(doubled.rects,result.rects.map(r=>({...r,left:r.left*2,top:r.top*2,width:r.width*2,height:r.height*2})));
});
test('同一行不同栏不跨空白合并，扫描PDF保留可靠段落区域，缺失或无效坐标只定位页',()=>{
  const result=paragraphHighlight([0,0,1000,1000],[{text:'a',left:50,top:100,width:40,height:12},{text:'b',left:600,top:100,width:40,height:12}],1000,1000);
  assert.equal(result.rects.length,2);
  assert.equal(paragraphHighlight([100,100,300,300],[],1000,1000).kind,'region');
  for(const box of [undefined,[-1,0,100,100],[0,0,0,100],[0,0,1001,100], [NaN,0,100,100]])assert.deepEqual(paragraphHighlight(box,[],1000,1000),{rects:[],kind:'page'});
  assert.equal(pdfPageNumber(100,16),16);assert.equal(pdfPageNumber(-1,16),1);assert.equal(pdfPageNumber(2.5,16),1);
});
