import React from 'react';
import {useNavigate} from 'react-router-dom';
import {useLanguage} from './Language';
import {useStore} from './store';
export function BackStep({to,itemId,state,clear=true}){
 const t=useLanguage(),nav=useNavigate(),{run}=useStore();
 return <button type="button" className="text-button back-step" onClick={async()=>{if(clear){const done=await run('discard_quotes',{itemId});if(!done)return;}nav(to,{replace:true,state});}}>← {t('返回上一步')}</button>;
}
