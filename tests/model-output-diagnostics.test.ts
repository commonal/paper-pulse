import {stub} from './setup.ts';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {chatJson,ModelOutputError} from '@aihot/backend/providers/llm';
import {paperTaskFailure} from '../modules/papers/backend/task-errors.ts';

const provider=await stub(()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({observations:Array(8).fill('原回答文字不应进入错误提示')})}}]}));
Object.assign(process.env,{LLM_BASE_URL:provider.url,LLM_API_KEY:'test-key',LLM_MODEL:'format-fixture'});config.modelCallsEnabled=true;
after(async()=>{await provider.close();await closeDb();});
test('真实模型解析错误提示保留字段路径和上限，不泄露原回答，不误导用户改配置',async()=>{
  let failedReceipt:number|null=null;
  await assert.rejects(chatJson({model:'default',purpose:'format_test',subject:randomUUID(),promptVersion:'test',system:'fixture',user:'fixture',schema:z.object({observations:z.array(z.string()).max(6)})}),(error:any)=>{
    assert(error instanceof ModelOutputError);assert.equal(error.outputIssue,'字段 observations 超过上限 6');
    const failure=paperTaskFailure(error);assert.match(failure.error,/observations.*6/);assert.doesNotMatch(failure.error,/原回答文字|修正配置/);
    failedReceipt=error.receiptId;return true;
  });
  const [receipt]=await sql`SELECT status,response FROM receipts WHERE id=${failedReceipt!}`;
  assert.equal(receipt.status,'failed');assert.match(receipt.response.choices[0].message.content,/原回答文字/);
});
