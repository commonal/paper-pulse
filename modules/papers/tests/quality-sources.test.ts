import test from 'node:test';
import assert from 'node:assert/strict';
import {sameSourceQuotes,sourceHasValue} from '../backend/quality-sources.ts';
import type {QualityInput} from '../backend/quality-contract.ts';

test('冻结原文比较不受JSONB字段排序影响，证据变化仍被拒绝',()=>{
  const source:QualityInput['sources']=[{block_id:'b1',page:2,section:['Results'],quotes:[{quote_id:'b1:text:0',text:'Accuracy is 90%.'}]}];
  const jsonb=JSON.parse('[{"quotes":[{"text":"Accuracy is 90%.","quote_id":"b1:text:0"}],"section":["Results"],"page":2,"block_id":"b1"}]');
  assert.equal(sameSourceQuotes(source,jsonb),true);
  jsonb[0].quotes[0].text='Accuracy is 91%.';assert.equal(sameSourceQuotes(source,jsonb),false);
  jsonb[0].quotes[0].text='Accuracy is 90%.';jsonb[0].page=3;assert.equal(sameSourceQuotes(source,jsonb),false);
});

test('数字边界允许句末标点，不把较长数字的子串当成原文值',()=>{
  assert.equal(sourceHasValue('Error drops to 19.7%.','19.7%'),true);
  assert.equal(sourceHasValue('Batch size is 32.','32'),true);
  assert.equal(sourceHasValue('Value is 132.','32'),false);
  assert.equal(sourceHasValue('Value is 32.4.','32'),false);
});
