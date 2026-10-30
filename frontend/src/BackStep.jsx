import React,{useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useLanguage} from './Language';
import {useStore} from './store';
export function BackStep({to,itemId,state,clear=true}){
 const t=useLanguage(),nav=useNavigate(),{run,operation}=useStore(),[busy,setBusy]=useState(false);
 return <button type="button" className="text-button back-step" disabled={busy||!!operation} aria-busy={busy} onClick={async()=>{if(clear){setBusy(true);const done=await run('discard_quotes',{itemId});setBusy(false);if(!done)return;}nav(to,{replace:true,state});}}>{busy?<span className="loading-spinner" aria-hidden="true"/>:'← '}{t('返回上一步')}</button>;
}
