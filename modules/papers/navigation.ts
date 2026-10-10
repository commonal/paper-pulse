export const readingEntries=[
  {to:'/',label:'今日阅读',icon:'bolt',end:true},
  {to:'/papers/mine',label:'我的论文',icon:'bookmark'},
  {to:'/papers/library',label:'已精读论文',icon:'list'},
  {to:'/papers/history',label:'阅读记录',icon:'history'},
];
export const discoveryEntries=[
  {to:'/papers/candidates',label:'候选论文',icon:'list'},
  {to:'/papers/impact',label:'CCF A 高引',icon:'doc'},
  {to:'/papers/trends',label:'方向趋势',icon:'grid'},
];
export const newsEntries=[
  {to:'/news/featured',label:'新闻精选',icon:'bolt'},
  {to:'/all',label:'全部动态',icon:'list'},
  {to:'/hot',label:'热点榜',icon:'flame'},
  {to:'/daily',label:'日报 / 周报',icon:'doc',activePaths:['/daily','/weekly','/monthly']},
  {to:'/topics',label:'主题',icon:'grid'},
];
export const personalEntries=[
  {to:'/papers/settings',label:'关注与检索设置',icon:'grid'},
  {to:'/papers/evaluation',label:'精读评测',icon:'doc'},
  {to:'/starred',label:'新闻收藏',icon:'bookmark'},
  {to:'/more',label:'外观与设置',icon:'user',changelog:true},
];
export const navigationGroups=[
  {title:'阅读',items:readingEntries},
  {title:'发现',items:discoveryEntries},
  {title:'AI 资讯',items:newsEntries},
  {title:'个人与设置',items:personalEntries},
];
export const navigationTabs=[
  {key:'reading',to:'/',label:'阅读',icon:'doc'},
  {key:'discovery',to:'/papers/candidates',label:'发现',icon:'grid'},
  {key:'news',to:'/news/featured',label:'资讯',icon:'flame'},
  {key:'me',to:'/more',label:'我的',icon:'user',changelog:true},
];
export const tabAliases={featured:'news',hot:'news',daily:'news'};

/** Only same-site paper list routes can become a paper's return target. */
export function paperReturnTarget(value:unknown) {
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.length>2000)return null;
  const url=new URL(value,'http://paperpulse.local');
  const item=[...readingEntries,...discoveryEntries].find(entry=>entry.to===url.pathname);
  return item&&url.origin==='http://paperpulse.local'?{to:url.pathname+url.search,label:item.label}:null;
}

export function paperNavigationPath(pathname:string,state:unknown){
  if(pathname==='/papers/new')return '/papers/mine';
  if(!/^\/papers\/[0-9a-f-]{36}$/.test(pathname))return pathname;
  const value=state&&typeof state==='object'&&'paperReturn' in state?state.paperReturn:undefined;
  return new URL(paperReturnTarget(value)?.to??'/','http://paperpulse.local').pathname;
}
