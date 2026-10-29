import React,{createContext,useContext,useState,useEffect,useRef} from 'react';
import {useLanguage} from './Language';
import {useLocation} from 'react-router-dom';
const C=createContext();
function identity(){const h=location.hash;return {role:h.startsWith('#/manager')?'manager':h.startsWith('#/seller')?'seller':h.startsWith('#/property-confirm/')?'property':'buyer',token:h.startsWith('#/property-confirm/')?decodeURIComponent(h.split('/')[2]):''};}
export function Store({children}){
 const route=useLocation();
 const currentIdentity=JSON.stringify(identity());
 const [loadedIdentity,setLoadedIdentity]=useState('');
 const t=useLanguage(),[s,setS]=useState(null),[notice,setNotice]=useState(''),[failure,setFailure]=useState(false),epoch=useRef(0),pending=useRef(0),refreshing=useRef(false);
 const [operation,setOperation]=useState(''),[slow,setSlow]=useState(false);
 useEffect(()=>{setSlow(false);if(!operation)return;const timer=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(timer);},[operation]);
 const clockSync=useRef(null);
 const receive=(data)=>{clockSync.current={now:data.now,wall:performance.now()};setS(data);};
 useEffect(()=>{const timer=setInterval(()=>{const clock=clockSync.current;if(clock)setS(prev=>prev?{...prev,now:Math.max(prev.now,clock.now+performance.now()-clock.wall)}:prev);},1000);return()=>clearInterval(timer);},[]);
 const headers=()=>{const x=identity();return {'X-Demo-Role':x.role,'X-Property-Token':x.token};};
 const refresh=async()=>{const stamp=epoch.current;const who=JSON.stringify(identity());if(pending.current||refreshing.current)return;refreshing.current=true;try{const r=await fetch('/api/state',{headers:headers()});if(!r.ok)throw Error('服务暂时不可用，请稍后重试。');const data=await r.json();if(stamp===epoch.current&&!pending.current){receive(data);setLoadedIdentity(who);setFailure(false);}}catch(e){if(stamp===epoch.current){setFailure(true);setNotice(e.message);}}finally{refreshing.current=false;}};
 useEffect(()=>{epoch.current++;refresh();},[currentIdentity]);
 useEffect(()=>{window.addEventListener('focus',refresh);const timer=setInterval(refresh,2000);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
 useEffect(()=>{if(notice){const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);}},[notice]);
 const run=async(operation,payload={})=>{if(pending.current)return null;pending.current++;setOperation(operation);epoch.current++;const stamp=epoch.current;try{const r=await fetch('/api/actions',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({operation,payload,requestId:crypto.randomUUID()})});const data=await r.json();if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:'操作未完成，请检查输入。');if(stamp===epoch.current){receive(data.state);setLoadedIdentity(JSON.stringify(identity()));}return data.result;}catch(e){setNotice(e.message||'操作未完成');return null;}finally{pending.current--;setOperation('');if(!pending.current)refresh();}};
 const reset=()=>run('reset');
 if(!s||loadedIdentity!==currentIdentity)return <main className="public-page"><p role="status">{t(failure?'服务暂时不可用，请稍后重试。':'正在加载…')}</p><button onClick={refresh}>{t('重试')}</button></main>;
 return <C.Provider value={{s,run,notify:setNotice,reset,operation}}>{children}{operation&&<div className="request-progress" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true"/>{t(slow?'处理仍在进行，请稍候，无需重复点击。':'正在处理，请稍候…')}</div>}{notice&&<div className="toast" role="status">{t(notice)}<button onClick={()=>setNotice('')}>×</button></div>}</C.Provider>;
}
export const useStore=()=>useContext(C);
