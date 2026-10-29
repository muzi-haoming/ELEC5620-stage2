import {RequestWorkflows} from './ExecutionDetails';
import { useLanguage, translate as _tr } from "./Language";
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from './store';
import { advanceOrder, tick, day, date, money, statuses, uid, log } from './domain-v2.mjs';
export function Button({
  children,
  secondary = false,
  loading,
  className = '',
  onClick,
  disabled,
  ...props
}) {
  const _tr = useLanguage();
  const {operation} = useStore();
  const [waiting,setWaiting] = useState(false);
  const locked = React.useRef(false);
  // Explicit loading belongs to this button; unrelated requests only disable it.
  const busy = waiting || (loading ?? (!!operation && props.type === 'submit'));
  async function click(e){
    if(locked.current)return;
    locked.current=true;
    try{const result=onClick?.(e);if(result?.then){setWaiting(true);await result;}}
    finally{locked.current=false;setWaiting(false);}
  }
  return <button {...props} className={'button '+(secondary?'secondary ':'')+className} disabled={disabled||busy||!!operation} aria-busy={busy} onClick={click}>{busy&&<span className="loading-spinner" aria-hidden="true"/>}{_tr(children)}</button>;
}
export function Field({
  label,
  children,
  ...props
}) {
  const _tr = useLanguage();
  return <label className="field"><span>{_tr(label)}</span>{_tr(children || <input {...props} />)}</label>;
}
export function Panel({
  title,
  children,
  className = ''
}) {
  const _tr = useLanguage();
  return <section className={'panel ' + className}>{_tr(title && <h2>{_tr(title)}</h2>)}{_tr(children)}</section>;
}
export function Head({
  eyebrow,
  title,
  text,
  children
}) {
  const _tr = useLanguage();
  return <div className="page-head"><div><div className="eyebrow">{_tr(eyebrow)}</div><h1>{_tr(title)}</h1>{_tr(text && <p>{_tr(text)}</p>)}</div>{_tr(children)}</div>;
}
export function Badge({
  children,
  tone = ''
}) {
  const _tr = useLanguage();
  return <span className={'badge ' + tone}>{_tr(children)}</span>;
}
export function Empty({
  text = '这里还没有记录',
  to,
  label = '去看看'
}) {
  const _tr = useLanguage();
  return <div className="empty"><span>↗</span><h2>{_tr(text)}</h2>{_tr(to && <Link className="button" to={to}>{_tr(label)}</Link>)}</div>;
}
export function Modal({
  title,
  children,
  onClose
}) {
  const _tr = useLanguage();
  return <div className="modal-backdrop" onClick={e => {
    if (e.target === e.currentTarget) onClose();
  }} onKeyDown={e => {
    if (e.key === 'Escape') onClose();
  }}><section className="modal" role="dialog" aria-modal="true" aria-label={_tr(title)}><div className="row between"><h2>{_tr(title)}</h2><button className="icon-button" onClick={onClose} aria-label={_tr("关闭")}>×</button></div>{_tr(children)}</section></div>;
}
export function Shell({
  children
}) {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const path = useLocation().pathname;
  const role = path.split('/')[1];
  const nav = role === 'seller' ? [['我的家具', '/seller/listings', '▦'], ['发布家具', '/seller/listings/new', '＋']] : role === 'buyer' ? [['发现与推荐', '/buyer/discover', '⌕'], ['我的订单', '/buyer/orders', '▤']] : [['经营概览', '/manager/overview', '▦'], ['异常与冲突', '/manager/exceptions', '◇'], ['现行政策', '/manager/policies', '▤']];
  const title = role === 'buyer' ? 'Buyer · 买家' : role === 'seller' ? 'Seller · 卖家' : 'Admin · 经营者';
  return <div className={"shell theme-"+role}><aside className="sidebar"><Link to="/" className="brand"><span className="chair-mark">▰</span>second space</Link><div className="role-label">{_tr(title)}</div><nav>{_tr(nav.map(([label, to, icon]) => <Link key={to} className={path === to || path.startsWith(to + '/') && to.endsWith('orders') ? 'active' : ''} to={to}><span>{_tr(icon)}</span>{_tr(label)}</Link>))}</nav><div className="sidebar-bottom"><p>{_tr("\u65E7\u7269\u65B0\u751F")}<br />{_tr("\u7A7A\u95F4\u7115\u65B0\u3002")}</p><Link to="/">{_tr("\u2190 \u8FD4\u56DE\u89D2\u8272\u5165\u53E3")}</Link></div></aside><div className="workspace"><header className="topbar"><span>⌖ Sydney, NSW</span><span className="top-note">{_tr(title)}</span><span className="avatar">{_tr(role === 'manager' ? 'A' : role[0].toUpperCase())}</span></header><main>{_tr(children)}</main><footer>{_tr("Second Space \xB7 \u7ED9\u597D\u5BB6\u5177\u4E00\u4E2A\u65B0\u5F00\u59CB")}<span>{_tr("\u6F14\u793A\u65F6\u95F4")}{_tr(date(s.now))}</span></footer></div></div>;
}
export function Breakdown({
  price,
  delivery = 0,
  seller = false
}) {
  const _tr = useLanguage();
  return <div className="breakdown"><div><span>{_tr("\u5546\u54C1\u91D1\u989D")}</span><b>{_tr(money(price))}</b></div>{_tr(seller ? <><div><span>{_tr("\u5546\u54C1\u670D\u52A1\u8D39 \xB7 2%")}</span><b>−{_tr(money(Math.round(price * 2) / 100))}</b></div><div className="total"><span>{_tr("\u9884\u8BA1\u5356\u5BB6\u51C0\u6536\u5165")}</span><b>{_tr(money((Math.round(price * 100) - Math.round(price * 2)) / 100))}</b></div></> : <><div><span>{_tr("\u56FA\u5B9A\u914D\u9001\u8D39")}</span><b>{_tr(money(delivery))}</b></div><div className="total"><span>{_tr("\u56FA\u5B9A\u603B\u4EF7")}</span><b>{_tr(money(price + delivery))}</b></div></>)}</div>;
}
export function Audit({
  object
}) {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const rows = s.audit.filter(a => !object || a.object === object);
  const events = s.orders.filter(o=>!object||o.id===object).flatMap(o=>o.events);
  const legacy = rows.filter(a=>!a.execution);
  return <details className="audit"><summary>{_tr("请求工作流与历史记录")}</summary><RequestWorkflows records={[...events,...rows]}/>{_tr(legacy.length ? <details><summary>{_tr('其他历史记录（无逐项校验证据）')}</summary>{legacy.slice().reverse().map(a => <div className="audit-item" key={a.id}><b>{_tr(a.agent)}</b><time>{_tr(date(a.time))}</time><p>{_tr(a.text)}</p></div>)}</details> : !rows.length && !events.length && <p className="muted">{_tr("\u6682\u65E0\u65B0\u589E\u5904\u7406\u8BB0\u5F55\u3002\u9884\u7F6E\u6837\u4F8B\u4E0D\u4F5C\u4E3A\u771F\u5B9E\u6A21\u578B\u8C03\u7528\u8BC1\u636E\u3002")}</p>)}</details>;
}
export function Demo({
  order
}) {
  const _tr = useLanguage();
  const {
    s,
    run,
    notify,
    reset
  } = useStore();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  return <><button className="demo-trigger" onClick={() => setOpen(true)}>{_tr("\u2699 \u4E1A\u52A1\u6A21\u62DF\u7A97\u53E3")}</button>{_tr(open && <Modal title={_tr("业务模拟 · 不连接真实外部服务")} onClose={() => setOpen(false)}><p className="notice">{_tr("\u8FD9\u91CC\u53EA\u63D0\u4F9B\u6A21\u62DF\u4E8B\u4EF6\uFF1B\u524D\u7F6E\u6761\u4EF6\u4ECD\u7136\u751F\u6548\u3002\u6F14\u793A\u65F6\u949F\uFF1A")}{_tr(date(s.now))}</p>{_tr(order && <><h3>{_tr(order.id)} · {_tr(statuses[order.status])}</h3><div className="button-grid">{_tr([['book', '最终检查 + 承运方接受'], ['pickup', '模拟取货'], ['deliver', '模拟送达'], ['resolve', '按政策解决交付问题']].map(([a, t]) => <Button secondary key={a} onClick={() => run('advance',{orderId:order.id,action:a})}>{_tr(t)}</Button>))}</div><h3>{_tr("\u7269\u4E1A\u90AE\u4EF6\u9884\u89C8")}</h3>{_tr(order.requests.length ? order.requests.map(r => <div className="notice" key={r.token}><b>{_tr("\u6536\u4EF6\u4EBA\uFF1A")}{_tr(r.email)}</b><p>{_tr("\u4E3B\u9898\uFF1A\u8BF7\u786E\u8BA4")}{_tr(order.id)}{_tr("\u7684")}{_tr(r.end === 'pickup' ? '取货' : '送货')}{_tr("\u901A\u884C\u5B89\u6392")}</p><p>{_tr(r.address)}{_tr("\xB7 \u8BA1\u5212\u4E0A\u95E8")}{_tr(order.expected || '按样例计划')}{_tr("\u3002\u8BF7\u901A\u8FC7\u4E0B\u65B9\u5F00\u653E\u9875\u9762\u56DE\u590D\u3002\u90AE\u4EF6\u672A\u5B9E\u9645\u53D1\u9001\u3002")}</p><Link to={'/property-confirm/' + r.token} onClick={() => setOpen(false)}>{_tr("\u6253\u5F00\u7269\u4E1A\u786E\u8BA4\u9875\u9762 \u2197")}</Link></div>) : <p className="muted">{_tr("\u6B64\u8BA2\u5355\u4E0D\u9700\u8981\u7269\u4E1A\u56DE\u590D\u3002")}</p>)}<details><summary>{_tr("\u5F02\u5E38\u573A\u666F")}</summary><Button secondary onClick={() => run('conflict',{orderId:order.id})}>{_tr("\u627F\u8FD0\u65B9\u589E\u52A0\u6210\u672C\uFF08\u56FA\u5B9A\u603B\u4EF7\u4E0D\u53D8\uFF09")}</Button></details></>)}<h3>{_tr("\u6F14\u793A\u65F6\u949F")}</h3><div className="row wrap"><Button secondary onClick={() => run('tick',{days:16/1440})}>{_tr("\u63A8\u8FDB 16 \u5206\u949F\uFF08\u62A5\u4EF7\u8FC7\u671F\uFF09")}</Button><Button secondary onClick={() => run('tick',{days:3})}>{_tr("\u63A8\u8FDB 3 \u5929")}</Button><Button secondary onClick={() => run('tick',{days:7})}>{_tr("\u63A8\u8FDB 7 \u5929")}</Button></div><hr /><Button secondary onClick={() => setResetting(true)}>{_tr("\u91CD\u7F6E\u6240\u6709\u6F14\u793A\u6570\u636E")}</Button>{_tr(resetting && <div className="notice danger">{_tr("将重置共享演示数据，影响所有演示窗口。")}<Button onClick={async () => {
          if(!await reset())return;
          setOpen(false);
          setResetting(false);
          window.location.hash = '/';
        }}>{_tr("\u786E\u8BA4\u91CD\u7F6E")}</Button><button onClick={() => setResetting(false)}>{_tr("\u53D6\u6D88")}</button></div>)}</Modal>)}</>;
}
