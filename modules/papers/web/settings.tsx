import {useState} from 'react';
import {Link,useLoaderData} from 'react-router';
import {adminGet} from '@aihot/web/lib/admin.server';
import {useWrite} from './shared.tsx';
import {identity} from './identity.server.ts';
import {DIRECTIONS,HOT_DIRECTION,directionFor,planPreferences,planRules,type DiscoveryPlan,type PlanPreferences} from '../directions.ts';

type Settings={daily_limit:number;hot_limit:number;candidate_days:number};
type Preview={sampled:number;matched:number;capped:boolean;matches:{id:string;title:string;abstract:string;published:string;reasons:{planId:string;reason:string}[]}[]};
export const handle={tab:'me',name:'关注与检索设置'};
export const meta=()=>[{title:'关注与检索设置 · 研脉'}];
export const headers=()=>({'Cache-Control':'private, no-store'});
export async function loader({request}:{request:Request}){
  const [data,me]=await Promise.all([adminGet<{plans:DiscoveryPlan[];settings:Settings}>(request,'/api/admin/papers/plans'),identity(request)]);
  return {...data,me};
}
const split=(value:string)=>value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean);
function planInput(plan:DiscoveryPlan){return {id:plan.id,enabled:plan.enabled,categories:plan.categories,keywords:plan.keywords,preferences:planPreferences(plan)};}
function KeywordField({values,onChange,disabled,multiline=false}:{values:string[];onChange:(values:string[])=>void;disabled:boolean;multiline?:boolean}){
  const [text,setText]=useState(values.join(', '));
  const change=(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{setText(event.target.value);onChange(split(event.target.value));};
  return multiline?<textarea disabled={disabled} rows={2} value={text} onChange={change}/>:<input disabled={disabled} value={text} onChange={change}/>;
}
export default function SettingsPage(){
  const data=useLoaderData<typeof loader>();
  const [plans,setPlans]=useState(data.plans),[settings,setSettings]=useState(data.settings),[notice,setNotice]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[dirty,setDirty]=useState<string[]>([]),[quotaDirty,setQuotaDirty]=useState(false);
  const [previewPlan,setPreviewPlan]=useState('');
  const {write,busy,error}=useWrite(data.me.csrf);
  const updatePlan=(id:string,patch:Partial<DiscoveryPlan>)=>{setPlans(current=>current.map(p=>p.id===id?{...p,...patch}:p));setDirty(current=>[...new Set([...current,id])]);setNotice('');setPreview(null);if(patch.enabled===false&&previewPlan===id)setPreviewPlan('');};
  const options=(plan:DiscoveryPlan,patch:Partial<PlanPreferences>)=>updatePlan(plan.id,{preferences:{...planPreferences(plan),...patch}});
  const updateSettings=(patch:Partial<Settings>)=>{setSettings(current=>({...current,...patch}));setQuotaDirty(true);setNotice('');setPreview(null);};
  const save=async()=>{
    setNotice('');
    const saved:string[]=[];
    for(const plan of plans.filter(p=>dirty.includes(p.id))){
      const {id,...body}=planInput(plan);const result=await write<DiscoveryPlan>(`/api/admin/papers/plans/${id}`,'PATCH',body);
      if(!result){setDirty(current=>current.filter(id=>!saved.includes(id)));return;}
      saved.push(id);setPlans(current=>current.map(p=>p.id===id?result:p));
    }
    setDirty([]);
    if(quotaDirty){const result=await write<Settings>('/api/admin/papers/settings','PATCH',settings);if(!result)return;setSettings(result);setQuotaDirty(false);}
    setNotice('关注与检索设置已保存，将用于后续检索；今日已入选论文继续保留。');
  };
  const viewPreview=async()=>{const result=await write<Preview>('/api/admin/papers/plans/preview','POST',{plans:plans.filter(p=>p.enabled&&p.kind==='personal'&&(!previewPlan||p.id===previewPlan)).map(planInput),days:settings.candidate_days});if(result)setPreview(result);};
  const card=(plan:DiscoveryPlan)=>{
    const direction=directionFor(plan.id),preferences=planPreferences(plan),rules=planRules(plan);
    const title=direction?.title??HOT_DIRECTION.title;
    return <section key={plan.id} className="pp-panel pp-direction" data-enabled={plan.enabled}>
      <div className="pp-plan-head"><div><h3>{title}</h3><p className="pp-muted">{direction?.description??HOT_DIRECTION.description}</p></div>
        <label className="pp-toggle"><input type="checkbox" aria-label={`关注${title}`} checked={plan.enabled} disabled={busy} onChange={e=>updatePlan(plan.id,{enabled:e.target.checked})}/>{plan.kind==='hot'?'启用':'关注'}</label></div>
      {plan.enabled&&<>
        {plan.kind==='personal'&&<label className="pp-toggle pp-priority"><input type="checkbox" aria-label={`${title}重点关注`} checked={preferences.priority} disabled={busy} onChange={e=>options(plan,{priority:e.target.checked})}/>重点关注 <span className="pp-muted">推荐次数相同时优先</span></label>}
        {preferences.mode==='custom'?<div className="pp-custom-note">正在使用你原有的自定义检索条件。<button className="pp-text-button" disabled={busy} onClick={()=>options(plan,{mode:'preset',topicIds:[],precision:'precise'})}>使用推荐规则</button></div>:direction&&<fieldset className="pp-topic-options"><legend>细分主题 <span>不选则关注整个方向</span></legend>{direction.topics.map(topic=><label key={topic.id}><input type="checkbox" disabled={busy} checked={preferences.topicIds.includes(topic.id)} onChange={e=>options(plan,{topicIds:e.target.checked?[...preferences.topicIds,topic.id]:preferences.topicIds.filter(id=>id!==topic.id)})}/>{topic.title}</label>)}</fieldset>}
        <label className="pp-precision">匹配范围<select aria-label={`${title}匹配范围`} disabled={busy} value={preferences.precision} onChange={e=>options(plan,{precision:e.target.value as PlanPreferences['precision']})}><option value="precise">更精准：标题命中</option><option value="broad">更广泛：标题或摘要命中</option></select></label>
        <details className="pp-direction-advanced"><summary>高级自定义</summary>
          <label>规则来源<select disabled={busy} value={preferences.mode} onChange={e=>options(plan,{mode:e.target.value as PlanPreferences['mode'],topicIds:[]})}><option value="preset">预设方向规则</option><option value="custom">自定义分类与关键词</option></select></label>
          {preferences.mode==='custom'?<><label>arXiv 分类（逗号分隔）<KeywordField key="categories" disabled={busy} values={plan.categories} onChange={categories=>updatePlan(plan.id,{categories})}/></label><label>匹配关键词（任意一个命中；留空则按分类）<KeywordField key="custom-keywords" multiline disabled={busy} values={plan.keywords} onChange={keywords=>updatePlan(plan.id,{keywords})}/></label></>:<><p className="pp-muted">检索分类：{rules.categories.join('、')}</p><label>补充匹配词（任意一个也可命中）<KeywordField key="extra-keywords" multiline disabled={busy} values={preferences.extraKeywords} onChange={extraKeywords=>options(plan,{extraKeywords})}/></label></>}
          <label>排除词（标题或摘要出现则排除）<KeywordField multiline disabled={busy} values={preferences.excludedKeywords} onChange={excludedKeywords=>options(plan,{excludedKeywords})}/></label>
        </details>
      </>}
    </section>;
  };
  const ordered=DIRECTIONS.flatMap(d=>{const plan=plans.find(p=>p.id===d.id);return plan?[plan]:[];});
  const hot=plans.find(p=>p.id===HOT_DIRECTION.id);
  return <div className="pp-page pp-settings">
    <Link className="pp-back" to="/more">← 我的</Link>
    <div className="pp-heading"><div><p className="pp-eyebrow">DISCOVERY · PREFERENCES</p><h1>关注与检索设置</h1><p>选择想读的方向，预览匹配结果，再保存。每天北京时间 06:00 开始检索。</p></div></div>
    <section><h2>我的关注方向</h2><p className="pp-muted">已关注 {plans.filter(p=>p.enabled&&p.kind==='personal').length} 个方向。每日名额固定，按近7天推荐次数兼顾各方向，次数相同时优先重点关注。</p><div className="pp-directions-grid">{ordered.map(card)}</div></section>
    <section className="pp-reading-settings"><h2>每日阅读安排</h2><p className="pp-muted">每日最多入选三篇，解读完成时间取决于处理进度；开启更多方向不会增加每日配额。</p>
      {hot&&card(hot)}
      <div className="pp-panel pp-form-grid pp-quota-grid">
        <label>每日入选上限<select disabled={busy} value={settings.daily_limit} onChange={e=>updateSettings({daily_limit:Number(e.target.value)})}>{[1,2,3].map(n=><option key={n} value={n}>{n} 篇</option>)}</select></label>
        <label>热点名额上限<select disabled={busy} value={settings.hot_limit} onChange={e=>updateSettings({hot_limit:Number(e.target.value)})}><option value={0}>不安排热点名额</option><option value={1}>最多 1 篇</option></select></label>
        <label>候选有效天数<select disabled={busy} value={settings.candidate_days} onChange={e=>updateSettings({candidate_days:Number(e.target.value)})}>{Array.from({length:14},(_,i)=>i+1).map(n=><option key={n} value={n}>{n} 天</option>)}</select></label>
      </div>
    </section>
    <div className="pp-settings-actions"><button className="pp-button" disabled={busy||(!dirty.length&&!quotaDirty)} onClick={save}>{busy?'处理中…':'保存设置'}</button><select aria-label="预览方向" disabled={busy} value={previewPlan} onChange={e=>{setPreviewPlan(e.target.value);setPreview(null);}}><option value="">全部关注方向</option>{plans.filter(p=>p.enabled&&p.kind==='personal').map(p=><option key={p.id} value={p.id}>{directionFor(p.id)?.title??p.title}</option>)}</select><button className="pp-button secondary" disabled={busy} onClick={viewPreview}>预览匹配结果</button><span className="pp-muted">{dirty.length||quotaDirty?'有未保存修改':'设置已保存'} · 预览个人方向的当前表单条件</span></div>
    {notice&&<p className="pp-success" role="status">{notice}</p>}{error&&<p className="pp-error" role="alert">{error}</p>}
    {preview&&<section className="pp-preview" aria-label="匹配结果预览"><h2>匹配结果预览</h2><p className="pp-muted">本地最近{settings.candidate_days}天收录的{preview.sampled}篇元数据中，{preview.matched}篇匹配{preview.capped?'（样本上限500篇）':''}，最多展示20篇。此结果不代表 arXiv 的全部检索结果。</p>
      {preview.matches.length?preview.matches.map(paper=><article className="pp-panel" key={paper.id}><Link to={`/papers/${paper.id}`}><h3>{paper.title}</h3></Link><p className="pp-muted">{paper.published||'日期未标注'}</p><p>{paper.abstract||'暂无摘要'}</p><ul>{paper.reasons.map(reason=><li key={reason.planId}>命中：{reason.reason}</li>)}</ul></article>):<div className="pp-empty">当前本地样本没有匹配结果，可调整细分主题或匹配范围后再预览。</div>}
    </section>}
  </div>;
}
