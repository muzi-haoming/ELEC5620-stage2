import {PropertyResponse} from './PropertyResponse';
import React,{useState} from 'react';
import {useLanguage} from './Language';
export function PropertyProgress({request:r}){
 const t=useLanguage(),[feedback,setFeedback]=useState('');
 const url=new URL('#/property-confirm/'+r.token,window.location.href).href;
 async function copy(){try{await navigator.clipboard.writeText(url);setFeedback('链接已复制');}catch{setFeedback('复制未成功，请选择链接手动复制');}}
 return <div className="notice property-progress" data-end={r.end}><div className="row between wrap"><b>{t(r.end==='pickup'?'取货物业确认':'送货物业确认')}</b><span>{t(({pending:'待回复',approved:'允许通行',conditional:'附条件允许',rejected:'拒绝通行'})[r.status])}</span></div><p>{r.email}</p><PropertyResponse request={r}/><input readOnly aria-label={t(r.end==='pickup'?'取货物业确认页面URL':'送货物业确认页面URL')} value={url} onFocus={e=>e.target.select()}/><button type="button" className="text-button" onClick={copy}>{t('复制链接跟催')}</button>{feedback&&<small role="status">{t(feedback)}</small>}</div>;
}
