import './setup.ts';
import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {config} from '@aihot/backend/config';
import {jinaRead} from '@aihot/backend/providers/jina';
import {BudgetExceededError,ReceiptUnknownError,ProviderRejectedError} from '@aihot/backend/providers/receipts';

let mode='ok',hits:{auth:boolean;path:string}[]=[];
const fakeKey='test-jina-fallback-key';
const server=http.createServer((req,res)=>{
  const auth=!!req.headers.authorization;hits.push({auth,path:req.url!});
  if(auth&&mode==='drop'){req.socket.destroy();return;}
  const status=auth&&mode!=='ok'?Number(mode):200;
  res.writeHead(status,{'content-type':'text/plain'});
  if(status!==200){res.end(`key ${fakeKey}: insufficient balance or rejected`);return;}
  res.end('Title: Fixture\nURL Source: https://example.org\n\nMarkdown Content:\nThe public page reports the research findings.');
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
process.env.JINA_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
config.allowPrivateNetworkFetch=true;
before(async()=>{await sql`UPDATE budgets SET per_minute=1000,per_hour=1000,per_day=1000 WHERE service='jina'`;});
after(async()=>{server.close();await stopBoss();await closeDb();});
function input(name:string){return {url:`https://example.org/jina-${name}`,opts:{purpose:'body_fallback',subject:'article:jina-'+name}};}
test('无密钥时匿名读取也保留回执与预算，同页重试复用结果',async()=>{
  delete process.env.JINA_API_KEY;mode='ok';hits=[];const p=input('no-key');
  const first=await jinaRead(p.url,p.opts),again=await jinaRead(p.url,p.opts);
  assert.match(first.markdown,/research findings/);assert.equal(first.receiptId,again.receiptId);
  assert.deepEqual(hits.map(h=>h.auth),[false]);
  const [saved]=await sql`SELECT request,cost FROM receipts WHERE id=${first.receiptId}`;
  assert.equal(saved.request.authMode,'anonymous');assert.equal(saved.cost,null);
});
test('优先带密钥；明确401或402才转匿名，并保留拒绝回执且避免重复试坏密钥',async()=>{
  process.env.JINA_API_KEY=fakeKey;
  for(const status of [401,402]){
    mode=String(status);hits=[];const p=input('fallback-'+status);
    const result=await jinaRead(p.url,p.opts);await jinaRead(p.url,p.opts);
    assert.deepEqual(hits.map(h=>h.auth),[true,false]);
    const rows=await sql`SELECT id,request,status,error FROM receipts WHERE subject=${p.opts.subject} ORDER BY id`;
    assert.deepEqual(rows.map(r=>r.status),['failed','received']);assert.equal(rows[1].request.authMode,'anonymous');
    assert.ok(!JSON.stringify(rows).includes(fakeKey),'密钥不能进入回执或错误');
    assert.equal(result.receiptId,rows[1].id);
  }
  mode='ok';hits=[];const p=input('with-key');await jinaRead(p.url,p.opts);assert.deepEqual(hits.map(h=>h.auth),[true]);
});
test('目标403、限流429或供应商500不切换身份重试',async()=>{
  process.env.JINA_API_KEY=fakeKey;
  for(const status of [403,429,500]){
    mode=String(status);hits=[];const p=input('refused-'+status);
    await assert.rejects(jinaRead(p.url,p.opts),ProviderRejectedError);
    assert.deepEqual(hits.map(h=>h.auth),[true]);
    const [r]=await sql`SELECT error FROM receipts WHERE subject=${p.opts.subject}`;assert.ok(!r.error.includes(fakeKey));
  }
});
test('连接结果未知后不转匿名，删除密钥也不能绕过原未知回执',async()=>{
  process.env.JINA_API_KEY=fakeKey;mode='drop';hits=[];const p=input('unknown');
  await assert.rejects(jinaRead(p.url,p.opts),ReceiptUnknownError);
  delete process.env.JINA_API_KEY;mode='ok';
  await assert.rejects(jinaRead(p.url,p.opts),ReceiptUnknownError);
  assert.equal(hits.length,1);
});
test('本站预算为零时不通过匿名绕过熔断',async()=>{
  delete process.env.JINA_API_KEY;hits=[];const p=input('budget');
  await sql`UPDATE budgets SET per_day=0 WHERE service='jina'`;
  try{await assert.rejects(jinaRead(p.url,p.opts),BudgetExceededError);assert.equal(hits.length,0);}
  finally{await sql`UPDATE budgets SET per_day=1000 WHERE service='jina'`;}
});
test('密钥被拒和匿名读取分别计次，不能借降级绕过本机额度',async()=>{
  process.env.JINA_API_KEY=fakeKey;mode='402';hits=[];const p=input('fallback-budget');
  const [used]=await sql`SELECT count(*)::int AS n FROM receipt_attempts WHERE service='jina' AND origin='live' AND started_at>now()-interval '1 day'`;
  await sql`UPDATE budgets SET per_day=${used.n+1} WHERE service='jina'`;
  try{await assert.rejects(jinaRead(p.url,p.opts),BudgetExceededError);assert.deepEqual(hits.map(h=>h.auth),[true]);}
  finally{await sql`UPDATE budgets SET per_day=1000 WHERE service='jina'`;}
});
