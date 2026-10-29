import React from 'react';
import {useLanguage} from './Language';
export function PropertyResponse({request:r}){
 const t=useLanguage();
 // Older replies stored generated field labels inside reason as well as structured values.
 let reason=r.reason||'';
 if(!r.replyVersion){for(const [key,label] of [['loading','装卸：'],['lift','电梯：'],['timeWindow','时段：']]){const suffix=label+r[key];if(r[key]&&reason.endsWith(suffix))reason=reason.slice(0,-suffix.length).replace(/；$/,'');}}
 return <div className="property-response">{reason&&<p>{reason}</p>}{[['timeWindow','时段：'],['lift','电梯：'],['loading','装卸：']].map(([key,label])=>r[key]?<p key={key}><b>{t(label)}</b>{r[key]}</p>:null)}</div>;
}
