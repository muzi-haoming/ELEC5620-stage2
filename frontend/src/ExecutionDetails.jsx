import React from 'react';
import {useLanguage} from './Language';
import {statuses} from './domain-v2.mjs';
const duties={ListingAgent:'资料与图片审核',PricingAgent:'市场比价与估价',MatchingAgent:'需求偏好匹配',LogisticsAgent:'配送流程协调',PaymentAgent:'模拟付款与结算',SupervisionAgent:'流程调度与政策分流',AuditReportingAgent:'经营数据汇总'};
const actions={purchase:'模拟付款并创建订单',property:'记录物业回复',book:'确认承运安排',pickup:'记录取货',deliver:'记录送达',confirm:'记录买家验收',settle:'完成模拟结算',issue:'记录交付问题',resolve:'处理交付问题',advance:'推进订单流程',pricing:'获取建议售价',listing:'提交家具审核',recommend:'获取推荐',quote:'生成配送报价',report:'查询经营数据',conflict:'处理报价冲突',policy:'更新政策'};
const fields={status:'订单状态',providerAccepted:'承运确认',held:'资金留置',buyerAccepted:'买家验收',delivered:'送达记录',issue:'交付问题',property:'物业申请'};
function value(field,v,t){
 if(v==null)return t('未记录');
 if(field==='status')return t(statuses[v]||v);
 if(typeof v==='boolean')return t(v?'是':'否');
 if(field==='property')return Object.entries(v).map(([end,status])=>t(end==='pickup'?'取货':'送货')+': '+t(({pending:'待回复',approved:'已批准',conditional:'附条件批准',rejected:'已拒绝'})[status]||status)).join('；')||t('无需物业确认');
 return String(v);
}
function openWorkflow(id){
 const target=document.getElementById('workflow-'+id);if(!target)return;
 for(let p=target;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
 target.scrollIntoView({block:'center'});target.querySelector('summary')?.focus();
}
export function EventDetails({event}){
 const t=useLanguage(),facts=event.facts;
 return <div className="event-facts">
  {facts?<>
   <p><b>{t('本次动作')}：</b>{t(actions[facts.action]||facts.action)}</p>
   <p><b>{t('实际检查')}：</b></p>
   <ul>{facts.checks.map((check,i)=><li key={i}>{t(check.label)} — {t(check.result==='passed'?'通过':'未通过')}</li>)}</ul>
   <p><b>{t('状态变化')}：</b></p>
   {facts.changes.length?<ul>{facts.changes.map((change,i)=><li key={i}>{t(fields[change.field]||change.field)}：{value(change.field,change.before,t)} → {value(change.field,change.after,t)}</li>)}</ul>:<p>{t('订单状态未改变。')}</p>}
  </>:<p className="muted">{t('此历史事件未保存逐项检查和状态变化，不根据职责说明推断。')}</p>}
  {event.execution?.requestId&&<button type="button" className="text-button" onClick={()=>openWorkflow(event.execution.requestId)}>{t('查看本次请求工作流')} ↗</button>}
 </div>;
}
export function ExecutionDetails({execution}){
 const t=useLanguage();
 return <details className="execution-details" id={'workflow-'+execution.requestId}><summary>{t('本次请求工作流')} · {t(actions[execution.action||execution.operation]||execution.operation)}</summary>
  <p>{t('请求编号')}: {execution.requestId}</p>
  <p className="muted">{t('以下是同一次请求经过的节点，不表示每个节点都改变了订单或调用了 AI。')}</p>
  <ol>{(execution.steps||[]).map((step,i)=>{
   const called=['succeeded','failed'].includes(step.modelCall);
   const knownNoCall=step.modelCall==='not_called'||step.agent==='SupervisionAgent'&&step.mode==='policy';
   return <li key={i}><strong>{step.agent}</strong>
    <p>{t('职责说明')}：{t(duties[step.agent]||'业务流程处理')}</p>
    <span className="badge">{t(called?(step.modelCall==='succeeded'?'AI 调用成功':'AI 调用失败'):knownNoCall?'规则处理 · 未调用 AI':'无模型调用记录')}</span>
    {called&&<p>{t('模型')}: {step.model||t('未记录')}<br/>{t('接口')}: {step.endpoint?'POST '+step.endpoint:t('未记录')}<br/>{t('调用耗时')}: {step.modelDurationMs==null?t('未单独记录'):step.modelDurationMs+' ms'}</p>}
    {step.selection&&<p><b>{t('选择的工具')}:</b> {step.selection}{step.selectionReason&&<><br/>{t('调用目的')}: {step.selectionReason}</>}</p>}
    {!!step.tools?.length&&<div><b>{t('实际工具调用')}</b>{step.tools.map((tool,j)=><details key={j}><summary>{tool.name} · {t(tool.status==='succeeded'?'通过':'未通过')}</summary><p>{t('耗时')}: {tool.durationMs==null?t('未单独记录'):tool.durationMs+' ms'}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{typeof tool.result==='string'?tool.result:JSON.stringify(tool.result??{},null,2)}</pre></details>)}</div>}
   </li>;
  })}</ol>
  {!execution.steps?.length&&<p>{t('本次为服务端规则处理，无 AI 调用。')}</p>}
 </details>;
}
export function RequestWorkflows({records}){
 const unique=new Map();
 for(const row of records){const e=row.execution;if(e?.requestId)unique.set(e.requestId,e);}
 return [...unique.values()].reverse().map(e=><ExecutionDetails key={e.requestId} execution={e}/>);
}
