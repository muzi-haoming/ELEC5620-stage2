import { Icon, WORKERS } from './AgentActivity';
import {PropertyResponse} from './PropertyResponse';
import { useLanguage, translate as _tr } from "./Language";
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from './store';
import { day, date, money, metrics, DAY, statuses, decidePolicy, propertyReply } from './domain-v2.mjs';
import { Head, Panel, Field, Button, Badge, Empty, Demo, Audit } from './ui';
export { Overview } from './BusinessData';
// Must match domain.POLICY_DIRECTIONS: the rule text follows the side the founder supports; the reason is recorded only.
const DIRECTIONS={
  pricing:{agent:'PricingAgent',side:'估价 Agent',badge:'支持估价 Agent',title:'支持估价 Agent：买家总价不变',rule:'先请求不提高买家固定总价的可行替代方案；无可行方案时保留待取货并升级处理，不启动退款，不绕过验收和结算。',effect:'以后同类冲突：保持原价，请承运方提供不加价的替代方案。'},
  logistics:{agent:'LogisticsAgent',side:'物流 Agent',badge:'支持物流 Agent',title:'支持物流 Agent：接受替代方案，平台承担额外成本',rule:'接受承运方的替代配送方案；买家固定总价不变，额外成本由平台承担（演示中仅记录，不改变实际分账）；仍需承运方确认，不绕过物业确认、验收和结算。',effect:'以后同类冲突：接受替代方案，额外 $25 记为平台承担（模拟）。'}
};
export function Exceptions() {
  const _tr = useLanguage();
  const {
    s,
    run
  } = useStore();
  const [reason, setReason] = useState({});
  const [selected, setSelected] = useState(null);
  const [direction, setDirection] = useState({});
  return <><Head eyebrow={_tr("EXCEPTIONS & DECISIONS")} title={_tr("异常与冲突")} text={_tr("普通异常按现有政策处理；政策无法解决的 Agent 冲突才升级。")} />{s.attention?.length > 0 && <Panel title={_tr("停滞提醒")}><div className="compact-list">{s.attention.map(a => <Link key={a.orderId} to={'/manager/records/' + a.orderId}><span>{_tr(a.name)}</span><Badge tone="warning">{_tr(a.reason)}</Badge><small>{_tr("查看订单 →")}</small></Link>)}</div></Panel>}<Panel title={_tr("常规异常关注")}><div className="compact-list">{_tr(s.orders.filter(o => o.issue || o.requests.some(r => ['pending', 'rejected'].includes(r.status))).map(o => <Link key={o.id} to={'/manager/records/' + o.id}><span>{_tr(o.item.name)}</span><Badge>{_tr(statuses[o.status])}</Badge><small>{_tr("\u67E5\u770B\u8BA2\u5355 \u2192")}</small></Link>))}</div></Panel><div className="section-title"><h2>{_tr("\u9700\u8981\u7ECF\u8425\u8005\u51B3\u7B56")}</h2><Badge>{_tr(s.exceptions.filter(e => e.status === 'open').length)}{_tr("\u5F85\u5904\u7406")}</Badge></div>{_tr(s.exceptions.map(ex => <Panel key={ex.id}><div className="row between"><h2>{_tr(ex.title)}</h2><Badge>{_tr(ex.status === 'open' ? '待决策' : '政策已生效')}</Badge></div><Link to={'/manager/records/' + ex.orderId}>{_tr(ex.orderId)} ↗</Link><div className="form-grid conflict-sides">{[['LogisticsAgent', ex.a], ['PricingAgent', ex.b]].map(([id, text]) => { const w = WORKERS.find(x => x.id === id); return <div key={id} className="conflict-side" style={{ '--c': w.color }}><b><Icon id={id} />{_tr(w.name)}</b><p>{_tr(String(text || '').replace(/^[^：:]*[：:]\s*/, ''))}</p></div>; })}</div><p><b>{_tr("\u4F9D\u636E\uFF1A")}</b>{_tr(ex.evidence)}</p><p><b>{_tr("\u5DF2\u68C0\u67E5\uFF1A")}</b>{_tr("\u56FA\u5B9A\u4E70\u5BB6\u603B\u4EF7\uFF1B\u5408\u6CD5\u914D\u9001\u524D\u7F6E\u6761\u4EF6\uFF1B\u53D7\u4FDD\u62A4\u7684\u7ED3\u7B97\u89C4\u5219\u3002")}</p><p className="notice warning"><b>{_tr("\u653F\u7B56\u7F3A\u53E3\uFF1A")}</b>{_tr(ex.gap)}</p>{ex.options?.length > 0 && <div className="escalation-options"><b>{_tr('监督 Agent 整理的可选方案（仅供参考，不改变将生效的政策）')}</b><ol>{ex.options.map((o, i) => <li key={i}><span>{_tr(o.action)}</span><small>{_tr('影响')}：{_tr(o.impact)}</small></li>)}</ol></div>}{_tr(ex.status === 'open' ? <form onSubmit={e => {
        e.preventDefault();
        run('policy',{caseId:ex.id,reason:reason[ex.id]||'',direction:direction[ex.id]});
      }}><fieldset className="policy-choice"><legend>{_tr('你支持哪一方？')}</legend>{Object.entries(DIRECTIONS).map(([key, d]) => <label key={key} className={direction[ex.id] === key ? 'chosen' : ''}><input type="radio" name={'direction-' + ex.id} value={key} required checked={direction[ex.id] === key} onChange={() => setDirection({ ...direction, [ex.id]: key })} /><span><b>{_tr(d.title)}</b><small>{_tr(d.effect)}</small></span></label>)}</fieldset>{direction[ex.id] && <div className="policy-preview"><b>{_tr('批准后生效的政策')}</b><span>{_tr('配送额外成本处理')} · P-EXTRA v{(s.policies.find(x => x.id === 'P-EXTRA' && x.active)?.version || 0) + 1} · {_tr(DIRECTIONS[direction[ex.id]].badge)}</span><p>{_tr(DIRECTIONS[direction[ex.id]].rule)}</p><small>{_tr('以后同类冲突（承运方要求加价、买家总价已固定）将由监督 Agent 按此政策自动处理，不再升级给你。')}</small></div>}<Field label={_tr("处理理由（仅作记录，不会改变规则内容）")}><textarea required value={reason[ex.id] || ''} onChange={e => setReason({
            ...reason,
            [ex.id]: e.target.value
          })} /></Field><Button type="submit">{_tr("批准政策并结案")}</Button></form> : <div className="notice success"><b>{_tr("已生效政策：")}</b>{(() => { const pol = s.policies.find(x => x.id === 'P-EXTRA' && x.source === ex.id); return (pol ? `P-EXTRA v${pol.version}` : 'P-EXTRA') + (pol?.direction ? ' · ' + _tr(DIRECTIONS[pol.direction].badge) : ''); })()}<p>{_tr("处理理由：")}{_tr(ex.reason)}</p><p>{_tr("\u751F\u6548\u65F6\u95F4\uFF1A")}{_tr(date(ex.decided))}</p><Link to="/manager/policies">{_tr("\u67E5\u770B\u73B0\u884C\u653F\u7B56 \u2192")}</Link></div>)}</Panel>))}<Demo /></>;
}
export function Policies() {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const [history, setHistory] = useState(false);
  return <><Head eyebrow={_tr("SUPERVISOR POLICIES")} title={_tr("现行政策")} text={_tr("现行政策与历史版本；业务金额及保护条件由确定性逻辑执行。")} /><div className="tabs"><button className={!history ? 'selected' : ''} onClick={() => setHistory(false)}>{_tr("\u73B0\u884C\u653F\u7B56")}</button><button className={history ? 'selected' : ''} onClick={() => setHistory(true)}>{_tr("\u6240\u6709\u7248\u672C")}</button></div>{_tr(s.policies.filter(p => history || p.active).map(p => <Panel key={p.id + '-' + p.version} className={'policy-card ' + (p.active ? 'active' : 'superseded')}><div className="row between"><div><span className="eyebrow">{_tr(p.id)} · VERSION {_tr(p.version)}</span><h2>{_tr(p.name)}</h2></div><div className="row policy-badges">{p.direction && DIRECTIONS[p.direction] && <span className="policy-side" style={{ '--c': WORKERS.find(w => w.id === DIRECTIONS[p.direction].agent).color }}><Icon id={DIRECTIONS[p.direction].agent} />{_tr(DIRECTIONS[p.direction].badge)}</span>}{p.reason && <span className="policy-updated">{_tr('经营者更新')}</span>}<span className={'policy-status ' + (p.active ? 'active' : 'superseded')}><i />{_tr(p.active ? '生效中' : '已被替代')}</span></div></div><p>{_tr(p.rule)}</p><div className="policy-meta"><span>{_tr("\u751F\u6548\u65F6\u95F4\uFF1A")}{_tr(date(p.created))}</span><span>{_tr("\u6765\u6E90\uFF1A")}{_tr(p.source || 'Stage 1 / 已确认 MVP 规则')}</span></div>{_tr(p.reason && <div className="notice"><b>{_tr("\u53D8\u66F4\u7406\u7531\uFF1A")}</b>{_tr(p.reason)}<p>{_tr("\u524D\u7248\u672C\uFF1A")}{_tr(p.version === 1 ? '无适用的额外成本处理规则' : 'v' + (p.version - 1))}{_tr("\u2192 \u5F53\u524D v")}{_tr(p.version)}</p></div>)}</Panel>))}<Audit /><Demo /></>;
}
export function Property() {
  const _tr = useLanguage();
  const {
    token
  } = useParams();
  const {
    s,
    run
  } = useStore();
  const o = s.orders.find(o => o.requests.some(r => r.token === token));
  const r = o?.requests.find(r => r.token === token);
  const [f, setF] = useState({
    name: '',
    status: 'approved',
    reason: '',
    timeWindow: '',
    lift: '',
    loading: ''
  });
  if (!r) return <div className="public-page"><Empty text={_tr("物业申请链接无效或演示已重置")} to="/" label={_tr("返回角色入口")} /></div>;
  return <div className="public-page"><Link to="/" className="brand">second space</Link><Head eyebrow={_tr("BUILDING MANAGER · DEMO")} title={_tr("确认一次通行，连接两个家。")} text={_tr("请确认家具搬运的通行安排。")} /><Panel title={_tr("通行申请")}><Badge>{_tr(r.end === 'pickup' ? '取货端' : '送货端')} · {_tr(o.id)}</Badge><p><b>{_tr(r.address)}</b></p><p>{_tr(o.item.name)} · {_tr(o.item.width)} × {_tr(o.item.depth)} × {_tr(o.item.height)} cm</p><p>{_tr("\u9884\u8BA1\u4E0A\u95E8\uFF1A")}{_tr(o.expected || '样例计划时间')}{_tr("\xB7 \u642C\u8FD0\u4EBA\u6570\uFF1A")}{_tr(o.access?.movers || 2)}</p><p>{_tr("\u8054\u7CFB\u4EBA\u90AE\u7BB1\uFF1A")}{_tr(r.email)}</p></Panel>{_tr(r.status === 'pending' ? <Panel title={_tr("填写物业回复")}><form onSubmit={e => {
        e.preventDefault();
        run('property',{token,reply:{...f,replyVersion:2}});
      }}><Field label={_tr("回复人姓名")} required value={f.name} onChange={e => setF({
          ...f,
          name: e.target.value
        })} /><Field label={_tr("通行意见")}><select value={f.status} onChange={e => setF({
            ...f,
            status: e.target.value
          })}><option value="approved">{_tr("\u5141\u8BB8\u901A\u884C")}</option><option value="conditional">{_tr("\u9644\u6761\u4EF6\u5141\u8BB8")}</option><option value="rejected">{_tr("\u62D2\u7EDD\u901A\u884C")}</option></select></Field><div className="form-grid"><Field label={_tr("允许搬运时段（可选）")} value={f.timeWindow} onChange={e => setF({
            ...f,
            timeWindow: e.target.value
          })} /><Field label={_tr("电梯预约要求（可选）")} value={f.lift} onChange={e => setF({
            ...f,
            lift: e.target.value
          })} /></div><Field label={_tr("装卸限制（可选）")} value={f.loading} onChange={e => setF({
          ...f,
          loading: e.target.value
        })} /><Field label={_tr("条件 / 拒绝原因")}><textarea required={f.status !== 'approved'} value={f.reason} onChange={e => setF({
            ...f,
            reason: e.target.value
          })} /></Field><Button type="submit">{_tr("\u63D0\u4EA4\u7269\u4E1A\u56DE\u590D")}</Button></form></Panel> : <Panel title={_tr("回复已记录")}><Badge>{_tr({
          approved: '允许通行',
          conditional: '附条件允许',
          rejected: '拒绝通行'
        }[r.status])}</Badge><p>{_tr(r.name)} · {_tr(date(r.time))}</p><PropertyResponse request={r}/><p className="notice">{_tr("\u611F\u8C22\u56DE\u590D\uFF0C\u6211\u4EEC\u5C06\u636E\u6B64\u5B89\u6392\u53D6\u8D27\u4E0E\u914D\u9001\u3002")}</p><Link className="button" to={"/buyer/orders/"+o.id}>{_tr("返回订单查看进度")}</Link></Panel>)}</div>;
}
