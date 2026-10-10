import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tag} from '../../../tests/setup.ts';
import {sql,closeDb} from '@aihot/backend/db';
import {after} from 'node:test';
import {listPapers} from '../backend/store.ts';
import {navigationGroups,navigationTabs,paperReturnTarget,tabAliases,paperNavigationPath} from '../navigation.ts';
after(closeDb);

test('四个桌面分组保留新闻入口，窄屏入口指向相同栏目',()=>{
  assert.deepEqual(navigationGroups.map(group=>group.title),['阅读','发现','AI 资讯','个人与设置']);
  assert.deepEqual(navigationTabs.map(tab=>tab.to),['/','/papers/candidates','/news/featured','/more']);
  const paths=navigationGroups.flatMap(group=>group.items.map(item=>item.to));
  assert.equal(paths.length,new Set(paths).size);
  for(const path of ['/papers/library','/papers/history','/all','/hot','/daily','/topics','/starred','/papers/settings'])assert.ok(paths.includes(path));
  assert.deepEqual(tabAliases,{featured:'news',hot:'news',daily:'news'});
});

test('从论文列表返回时保留筛选，不允许外站或其他页面作为返回目标',()=>{
  assert.deepEqual(paperReturnTarget('/papers/history?status=done&q=RAG'),{to:'/papers/history?status=done&q=RAG',label:'阅读记录'});
  assert.deepEqual(paperReturnTarget('/papers/candidates'),{to:'/papers/candidates',label:'候选论文'});
  const detail='/papers/'+randomUUID();
  assert.equal(paperNavigationPath(detail,{paperReturn:'/papers/library?q=RAG'}),'/papers/library');
  assert.equal(paperNavigationPath(detail,{paperReturn:'/papers/candidates?plan=rag'}),'/papers/candidates');
  assert.equal(paperNavigationPath(detail,null),'/');
  assert.equal(paperNavigationPath('/papers/settings',null),'/papers/settings');
  assert.deepEqual(paperReturnTarget('/papers/library?q=RAG'),{to:'/papers/library?q=RAG',label:'已精读论文'});
  for(const value of ['https://example.org','//example.org/papers/library','/admin','/papers/new',null,'/\\example.org/papers/library'])assert.equal(paperReturnTarget(value),null);
});

test('已精读列表只显示可阅读的解读，保留待读论文并排除失败和排队项',async()=>{
  const prefix=tag();const ids:string[]=[];
  for(const digest of ['ready','queued','generating','failed','unavailable','missing']){
    const id=randomUUID();ids.push(id);
    await sql`INSERT INTO papers (id,title,status,source_url) VALUES (${id},${prefix+' '+digest},'unread',${'https://example.org/'+id})`;
    if(digest!=='missing')await sql`INSERT INTO paper_digests (paper_id,status) VALUES (${id},${digest})`;
  }
  assert.equal((await listPapers(prefix)).length,6);
  const ready=await listPapers(prefix,'',true);
  assert.equal(ready.length,1);assert.equal(ready[0]!.id,ids[0]);assert.equal(ready[0]!.status,'unread');
  assert.equal((await listPapers(prefix+' failed','',true)).length,0);
  assert.equal((await listPapers(prefix,'done',true)).length,0);
  const [tasks]=await sql`SELECT count(*)::int AS n FROM paper_reading_tasks WHERE paper_id IN ${sql(ids)}`;
  assert.equal(tasks.n,0);
});

test('阅读记录按状态和搜索共同过滤，已收录论文读取不创建任务',async()=>{
  const prefix=tag();const ids=[];
  for(const status of ['unread','reading','done']){
    const id=randomUUID();ids.push(id);
    await sql`INSERT INTO papers (id,title,status,source_url) VALUES (${id},${prefix+' '+status},${status},${'https://example.org/'+id})`;
  }
  assert.equal((await listPapers(prefix)).length,3);
  assert.equal((await listPapers(prefix,'active')).length,2);
  assert.equal((await listPapers(prefix,'done'))[0]!.status,'done');
  assert.equal((await listPapers(prefix+' unread','done')).length,0);
  const [tasks]=await sql`SELECT count(*)::int AS n FROM paper_reading_tasks WHERE paper_id IN ${sql(ids)}`;
  assert.equal(tasks.n,0);
});
