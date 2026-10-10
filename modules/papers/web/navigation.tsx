import {Link,useLocation,useNavigate} from 'react-router';
import {readingEntries,discoveryEntries,newsEntries,paperReturnTarget} from '../navigation.ts';
import {historyIndex} from '../../../apps/web/app/components/shell/screens.ts';
import {markBack} from '../../../apps/web/app/components/shell/transitions.ts';
import './style.css';

export function PaperSectionNav({group}:{group:'reading'|'discovery'}){
  const {pathname}=useLocation();
  return <nav className="pp-subnav pp-section-nav" aria-label={group==='reading'?'阅读分类':'论文发现分类'}>
    {(group==='reading'?readingEntries:discoveryEntries).map(item=><Link key={item.to} to={item.to} aria-current={pathname===item.to?'page':undefined}>{item.label}</Link>)}
  </nav>;
}
export function NewsSectionNav(){
  const {pathname}=useLocation();
  if(!newsEntries.some(item=>pathname===item.to||item.activePaths?.some(path=>pathname===path||pathname.startsWith(`${path}/`))) && !pathname.startsWith('/topics/'))return null;
  return <nav className="pp-subnav pp-section-nav pp-news-nav" aria-label="AI 资讯分类">{newsEntries.map(item=>
    <Link key={item.to} to={item.to} aria-current={pathname===item.to||item.activePaths?.some(path=>pathname===path||pathname.startsWith(`${path}/`))||(item.to==='/topics'&&pathname.startsWith('/topics/'))?'page':undefined}>{item.label}</Link>)}</nav>;
}
export function PaperBackLink(){
  const location=useLocation();const navigate=useNavigate();
  const target=paperReturnTarget(location.state?.paperReturn)??{to:'/',label:'今日阅读'};
  return <Link className="pp-back" to={target.to} onClick={event=>{
    if(event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&paperReturnTarget(location.state?.paperReturn)&&historyIndex()>0){event.preventDefault();markBack();navigate(-1);}
  }}>← {target.label}</Link>;
}
