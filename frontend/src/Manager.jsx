import {PropertyResponse} from './PropertyResponse';
import { useLanguage, translate as _tr } from "./Language";
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from './store';
import { day, date, money, metrics, DAY, statuses, decidePolicy, propertyReply } from './domain-v2.mjs';
import { Head, Panel, Field, Button, Badge, Empty, Demo, Audit } from './ui';
const delta = (a, b) => b === 0 ? a === 0 ? '持平' : '上期为 0，不计算百分比' : (a >= b ? '↑ ' : '↓ ') + Math.abs((a - b) / b * 100).toFixed(1) + '%';
export function Overview() {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const [start, setStart] = useState(day(s.now - 6 * DAY));
  const [end, setEnd] = useState(day(s.now));
  const [range, setRange] = useState([start, end]);
  const current = metrics(s, day(s.now - 6 * DAY), day(s.now));
  const previous = metrics(s, day(s.now - 13 * DAY), day(s.now - 7 * DAY));
  const [report,setReport]=useState(null);
  useEffect(()=>{let active=true;fetch('/api/reports?'+new URLSearchParams({start:range[0],end:range[1]}),{headers:{'X-Demo-Role':'manager'}}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(active)setReport(data);}).catch(()=>{if(active)setReport(null);});return()=>{active=false;};},[range[0],range[1],s.now,JSON.stringify(s.orders.map(o=>[o.id,o.status,o.held]))]);
  const q = {...metrics(s,...range),...(report||{})};
  const counts = Object.fromEntries(Object.keys(statuses).map(k => [k, q.list.filter(o => o.status === k).length]));
  const daily = Array.from({
    length: 7
  }, (_, i) => {
    const d = day(s.now - (6 - i) * DAY);
    return {
      d,
      ...metrics(s, d, d)
    };
  });
  const max = Math.max(1, ...daily.map(d => d.sales));
  return <><Head eyebrow={_tr("MANAGER OVERVIEW")} title={_tr("每一笔交易，都心中有数。")} text={_tr("最近 7 天固定概览 · 下方日期查询独立计算。")} /><div className="hero-metrics"><div><span>{_tr("\u6700\u8FD1 7 \u5929 \xB7 \u5546\u54C1\u9500\u552E\u989D")}</span><strong>{_tr(money(current.sales))}</strong><small>{_tr(delta(current.sales, previous.sales))}{_tr("\xB7 \u8F83\u524D 7 \u5929")}</small><p>{_tr(day(s.now - 6 * DAY))} — {_tr(day(s.now))}</p></div><div><span>{_tr("\u6700\u8FD1 7 \u5929 \xB7 \u5DF2\u7ED3\u7B97\u5E73\u53F0\u6536\u5165")}</span><strong>{_tr(money(current.income))}</strong><small>{_tr(delta(current.income, previous.income))}{_tr("\xB7 \u8F83\u524D 7 \u5929")}</small><p>{_tr("\u5546\u54C1\u670D\u52A1\u8D39 2% \uFF0B \u7269\u6D41\u670D\u52A1\u8D39 10%")}</p></div><div className="mini-chart" aria-label={_tr("最近7天商品销售额")}>{_tr(daily.map(d => <div key={d.d} title={_tr(d.d + ' ' + money(d.sales))}><span style={{
            height: d.sales / max * 90 + 3 + 'px'
          }}></span><small>{_tr(d.d.slice(5))}</small></div>))}</div></div><Panel title={_tr("查询经营情况")}><form className="toolbar" onSubmit={e => {
        e.preventDefault();
        if (start <= end) setRange([start, end]);
      }}><Field label={_tr("起始日期")} type="date" required value={start} onChange={e => setStart(e.target.value)} /><Field label={_tr("结束日期")} type="date" min={start} required value={end} onChange={e => setEnd(e.target.value)} /><Button type="submit">{_tr("\u67E5\u8BE2")}</Button></form><small>{_tr("\u67E5\u8BE2\u533A\u95F4")}{_tr(range[0])} — {_tr(range[1])}{_tr("\uFF08Sydney \u65E5\u671F\uFF0C\u542B\u9996\u5C3E\uFF09\u3002\u8BA2\u5355\u548C\u9500\u552E\u6309\u521B\u5EFA\u65E5\u671F\uFF1B\u6536\u5165\u6309\u5B9E\u9645\u7ED3\u7B97\u65E5\u671F\uFF1B\u7559\u7F6E\u8D44\u91D1\u4E3A\u6240\u9009\u8BA2\u5355\u76EE\u524D\u4ECD\u7559\u7F6E\u7684\u91D1\u989D\u3002")}</small></Panel><div className="split"><Panel title={_tr("业务阶段分布")}><div className="status-counts">{_tr(Object.entries(statuses).map(([k, t]) => <div key={k}><span>{_tr(t)}</span><b>{_tr(counts[k])}</b></div>))}</div></Panel><Panel title={_tr("待关注事项")}><div className="attention"><span>{_tr("\u7B49\u5F85\u7269\u4E1A\u56DE\u590D")}</span><strong>{_tr(q.list.filter(o => o.requests.some(r => r.status === 'pending')).length)}</strong></div><div className="attention"><span>{_tr("\u672A\u89E3\u51B3\u4EA4\u4ED8\u95EE\u9898")}</span><strong>{_tr(q.list.filter(o => o.issue).length)}</strong></div><div className="attention"><span>{_tr("\u5F85\u7ECF\u8425\u8005\u51B3\u7B56\u7684\u51B2\u7A81")}</span><strong>{_tr(s.exceptions.filter(e => e.status === 'open' && q.list.some(o => o.id === e.orderId)).length)}</strong></div><Link to="/manager/exceptions">{_tr("\u67E5\u770B\u4E8B\u9879\u4E0E\u51B2\u7A81 \u2192")}</Link></Panel></div><Panel title={_tr("查询订单")}><div className="table-wrap"><table><thead><tr><th>{_tr("\u8BA2\u5355 / \u5BB6\u5177")}</th><th>{_tr("\u65E5\u671F")}</th><th>{_tr("\u9636\u6BB5")}</th><th>{_tr("\u5546\u54C1\u91D1\u989D")}</th><th>{_tr("\u5F53\u524D\u7559\u7F6E")}</th></tr></thead><tbody>{_tr(q.list.map(o => <tr key={o.id}><td><Link to={'/manager/records/' + o.id}>{_tr(o.item.name)}</Link><small>{_tr(o.id)}</small></td><td>{_tr(day(o.created))}</td><td><Badge>{_tr(statuses[o.status])}</Badge></td><td>{_tr(money(o.item.price))}</td><td>{_tr(money(o.held ? o.total : 0))}</td></tr>))}</tbody></table>{_tr(!q.list.length && <Empty text={_tr("该区间没有创建的订单")} />)}</div></Panel><Panel title={_tr("区间收入的结算依据")}><div className="table-wrap"><table><thead><tr><th>{_tr("\u5173\u8054\u8BA2\u5355")}</th><th>{_tr("\u7ED3\u7B97\u65E5\u671F")}</th><th>{_tr("\u5546\u54C1\u670D\u52A1\u8D39")}</th><th>{_tr("\u7269\u6D41\u670D\u52A1\u8D39")}</th></tr></thead><tbody>{_tr(s.orders.filter(o => o.settledAt && day(o.settledAt) >= range[0] && day(o.settledAt) <= range[1]).map(o => <tr key={o.id}><td><Link to={'/manager/records/' + o.id}>{_tr(o.item.name)}</Link></td><td>{_tr(day(o.settledAt))}</td><td>{_tr(money(o.item.price * .02))}</td><td>{_tr(money(o.deliveryFee * .1))}</td></tr>))}</tbody></table></div></Panel><div className="query-summary"><span>{_tr("\u67E5\u8BE2\u7A97\u53E3\u6C47\u603B")}</span><span>{_tr("\u6709\u6548\u8BA2\u5355")}<b>{_tr(q.count)}</b></span><span>{_tr("\u9500\u552E\u989D")}<b>{_tr(money(q.sales))}</b></span><span>{_tr("\u5E73\u53F0\u6536\u5165")}<b>{_tr(money(q.income))}</b></span><span>{_tr("\u7559\u7F6E\u8D44\u91D1")}<b>{_tr(money(q.held))}</b></span></div><Demo /></>;
}
export function Exceptions() {
  const _tr = useLanguage();
  const {
    s,
    run
  } = useStore();
  const [reason, setReason] = useState({});
  const [selected, setSelected] = useState(null);
  return <><Head eyebrow={_tr("EXCEPTIONS & DECISIONS")} title={_tr("只在需要判断时，交给你。")} text={_tr("普通异常按现有政策处理；政策无法解决的 Agent 冲突才升级。")} /><Panel title={_tr("常规异常关注")}><div className="compact-list">{_tr(s.orders.filter(o => o.issue || o.requests.some(r => ['pending', 'rejected'].includes(r.status))).map(o => <Link key={o.id} to={'/manager/records/' + o.id}><span>{_tr(o.item.name)}</span><Badge>{_tr(statuses[o.status])}</Badge><small>{_tr("\u67E5\u770B\u8BA2\u5355 \u2192")}</small></Link>))}</div></Panel><div className="section-title"><h2>{_tr("\u9700\u8981\u7ECF\u8425\u8005\u51B3\u7B56")}</h2><Badge>{_tr(s.exceptions.filter(e => e.status === 'open').length)}{_tr("\u5F85\u5904\u7406")}</Badge></div>{_tr(s.exceptions.map(ex => <Panel key={ex.id}><div className="row between"><h2>{_tr(ex.title)}</h2><Badge>{_tr(ex.status === 'open' ? '待决策' : '政策已生效')}</Badge></div><Link to={'/manager/records/' + ex.orderId}>{_tr(ex.orderId)} ↗</Link><div className="form-grid"><div className="notice"><b>LogisticsAgent</b><p>{_tr(ex.a)}</p></div><div className="notice"><b>PricingAgent</b><p>{_tr(ex.b)}</p></div></div><p><b>{_tr("\u4F9D\u636E\uFF1A")}</b>{_tr(ex.evidence)}</p><p><b>{_tr("\u5DF2\u68C0\u67E5\uFF1A")}</b>{_tr("\u56FA\u5B9A\u4E70\u5BB6\u603B\u4EF7\uFF1B\u5408\u6CD5\u914D\u9001\u524D\u7F6E\u6761\u4EF6\uFF1B\u53D7\u4FDD\u62A4\u7684\u7ED3\u7B97\u89C4\u5219\u3002")}</p><p className="notice warning"><b>{_tr("\u653F\u7B56\u7F3A\u53E3\uFF1A")}</b>{_tr(ex.gap)}</p>{_tr(ex.status === 'open' ? <form onSubmit={e => {
        e.preventDefault();
        run('policy',{caseId:ex.id,reason:reason[ex.id]||''});
      }}><Field label={_tr("可执行处理方向")}><select aria-label={_tr("可执行处理方向")}><option value={"\u8BF7\u6C42\u4E0D\u589E\u52A0\u4E70\u5BB6\u603B\u4EF7\u7684\u53EF\u884C\u66FF\u4EE3\u65B9\u6848\uFF1B\u4E0D\u53EF\u884C\u5219\u7EE7\u7EED\u8DDF\u8FDB"}>{_tr("\u8BF7\u6C42\u4E0D\u589E\u52A0\u4E70\u5BB6\u603B\u4EF7\u7684\u53EF\u884C\u66FF\u4EE3\u65B9\u6848\uFF1B\u4E0D\u53EF\u884C\u5219\u7EE7\u7EED\u8DDF\u8FDB")}</option></select></Field><Field label={_tr("处理理由")}><textarea required value={reason[ex.id] || ''} onChange={e => setReason({
            ...reason,
            [ex.id]: e.target.value
          })} /></Field><Button type="submit">{_tr("\u63D0\u4EA4\u65B9\u5411\uFF0C\u81EA\u52A8\u66F4\u65B0\u653F\u7B56")}</Button></form> : <div className="notice success">{_tr("\u51B3\u5B9A\uFF1A")}{_tr(ex.reason)}<p>{_tr("\u751F\u6548\u65F6\u95F4\uFF1A")}{_tr(date(ex.decided))}</p><Link to="/manager/policies">{_tr("\u67E5\u770B\u73B0\u884C\u653F\u7B56 \u2192")}</Link></div>)}</Panel>))}<Demo /></>;
}
export function Policies() {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const [history, setHistory] = useState(false);
  return <><Head eyebrow={_tr("SUPERVISOR POLICIES")} title={_tr("让每一次决定，有据可循。")} text={_tr("现行政策与历史版本；业务金额及保护条件由确定性逻辑执行。")} /><div className="tabs"><button className={!history ? 'selected' : ''} onClick={() => setHistory(false)}>{_tr("\u73B0\u884C\u653F\u7B56")}</button><button className={history ? 'selected' : ''} onClick={() => setHistory(true)}>{_tr("\u6240\u6709\u7248\u672C")}</button></div>{_tr(s.policies.filter(p => history || p.active).map(p => <Panel key={p.id + '-' + p.version}><div className="row between"><div><span className="eyebrow">{_tr(p.id)} · VERSION {_tr(p.version)}</span><h2>{_tr(p.name)}</h2></div><Badge>{_tr(p.active ? '生效中' : '已被替代')}</Badge></div><p>{_tr(p.rule)}</p><div className="policy-meta"><span>{_tr("\u751F\u6548\u65F6\u95F4\uFF1A")}{_tr(date(p.created))}</span><span>{_tr("\u6765\u6E90\uFF1A")}{_tr(p.source || 'Stage 1 / 已确认 MVP 规则')}</span></div>{_tr(p.reason && <div className="notice"><b>{_tr("\u53D8\u66F4\u7406\u7531\uFF1A")}</b>{_tr(p.reason)}<p>{_tr("\u524D\u7248\u672C\uFF1A")}{_tr(p.version === 1 ? '无适用的额外成本处理规则' : 'v' + (p.version - 1))}{_tr("\u2192 \u5F53\u524D v")}{_tr(p.version)}</p></div>)}</Panel>))}<Audit /><Demo /></>;
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
