import type {WebModule} from '../../apps/web/app/modules.ts';
import {IconBolt,IconBookmark,IconDoc,IconFlame,IconGrid,IconHistory,IconList,IconUser} from '../../apps/web/app/components/icons.tsx';
import {navigationGroups,navigationTabs,tabAliases,paperNavigationPath} from './navigation.ts';
import {NewsSectionNav} from './web/navigation.tsx';
const icons={bolt:IconBolt,bookmark:IconBookmark,doc:IconDoc,flame:IconFlame,grid:IconGrid,history:IconHistory,list:IconList,user:IconUser};
const icon=(name:string)=>icons[name as keyof typeof icons];
export default {
  name:'papers',
  navigation:{sections:navigationGroups.map(group=>({...group,items:group.items.map(item=>({...item,icon:icon(item.icon)}))})),
    tabs:navigationTabs.map(tab=>({...tab,icon:icon(tab.icon)})),tabAliases,resolveActivePath:paperNavigationPath},
  tools:[{to:'/papers/settings',label:'关注方向与检索设置',icon:<IconGrid size={20}/>},
    {to:'/papers/history',label:'论文阅读记录',icon:<IconHistory size={20}/>}],
  root:{Top:NewsSectionNav},
} satisfies WebModule;
