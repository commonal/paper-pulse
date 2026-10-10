import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeReadingJson} from '../backend/reading-json.ts';
test('只修正正常停止回答末尾的容器括号，不改主张内容',()=>{
  const complete={sections:[{id:'limitations',claims:[{text:'The claim',evidence_block_ids:[]}]}]};
  const text=JSON.stringify(complete);
  const missing=text.slice(0,-2);
  const restored=decodeReadingJson(missing,'stop');assert.deepEqual(restored.data,complete);assert.equal(restored.repair!.policy,'terminal-delimiters-only');
  const review={checks:[],final:complete};
  const wrong=JSON.stringify(review).replace(/\]\}\}$/,'}}}');
  assert.deepEqual(decodeReadingJson(wrong,'stop').data,review);
});
test('输出长度截断、字符串截断、内部语法错误和未知停止原因均不补全',()=>{
  assert.throws(()=>decodeReadingJson('{"sections":[]}','length'),/输出上限/);
  assert.throws(()=>decodeReadingJson('{"text":"unfinished}', 'stop'));
  assert.throws(()=>decodeReadingJson('{"items":[{"x":1},]}','stop'));
  assert.throws(()=>decodeReadingJson('{"items":[1}',undefined));
  assert.throws(()=>decodeReadingJson('{"items":[{"x":1}]},"extra":2}', 'stop'));
  assert.deepEqual(decodeReadingJson('{"sections":[]}','stop'),{data:{sections:[]}});
});
