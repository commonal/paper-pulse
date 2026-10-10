// Product topics map to source-specific queries; these are not arXiv subject categories.
export interface PlanPreferences {
  mode:'preset'|'custom';topicIds:string[];priority:boolean;precision:'precise'|'broad';extraKeywords:string[];excludedKeywords:string[];
}
export interface DiscoveryPlan {
  id:string;kind:'hot'|'personal';title:string;enabled:boolean;categories:string[];keywords:string[];updated_at:string;
  preferences:PlanPreferences|null;
}
type Groups=string[][];
type Topic={id:string;title:string;groups:Groups};
type Direction={id:string;title:string;description:string;categories:string[];groups:Groups;topics:Topic[]};
const topic=(id:string,title:string,...groups:string[][]):Topic=>({id,title,groups});
export const DIRECTIONS:Direction[]=[
  {id:'personal-rag',title:'RAG 与信息检索',description:'检索增强生成、搜索与重排序',categories:['cs.IR','cs.CL','cs.AI'],groups:[['retrieval augmented generation','RAG','retrieval','reranking']],topics:[
    topic('rag','检索增强生成',['retrieval augmented generation','RAG']),topic('search','检索与重排序',['dense retrieval','hybrid retrieval','reranking','information retrieval']),topic('agentic-rag','Agentic RAG',['agentic RAG','agentic retrieval'])]},
  {id:'personal-multimodal',title:'多模态大模型',description:'图文、视频和语音的联合理解',categories:['cs.CV','cs.MM','cs.CL','cs.AI','cs.SD'],groups:[['multimodal','vision language','VLM','audio language']],topics:[
    topic('vision','图文理解',['vision language','VLM','visual question answering']),topic('video','视频理解',['video'],['language model','multimodal','understanding']),topic('audio','语音与音频',['audio language','speech language','speech large language','multimodal audio'])]},
  {id:'personal-llm-rec',title:'大模型推荐',description:'大模型与生成式推荐方法',categories:['cs.IR','cs.LG','cs.AI'],groups:[['recommendation','recommender'],['large language model','LLM','generative']],topics:[
    topic('generative','生成式推荐',['generative recommendation','generative recommender']),topic('sequential','大模型序列推荐',['sequential recommendation'],['large language model','LLM','generative']),topic('llm-rec','大模型推荐方法',['recommendation','recommender'],['large language model','LLM'])]},
  {id:'personal-agent',title:'Agent 与工具使用',description:'工具调用、规划、记忆与协作',categories:['cs.AI','cs.CL','cs.MA','cs.SE'],groups:[['language agent','LLM agent','agentic','tool use','tool calling','multi agent']],topics:[
    topic('tools','工具调用',['tool use','tool calling','function calling']),topic('planning','规划与记忆',['agent','agentic'],['planning','memory']),topic('multi-agent','多智能体协作',['multi agent','multiagent'],['language model','LLM','agentic'])]},
  {id:'personal-alignment',title:'训练与对齐',description:'微调、偏好优化与强化学习',categories:['cs.CL','cs.LG','cs.AI'],groups:[['language model','LLM'],['pretraining','pre training','fine tuning','alignment','preference optimization','reinforcement learning']],topics:[
    topic('finetuning','预训练与微调',['language model','LLM'],['pretraining','pre training','fine tuning','instruction tuning']),topic('preference','偏好优化',['direct preference optimization','DPO','RLHF','preference optimization']),topic('rl','强化学习',['language model','LLM'],['reinforcement learning','GRPO','RLVR'])]},
  {id:'personal-reasoning',title:'推理与评测',description:'推理能力、可靠性与基准评测',categories:['cs.CL','cs.AI','cs.LG'],groups:[['language model','LLM'],['reasoning','evaluation','benchmark','hallucination']],topics:[
    topic('reasoning','数学与代码推理',['language model','LLM'],['reasoning','chain of thought']),topic('evaluation','评测与基准',['language model','LLM'],['evaluation','benchmark']),topic('reliability','可靠性与安全',['language model','LLM'],['hallucination','robustness','safety'])]},
  {id:'personal-efficiency',title:'高效训练与推理',description:'量化、蒸馏、稀疏模型与加速',categories:['cs.LG','cs.CL','cs.DC','cs.AI'],groups:[['language model','LLM','transformer'],['quantization','distillation','sparse','inference acceleration','speculative decoding']],topics:[
    topic('compression','量化与蒸馏',['language model','LLM'],['quantization','distillation']),topic('sparse','稀疏模型',['mixture of experts','sparse language model','MoE']),topic('inference','推理加速',['speculative decoding','KV cache','inference acceleration'])]},
  {id:'personal-code',title:'代码与软件工程',description:'代码生成、程序修复与开发 Agent',categories:['cs.SE','cs.CL','cs.AI'],groups:[['code generation','program repair','coding agent','software engineering agent']],topics:[
    topic('generation','代码生成',['code generation','code language model']),topic('repair','程序修复',['program repair','automated bug fixing']),topic('coding-agent','开发 Agent',['coding agent','software engineering agent','SWE agent'])]},
];
export const HOT_DIRECTION={id:'hot-ai',title:'AI 热点发现',description:'在 AI 分类中发现近期论文；最多占用一个每日名额',categories:['cs.AI','cs.LG','cs.CL','cs.CV','cs.IR','cs.MM']};
export function defaultPreferences(mode:PlanPreferences['mode']='preset'):PlanPreferences{
  return {mode,topicIds:[],priority:false,precision:mode==='custom'?'broad':'precise',extraKeywords:[],excludedKeywords:[]};
}
export function planPreferences(plan:DiscoveryPlan){return plan.preferences??defaultPreferences('custom');}
export function directionFor(id:string){return DIRECTIONS.find(direction=>direction.id===id);}
export function planRules(plan:DiscoveryPlan){
  const options=planPreferences(plan);const direction=directionFor(plan.id);
  if(options.mode==='custom')return {categories:plan.categories,clauses:plan.keywords.map(term=>[[term]]),topics:[] as Topic[]};
  const topics=direction?.topics.filter(t=>options.topicIds.includes(t.id))??[];
  const clauses:Groups[]=topics.length?topics.map(t=>t.groups):direction?[direction.groups]:[];
  return {categories:direction?.categories??HOT_DIRECTION.categories,clauses:[...clauses,...options.extraKeywords.map(term=>[[term]])],topics};
}
function normalized(value:string){return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function containsTerm(value:string,term:string){
  const text=normalized(value),word=normalized(term);
  return !!word&&(/\p{Script=Han}/u.test(word)?text.includes(word):(` ${text} `).includes(` ${word} `));
}
export function matchPlan(plan:DiscoveryPlan,paper:{title:string;abstract:string;categories?:string[]},checkCategories=true){
  const rules=planRules(plan),options=planPreferences(plan);
  const categories=(paper.categories??[]).filter(c=>rules.categories.includes(c));
  if(checkCategories&&!categories.length)return null;
  const corpus=options.precision==='precise'?paper.title:`${paper.title} ${paper.abstract}`;
  if(options.excludedKeywords.some(term=>containsTerm(`${paper.title} ${paper.abstract}`,term)))return null;
  const hitClauses=rules.clauses.filter(groups=>groups.every(group=>group.some(term=>containsTerm(corpus,term))));
  if(rules.clauses.length&&!hitClauses.length)return null;
  const keywords=[...new Set(hitClauses.flat(2).filter(term=>containsTerm(corpus,term)))];
  const topics=rules.topics.filter(t=>t.groups.every(g=>g.some(term=>containsTerm(corpus,term)))).map(t=>t.title);
  return {categories,keywords,topics,score:categories.length+keywords.length*2,reason:`${plan.title}${topics.length?' → '+topics.join('、'):''}${keywords.length?'（'+keywords.join('、')+'）':''}`};
}
function quoted(term:string){return '"'+normalized(term)+'"';}
export function keywordExpression(plan:DiscoveryPlan,field?:(term:string)=>string){
  const rules=planRules(plan);const render=field??quoted;
  return rules.clauses.length?'('+rules.clauses.map(groups=>'('+groups.map(group=>'('+group.map(render).join(' OR ')+')').join(' AND ')+')').join(' OR ')+')':'';
}
export function arxivExpression(plan:DiscoveryPlan){
  const options=planPreferences(plan),rules=planRules(plan);
  const render=(term:string)=>options.precision==='precise'?`ti:${quoted(term)}`:`(ti:${quoted(term)} OR abs:${quoted(term)})`;
  const keyword=keywordExpression(plan,render);
  const excludes=options.excludedKeywords.map(term=>`ANDNOT (ti:${quoted(term)} OR abs:${quoted(term)})`).join(' ');
  return `(${rules.categories.map(c=>`cat:${c}`).join(' OR ')})${keyword?' AND '+keyword:''}${excludes?' '+excludes:''}`;
}
export function openAlexExpression(plan:DiscoveryPlan){
  const keyword=keywordExpression(plan)||'("artificial intelligence" OR "machine learning")';
  const excluded=planPreferences(plan).excludedKeywords;
  return keyword+(excluded.length?' NOT ('+excluded.map(quoted).join(' OR ')+')':'');
}
