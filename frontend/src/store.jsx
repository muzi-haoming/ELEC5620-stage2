import React,{createContext,useContext,useState,useEffect,useRef} from 'react';
import {useLanguage} from './Language';
import {useLocation} from 'react-router-dom';
import {LoadingScreen} from './Loading';
const C=createContext();
function identity(){const h=location.hash;return {role:h.startsWith('#/manager')?'manager':h.startsWith('#/seller')?'seller':h.startsWith('#/property-confirm/')?'property':'buyer',token:h.startsWith('#/property-confirm/')?decodeURIComponent(h.split('/')[2]):''};}
// Per-identity snapshot cache. Each entry only ever holds data the server returned for that same
// role/token, so showing it never leaks another role's view; it is replaced as soon as a fresh
// response arrives. sessionStorage keeps it across reloads within the same browser tab.
const CACHE_KEY='second-space-state:';
// Operations that run through the agent graph; they stream real step progress (NDJSON).
const AGENT_OPS=new Set(['review','listing','pricing','recommend','quote','purchase','property','advance','conflict','policy']);
export async function readStream(response,onEvent){
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',final=null;
 const handle=line=>{if(!line.trim())return;const event=JSON.parse(line);
  // Database commit remains server-side work; hide its technical label in all UI progress.
  // Continue reading until the final result/error so hiding it never announces success early.
  if(event.type==='progress'){
   if(!String(event.key||'').startsWith('commit-')&&!['保存结果与账本（提交后生效）','保存结果'].includes(event.label))onEvent(event);
  }
  else if(event.type==='result')final=event;
  else if(event.type==='error')throw Error(typeof event.detail==='string'?event.detail:'操作未完成，请检查输入。');};
 for(;;){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(handle);}
 handle(buffer);
 if(!final)throw Error('本次请求未完成，已填写的资料保留，请重试。');
 return final;
}
function readCache(mem,who){if(mem[who])return mem[who];try{const raw=sessionStorage.getItem(CACHE_KEY+who);if(raw)return mem[who]=JSON.parse(raw);}catch{}return null;}
function writeCache(mem,who,data){mem[who]=data;try{sessionStorage.setItem(CACHE_KEY+who,JSON.stringify(data));}catch{}}
export function Store({children}){
 const route=useLocation();
 const currentIdentity=JSON.stringify(identity());
 const [loadedIdentity,setLoadedIdentity]=useState('');
 const t=useLanguage(),[s,setS]=useState(null),[notice,setNotice]=useState(''),[noticeKind,setNoticeKind]=useState('info'),[failure,setFailure]=useState(false),epoch=useRef(0),pending=useRef(0),inflight=useRef(null),cache=useRef({});
 // Busy state is shown on the button that started the request (see Button in ui.jsx), not as a global toast.
 // kind 'error' shows a centred red message; other notices keep the bottom toast.
 const showNotice=(text,kind='info')=>{setNoticeKind(kind);setNotice(text);};
 const [activity,setActivity]=useState(null);
 const [operation,setOperation]=useState(''),[slowLoad,setSlowLoad]=useState(false),[progress,setProgress]=useState([]),controller=useRef(null);
 const clockSync=useRef(null);
 const estimateNow=fallback=>{const clock=clockSync.current;return clock?Math.max(fallback,clock.now+performance.now()-clock.wall):fallback;};
 const receive=(data,who=JSON.stringify(identity()))=>{clockSync.current={now:data.now,wall:performance.now()};writeCache(cache.current,who,data);setS(data);setLoadedIdentity(who);};
 useEffect(()=>{const timer=setInterval(()=>{const clock=clockSync.current;if(clock)setS(prev=>prev?{...prev,now:Math.max(prev.now,clock.now+performance.now()-clock.wall)}:prev);},1000);return()=>clearInterval(timer);},[]);
 const headers=()=>{const x=identity();return {'X-Demo-Role':x.role,'X-Property-Token':x.token};};
 // A role switch must not wait behind a poll that is still fetching the previous role's view:
 // abort that request and start the new one immediately. Polls for the same role are not stacked.
 const refresh=async()=>{
  if(pending.current)return;
  const who=JSON.stringify(identity());
  if(inflight.current){if(inflight.current.who===who)return;inflight.current.ctrl.abort();}
  const stamp=epoch.current,mine={who,ctrl:new AbortController()};inflight.current=mine;
  try{const r=await fetch('/api/state',{headers:headers(),signal:mine.ctrl.signal});if(!r.ok)throw Error('服务暂时不可用，请稍后重试。');const data=await r.json();if(stamp===epoch.current&&!pending.current){receive(data,who);setFailure(false);}}
  catch(e){if(e.name==='AbortError')return;if(stamp===epoch.current){setFailure(true);showNotice(e.message==='Failed to fetch'?'服务暂时不可用，请稍后重试。':e.message,'error');}}
  finally{if(inflight.current===mine)inflight.current=null;}
 };
 useEffect(()=>{epoch.current++;setFailure(false);refresh();},[currentIdentity]);
 useEffect(()=>{window.addEventListener('focus',refresh);const timer=setInterval(refresh,2000);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
 useEffect(()=>{if(notice){const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);}},[notice]);
 const run=async(operation,payload={})=>{if(pending.current)return null;pending.current++;setOperation(operation);setProgress([]);setActivity({identity:JSON.stringify(identity()),operation,subject:payload.orderId||payload.itemId||payload.quoteId||'',status:'running',steps:[]});epoch.current++;const stamp=epoch.current,ctrl=new AbortController();controller.current=ctrl;try{
  const r=await fetch('/api/actions',{method:'POST',signal:ctrl.signal,headers:{...headers(),'Content-Type':'application/json',...(AGENT_OPS.has(operation)?{Accept:'application/x-ndjson'}:{})},body:JSON.stringify({operation,payload,requestId:crypto.randomUUID()})});
  let data;
  if((r.headers.get('content-type')||'').includes('ndjson'))data=await readStream(r,event=>{
   const update=list=>{const i=list.findIndex(x=>x.key===event.key);return i<0?[...list,event]:list.map((x,j)=>j===i?event:x);};
   setProgress(update);setActivity(prev=>({...prev,steps:update(prev.steps)}));
  });
  else{data=await r.json();if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:'操作未完成，请检查输入。');}
  if(stamp===epoch.current)receive(data.state);setActivity(prev=>({...prev,status:'done',subject:operation==='purchase'?data.result?.id||prev.subject:prev.subject}));return data.result;
 }catch(e){setActivity(prev=>({...prev,status:e.name==='AbortError'?'stopped':'failed',steps:prev.steps.map(step=>step.status==='running'?{...step,status:'failed'}:step)}));if(e.name==='AbortError')return null;showNotice(e.message||'操作未完成','error');return null;}finally{if(controller.current===ctrl)controller.current=null;pending.current--;setOperation('');setProgress([]);if(!pending.current)refresh();}};
 // Stops waiting for the current request. The server may still finish it in the background.
 const cancel=()=>controller.current?.abort();
 const reset=()=>run('reset');
 // Fresh data for this identity, otherwise this identity's last snapshot while the refresh runs.
 const fresh=s&&loadedIdentity===currentIdentity;
 const cached=fresh?null:readCache(cache.current,currentIdentity);
 const view=fresh?s:cached&&{...cached,now:estimateNow(cached.now)};
 useEffect(()=>{setSlowLoad(false);if(view)return;const timer=setTimeout(()=>setSlowLoad(true),5000);return()=>clearTimeout(timer);},[currentIdentity,!!view]);
 if(!view)return <LoadingScreen failed={failure} slow={slowLoad} onRetry={refresh}/>;
 return <C.Provider value={{s:view,run,notify:showNotice,reset,operation,progress,cancel,activity:activity?.identity===currentIdentity?activity:null}}>{children}{!fresh&&<div className="sync-bar" role="progressbar" aria-label={t('正在同步最新数据…')}/>}{notice&&<div className={'toast'+(noticeKind==='error'?' toast-error':'')} role={noticeKind==='error'?'alert':'status'}>{t(notice)}<button onClick={()=>setNotice('')}>×</button></div>}</C.Provider>;
}
export const useStore=()=>useContext(C);
