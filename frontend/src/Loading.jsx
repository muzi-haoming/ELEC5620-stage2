import React from 'react';
import {Link,useLocation} from 'react-router-dom';
import {useLanguage} from './Language';

const TITLES={buyer:'Buyer · 买家',seller:'Seller · 卖家',manager:'Admin · 经营者'};

function Status({failed,slow,onRetry}){
 const t=useLanguage();
 if(failed)return <div className="load-status failed" role="alert"><p>{t('服务暂时不可用，请稍后重试。')}</p><button className="button secondary" onClick={onRetry}>{t('重试')}</button></div>;
 return <div className="load-status" role="status" aria-live="polite"><p><span className="loading-spinner" aria-hidden="true"/>{t('正在加载…')}</p>{slow&&<small>{t('正在连接数据库，首次加载可能需要几秒。')}</small>}</div>;
}

function Cards({count=3}){
 return <div className="skeleton-grid" aria-hidden="true">{Array.from({length:count},(_,i)=><div key={i} className="skeleton-card"><span className="skeleton block"/><span className="skeleton line"/><span className="skeleton line short"/></div>)}</div>;
}

// Shown only before any data for the current role has arrived. Uses the same shell and theme
// classes as the real page, so the layout and role colours are already in place while loading.
export function LoadingScreen({failed,slow,onRetry}){
 const t=useLanguage();
 const role=useLocation().pathname.split('/')[1];
 const status=<Status failed={failed} slow={slow} onRetry={onRetry}/>;
 if(!TITLES[role])return <main className="public-page loading-public" aria-busy={!failed}><Link to="/" className="brand"><span className="chair-mark">▰</span>second space</Link>{status}{!failed&&<><span className="skeleton heading" aria-hidden="true"/><Cards count={2}/></>}</main>;
 const navCount=role==='manager'?3:2;
 return <div className={'shell theme-'+role} aria-busy={!failed}>
  <aside className="sidebar"><Link to="/" className="brand"><span className="chair-mark">▰</span>second space</Link><div className="role-label">{t(TITLES[role])}</div><nav aria-hidden="true">{Array.from({length:navCount},(_,i)=><span key={i} className="skeleton nav-item"/>)}</nav><div className="sidebar-bottom"><Link to="/">{t('← 返回角色入口')}</Link></div></aside>
  <div className="workspace"><header className="topbar"><span>⌖ Sydney, NSW</span><span className="top-note">{t(TITLES[role])}</span><span className="avatar">{role==='manager'?'A':role[0].toUpperCase()}</span></header>
   <main>{status}{!failed&&<><span className="skeleton heading" aria-hidden="true"/><span className="skeleton line wide" aria-hidden="true"/><Cards/></>}</main>
  </div>
 </div>;
}
