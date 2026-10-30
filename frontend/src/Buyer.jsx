import {ActionProgress, DeliveryChecks} from './Progress';
import {EventDetails} from './ExecutionDetails';
import {BackStep} from './BackStep';
import {PropertyProgress} from './PropertyProgress';
import { useLanguage, useLanguageCode, translate as _tr } from "./Language";
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from './store';
import { categories, recommend, parsePreferences, providers, createQuote, purchase, day, date, money, statuses, buyerStatuses, buyerStatus, advanceOrder, log, DAY, addBusinessDays, businessDaysBetween } from './domain-v2.mjs';
import { Photo, PhotoGallery } from './Media';
import { Head, Panel, Field, Button, Badge, Empty, Breakdown, Audit, Demo, Modal } from './ui';
// Last successful recommendation in this tab; survives navigating to an item and back.
let lastRecommendation = null;
export function Discover() {
  const _tr = useLanguage();
  const {
    s,
    run,
    notify
  } = useStore();
  const [p, setP] = useState(s.profile);
  const [tab, setTab] = useState('match');
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState(s.profile);
  const inventory = JSON.stringify(s.items.filter(i => i.status === 'published'));
  const cachedMatch = lastRecommendation && lastRecommendation.key === JSON.stringify([s.profile, inventory]) ? lastRecommendation : null;
  const [matches,setMatches]=useState(cachedMatch ? cachedMatch.matches : []);
  const [requested, setRequested] = useState(!!cachedMatch);
  const [matching,setMatching]=useState(false);
  const change = (k, v) => setP(x => ({
    ...x,
    [k]: v
  }));
  const list = tab === 'match' ? requested ? matches : [] : s.items.filter(i => i.status === 'published' && (category === '全部' || i.category === category) && i.name.toLowerCase().includes(search.toLowerCase()));
  return <><BackStep to="/"/><Head eyebrow={_tr("BUYER WORKSPACE")} title={_tr("发现与推荐")} text={_tr("填写需求获取最多 3 件匹配推荐，或浏览全部在售家具。")} /><div className="discover-hero"><div><span className="eyebrow">A SECOND LIFE. A BETTER FIT.</span><h2>{_tr("\u4E3A\u4F60\u7684\u7A7A\u95F4\uFF0C")}<br />{_tr("\u627E\u5230\u521A\u521A\u597D\u7684\u5BB6\u5177\u3002")}</h2><p>{_tr("\u6709\u7406\u7531\u7684\u63A8\u8350\uFF0C\u900F\u660E\u7684\u62A5\u4EF7\u3002")}</p></div><Photo src="/images/room.jpg" alt={_tr("温暖的客厅空间")} /></div><div className="tabs"><button className={tab === 'match' ? 'selected' : ''} onClick={() => setTab('match')}>{_tr("\u9700\u6C42\u63A8\u8350")}</button><button className={tab === 'browse' ? 'selected' : ''} onClick={() => setTab('browse')}>{_tr("\u6D4F\u89C8\u5168\u90E8\u5BB6\u5177")}</button></div>{_tr(tab === 'match' ? <Panel title={_tr("告诉我们，你想找什么")}><form onSubmit={async e => {
 e.preventDefault(); if(matching)return;
 // Same preferences and same published inventory as the last successful run: reuse that result
 // instead of repeating the model call. Any change to either triggers a fresh request.
 const key=JSON.stringify([p, inventory]);
 if(requested && lastRecommendation && lastRecommendation.key===key){notify('条件和在售家具都没有变化，已显示最新推荐。');return;}
 setMatching(true);
 const result=await run('recommend',{profile:p});
 if(result){lastRecommendation={key,matches:result};setSubmitted(p);setMatches(result);setRequested(true);}
 setMatching(false);
 }}><div className="form-grid four"><Field label={_tr("家具类别")}><select value={p.category} onChange={e => change('category', e.target.value)}>{_tr(categories.map(c => <option key={c} value={c}>{_tr(c)}</option>))}</select></Field><Field label={_tr("商品最高预算 AUD")} required type="number" min="1" value={p.budget} onChange={e => change('budget', +e.target.value)} /><Field label={_tr("可接受成色")}><select value={p.condition} onChange={e => change('condition', e.target.value)}>{_tr(['优秀', '良好', '一般'].map(c => <option key={c} value={c}>{_tr(c)}</option>))}</select></Field><Field label={_tr("门宽 cm")} required type="number" min="1" value={p.door} onChange={e => change('door', +e.target.value)} />{_tr([['width', '空间宽度 cm'], ['depth', '空间深度 cm'], ['height', '空间高度 cm']].map(([k, t]) => <Field key={k} label={_tr(t)} required type="number" min="1" value={p[k]} onChange={e => change(k, +e.target.value)} />))}</div><Field label={_tr("其他偏好 · 高权重优先排序")}><textarea value={p.preferences} onChange={e => change('preferences', e.target.value)} placeholder={_tr("例如：喜欢绿色布艺，希望有扶手，优先双人沙发")} /></Field><div className="row between wrap"><Button type="submit" loading={matching}>{_tr("\u89E3\u6790\u504F\u597D\uFF0C\u83B7\u53D6\u63A8\u8350 \u2197")}</Button></div></form></Panel> : <div className="toolbar"><select aria-label={_tr("目录类别")} value={category} onChange={e => setCategory(e.target.value)}>{_tr(['全部', ...categories].map(c => <option key={c} value={c}>{_tr(c)}</option>))}</select><input aria-label={_tr("搜索家具")} placeholder={_tr("搜索家具名称")} value={search} onChange={e => setSearch(e.target.value)} /></div>)}<div className="section-title"><h2>{_tr(tab === 'match' ? '为你挑选' : '家具目录')}</h2><span>{_tr(list.length)}{_tr("\u4EF6 \xB7 AUD")}</span></div><div className="catalog-grid">{_tr(list.map(i => <Link className="furniture-card" to={'/buyer/items/' + i.id} key={i.id}><div className="photo"><Photo src={i.image} alt={_tr(i.name)} /><Badge>{_tr(i.condition)}</Badge>{_tr(i.score !== undefined && <strong className="score">{_tr(i.score)}{_tr("% \u5339\u914D")}</strong>)}</div><div className="card-body"><div className="row between"><h3>{_tr(i.name)}</h3><strong>{_tr(money(i.price))}</strong></div><p>{_tr(i.material)} · {_tr(i.width)} × {_tr(i.depth)} × {_tr(i.height)} cm</p>{_tr(i.score !== undefined && <p className="match-reason">{_tr("\u2713 \u9884\u7B97\u3001\u7A7A\u95F4\u4E0E\u6210\u8272\u7B26\u5408")}<br />{_tr("\u504F\u597D\u5339\u914D\uFF1A")}{_tr(i.matched.join('、') || '暂无标签命中')}<br />{_tr(i.doorFit ? '门宽初步检查可行' : '通行不确定，需要进一步配送检查')}</p>)}<small>⌖ {_tr(i.suburb)}<span>{_tr("\u67E5\u770B\u5BB6\u5177 \u2197")}</span></small></div></Link>))}</div>{_tr(!list.length && <Empty text={_tr(tab === 'match' && !requested ? '填写需求，开始寻找你的家具' : '暂无符合条件的家具，请调整需求')} />)}<Demo /></>;
}
export function Item() {
  const _tr = useLanguage();
  const {
    listingId
  } = useParams();
  const {
    s
  } = useStore();
  const i = s.items.find(i => i.id === listingId);
  if (!i) return <Empty text={_tr("未找到家具")} to="/buyer/discover" />;
  return <><BackStep to="/buyer/discover" itemId={listingId}/><Head eyebrow={_tr("FURNITURE DETAILS")} title={_tr(i.name)} text={_tr(i.suburb)} /><div className="split"><div><PhotoGallery item={i} /></div><Panel><Badge>{_tr(i.condition)} · {_tr(i.category)}</Badge><h2>{_tr(i.name)}</h2><div className="big-price">{_tr(money(i.price))}</div><p className="muted">{_tr("\u5546\u54C1\u4EF7\u683C \xB7 \u914D\u9001\u8D39\u7528\u4E0B\u4E00\u6B65\u786E\u5B9A")}</p><div className="specs"><span>{_tr("\u5C3A\u5BF8")}<b>{_tr(i.width)} × {_tr(i.depth)} × {_tr(i.height)} cm</b></span><span>{_tr("\u6750\u8D28")}<b>{_tr(i.material)}</b></span><span>{_tr("\u8FD1\u4F3C\u5E74\u9F84")}<b>{_tr(i.age)}{_tr("\u5E74")}</b></span><span>{_tr("\u53D6\u8D27\u5730")}<b>{_tr(i.pickup)}</b></span></div><p>{_tr("\u53D6\u8D27\u6761\u4EF6\uFF1A")}{_tr(i.access)}</p>{_tr(i.status === 'published' ? <Link className="button block" to={'/buyer/items/' + i.id + '/delivery'}>{_tr("我想要这件 →")}</Link> : <p className="notice warning">{_tr("\u6B64\u5BB6\u5177\u5DF2\u4E0D\u53EF\u552E\uFF0C\u8BF7\u9009\u62E9\u5176\u4ED6\u5BB6\u5177\u3002")}</p>)}</Panel></div></>;
}
export {Delivery} from './DeliveryForm';
export function Checkout() {
  const _tr = useLanguage();
  const {
    quoteId
  } = useParams();
  const {
    s,
    run
  } = useStore();
  const nav = useNavigate();
  const [accept, setAccept] = useState(false);
  const [method, setMethod] = useState('Visa / Mastercard');
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paidOrder, setPaidOrder] = useState('');
  const q = s.quotes.find(q => q.id === quoteId);
  const i = q && s.items.find(i => i.id === q.itemId);
  if (!q || !i) return <Empty text={_tr("报价不存在")} to="/buyer/discover" />;
  const expired = s.now >= q.expires;
  async function pay(e) {
    e.preventDefault();
    if (busy || paidOrder) return;
    setBusy(true);
    const o = await run('purchase',{quoteId:q.id,method});
    if (o?.id) setPaidOrder(o.id);
    setBusy(false);
  }
  return <><BackStep to={"/buyer/items/"+i.id+"/delivery"} itemId={i.id} state={{delivery:q.delivery}}/><Head eyebrow={_tr("CHECKOUT · STEP 02")} title={_tr("确认订单与付款")} text={_tr("确认你的家具与配送安排。")} /><div className="split"><Panel title={_tr("家具与配送")}><div className="item-summary"><Photo src={i.image} alt={_tr(i.name)} /><div><h2>{_tr(i.name)}</h2><p>{_tr(i.width)} × {_tr(i.depth)} × {_tr(i.height)} cm</p><Badge>{_tr(i.condition)}</Badge></div></div><hr /><p><b>{_tr("\u914D\u9001\u81F3")}</b><br />{_tr(q.delivery.address)}</p><p>{_tr(q.provider)}{_tr("\xB7 \u9884\u8BA1\u4E0A\u95E8")}{_tr(q.expected)}</p><p>{_tr(q.delivery.movers)}{_tr("\u4EBA\u642C\u8FD0 \xB7")}{_tr(({ground:'底层',lift:'电梯',stairs:'楼梯'})[q.delivery.access])}{_tr("\u901A\u884C")}</p><small>{_tr("\u62A5\u4EF7\u7F16\u53F7")}{_tr(q.id)}{_tr("\xB7 \u6709\u6548\u81F3")}{_tr(date(q.expires))}</small></Panel><Panel title={_tr("费用明细")}><Breakdown price={q.itemPrice} delivery={q.deliveryFee} /><label className="check"><input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} /><span>{_tr("\u6211\u63A5\u53D7\u56FA\u5B9A\u603B\u4EF7\u548C")}<Link to="/agreement" target="_blank" rel="noreferrer">{_tr("\u7528\u6237\u534F\u8BAE \u2197")}</Link></span></label><Field label={_tr("付款方式")}><select value={method} onChange={e => setMethod(e.target.value)}><option value={"Visa / Mastercard"}>Visa / Mastercard</option><option value={"BPAY"}>BPAY</option></select></Field>{_tr(expired && <p className="notice warning">{_tr("\u62A5\u4EF7\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u8FD4\u56DE\u91CD\u65B0\u83B7\u53D6\u3002")}</p>)}<Button disabled={!accept || expired || q.consumed} onClick={() => setPayOpen(true)}>{_tr("\u524D\u5F80\u4ED8\u6B3E \xB7")}{_tr(money(q.total))}</Button><p className="muted">{_tr("\u6F14\u793A\u4ED8\u6B3E\uFF0C\u65E0\u771F\u5B9E\u6263\u6B3E\u3002")}</p></Panel></div><Demo />{_tr(payOpen && <Modal title={_tr(method === 'BPAY' ? 'BPAY · 演示付款' : 'Visa / Mastercard · 演示付款')} onClose={() => paidOrder ? nav('/buyer/orders/'+paidOrder) : setPayOpen(false)}><form onSubmit={pay}>{!paidOrder && <button type="button" className="text-button back-step" disabled={busy} onClick={()=>setPayOpen(false)}>← {_tr("返回上一步")}</button>}<div className="payment-brand">{_tr(method === 'BPAY' ? 'BPAY' : 'VISA  /  Mastercard')}</div>{_tr(method === 'BPAY' ? <><Field label={_tr("Biller code")} readOnly value={q.biller} /><Field label={_tr("Customer reference")} readOnly value={q.reference} /><Field label={_tr("金额 AUD")} readOnly value={q.total} /></> : <><Field label={_tr("持卡人姓名（测试）")} placeholder={_tr("DEMO USER")} required autoComplete="off" /><Field label={_tr("卡号（测试）")} placeholder={_tr("4242 4242 4242 4242")} required autoComplete="off" /><div className="form-grid"><Field label={_tr("有效期（测试）")} placeholder={_tr("MM / YY")} required autoComplete="off" /><Field label={_tr("安全码（测试）")} placeholder={_tr("123")} required type="password" autoComplete="off" /></div></>)}{busy && <p className="notice" role="status">{_tr("正在处理付款…")}</p>}<Button type="submit" loading={busy} disabled={busy || !!paidOrder} className={paidOrder ? "payment-confirmed" : ""}>{paidOrder ? _tr("付款agent已确认收到款") : <>{_tr("\u5B8C\u6210\u6F14\u793A\u4ED8\u6B3E")}{_tr(money(q.total))}</>}</Button>{paidOrder && <p><Link to={"/buyer/orders/"+paidOrder} className="text-button">{_tr("查看订单 →")}</Link></p>}</form></Modal>)}</>;
}
export function Orders() {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const lang = useLanguageCode();
  const [filter, setFilter] = useState('pending');
  const list = s.orders.filter(o => buyerStatus(o) === filter);
  const open = s.orders.filter(o => buyerStatus(o) !== 'completed').length;
  return <><Head eyebrow={_tr("YOUR ORDERS")} title={_tr("我的订单")} text={lang === 'en' ? `${s.orders.length} orders · ${open} in progress` : `共 ${s.orders.length} 个订单 · ${open} 个进行中`} /><div className="tabs wrap">{_tr(Object.entries(buyerStatuses).map(([v, t]) => <button key={v} className={filter === v ? 'selected' : ''} onClick={() => setFilter(v)}>{_tr(t)}</button>))}</div>{_tr(list.length ? list.map(o => <Link className="order-row panel" key={o.id} to={'/buyer/orders/' + o.id}><Photo src={o.item.image} alt={_tr(o.item.name)} /><div><small>{_tr(o.id)}</small><h3>{_tr(o.item.name)}</h3><p>{_tr(day(o.created))} · {_tr(o.provider)}</p></div><Badge>{_tr(buyerStatuses[buyerStatus(o)])}</Badge><strong>{_tr(money(o.total))}</strong><span>{_tr("\u67E5\u770B\u8BA2\u5355 \u2192")}</span></Link>) : <Empty text={_tr("该状态暂无订单")} />)}<Demo /></>;
}
export function OrderDetail({
  admin = false
}) {
  const _tr = useLanguage();
  const {
    orderId
  } = useParams();
  const {
    s,
    run
  } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settledOrder, setSettledOrder] = useState('');
  const [issue, setIssue] = useState(false);
  const [problem, setProblem] = useState('');
  const [evidence, setEvidence] = useState('');
  const o = s.orders.find(o => o.id === orderId);
  if (!o) return <Empty text={_tr("订单不存在")} to={admin ? '/manager/overview' : '/buyer/orders'} />;
  const stages = admin ? Object.values(statuses) : Object.values(buyerStatuses);
  const stage = Object.keys(admin ? statuses : buyerStatuses).indexOf(admin ? o.status : buyerStatus(o));
  return <><BackStep to={admin?"/manager/overview":"/buyer/orders"} clear={false}/><Head eyebrow={_tr(o.id)} title={_tr(o.item.name)} text={_tr('创建于 ' + date(o.created))}><Badge tone={o.issue ? 'warning' : ''}>{_tr(admin ? statuses[o.status] : buyerStatuses[buyerStatus(o)])}</Badge></Head><div className="timeline">{_tr(stages.map((t, i) => <div key={t} className={i <= stage ? 'complete' : ''}><span>{_tr(i < stage ? '✓' : i + 1)}</span>{_tr(t)}</div>))}</div><div className="split"><div><Panel title={_tr("配送与当前进度")}><div className="item-summary"><Photo src={o.item.image} alt={_tr(o.item.name)} /><div><h3>{_tr(o.item.name)}</h3><p>{_tr(o.item.width)} × {_tr(o.item.depth)} × {_tr(o.item.height)} cm</p></div></div><p>{_tr("\u53D6\u8D27\uFF1A")}{_tr(o.item.pickup)}</p><p>{_tr("\u9001\u8D27\uFF1A")}{_tr(o.address)}</p><p>{_tr(o.provider)}{_tr("\xB7 \u9884\u8BA1\u4E0A\u95E8")}{_tr(o.expected || '按样例计划')}</p>{o.requests.map(r=><PropertyProgress key={r.token} request={r}/>)}<DeliveryChecks order={o}/>{_tr(o.status === 'pending' && <p className="notice">{_tr(o.requests.some(r => r.status === 'pending') ? '等待物业回复' : o.providerAccepted ? '已安排取货' : '等待取货安排')}</p>)}{_tr(o.delivered && <><p>{_tr("\u9001\u8FBE\u65F6\u95F4\uFF1A")}{_tr(date(o.delivered))}</p></>)}{_tr(o.issue && <div className="notice warning"><b>{_tr("\u95EE\u9898\u5904\u7406\u4E2D \xB7 \u7ED3\u7B97\u88AB\u963B\u6B62")}</b><p>{_tr(o.issue.text)}</p><p>{_tr("\u8BC1\u636E\uFF1A")}{_tr(o.issue.evidence)}</p></div>)}{_tr(!admin && o.status === 'received' && !o.issue && <div className="row wrap"><Button className="delivery-confirm" onClick={() => {setSettledOrder('');setConfirm(true);}}>{_tr("\u786E\u8BA4\u5B8C\u597D\u6536\u8D27")}</Button><Button secondary className="delivery-report" onClick={() => setIssue(true)}>{_tr("\u62A5\u544A\u4EA4\u4ED8\u95EE\u9898")}</Button></div>)}{_tr(o.status === 'settled' && <p className="notice success">{_tr("\u4E70\u5BB6\u5DF2\u9A8C\u6536\uFF0C\u4EA4\u6613\u5B8C\u6210\u3002")}</p>)}</Panel><Panel title={_tr("处理时间线")}>{_tr(o.events.slice().reverse().map((e, i) => <div className="audit-item" key={i}><b>{_tr(admin?e.agent:'系统消息')}</b><time>{_tr(date(e.time))}</time><p>{_tr(e.text)}</p>{admin&&<EventDetails event={e}/>}</div>))}</Panel></div><div>{admin && o.policyHandling && <div className="notice policy-handled"><b>{_tr("按政策自动处理的冲突")}</b><p>{_tr(o.policyHandling.direction === "logistics" ? "接受替代配送方案，额外 $25 由平台承担（模拟记录，不改变实际分账）。" : "买家总价不变，已请承运方提供不加价的替代方案。")}</p><small>P-EXTRA v{o.policyHandling.policy?.version} · {_tr(date(o.policyHandling.time))}</small></div>}<Panel title={_tr("订单金额")}><Breakdown price={o.item.price} delivery={o.deliveryFee} /><p className={"notice" + (!admin ? " payment-held" : "")}>{_tr(o.held ? (admin ? '资金已留置，条件满足前不会放款。' : '已付款') : (admin ? '结算已完成。' : '交易完成'))}</p>{admin && <ActionProgress operation="purchase" subject={o.id} title={_tr("模拟付款处理")}/>}
{admin && o.status === 'settled' && <ActionProgress operation="advance" subject={o.id} title={_tr("验收与结算处理")}/>}<small>{_tr("\u6536\u636E\uFF1A")}{_tr(o.receipt)}</small></Panel>{_tr(admin && <Panel title={_tr("内部结算明细")}><p>{_tr("\u5356\u5BB6\u670D\u52A1\u8D39\uFF1A")}{_tr(money(o.item.price * .02))}</p><p>{_tr("\u7269\u6D41\u670D\u52A1\u8D39\uFF1A")}{_tr(money(o.deliveryFee * .1))}</p><p>{_tr("\u5356\u5BB6\u51C0\u989D\uFF1A")}{_tr(money((Math.round(o.item.price * 100) - Math.round(o.item.price * 2)) / 100))}</p><p>{_tr("\u7269\u6D41\u65B9\u51C0\u989D\uFF1A")}{_tr(money((Math.round(o.deliveryFee * 100) - Math.round(o.deliveryFee * 10)) / 100))}</p><small>{_tr("\u652F\u4ED8\u6807\u8BC6\uFF1A")}{_tr(o.paymentKey)}<br />{_tr("\u8F6C\u8D26\u6807\u8BC6\uFF1A")}{_tr(o.payoutKey || '尚未生成')}</small></Panel>)}{_tr(admin && <Audit object={o.id} />)}<Demo order={o} /></div></div>{_tr(confirm && <Modal title={_tr("确认家具完好？")} onClose={() => setConfirm(false)}><p>{_tr("请确认家具符合描述且完好。确认后交易完成并自动结算。")}</p><Button loading={settling} disabled={settling || settledOrder === o.id} className={settledOrder === o.id ? "payment-confirmed" : ""} onClick={async () => {
        if (settling || settledOrder === o.id) return;
        setSettling(true);
        const done = await run('advance',{orderId:o.id,action:'confirm'});
        if (done?.status === 'settled' && done.held === false) setSettledOrder(o.id);
        setSettling(false);
      }}>{_tr(settledOrder === o.id ? "付款agent已完成结算" : "确认完好收货")}</Button>{settledOrder === o.id && <p><button type="button" className="text-button" onClick={() => setConfirm(false)}>{_tr("返回订单")}</button></p>}</Modal>)}{_tr(issue && <Modal title={_tr("报告交付问题")} onClose={() => setIssue(false)}><form onSubmit={async e => {
        e.preventDefault();
        const done = await run('advance',{orderId:o.id,action:'issue',data:{text:problem,evidence}});
        if (done) setIssue(false);
      }}><Field label={_tr("问题描述")}><textarea required value={problem} onChange={e => setProblem(e.target.value)} /></Field><Field label={_tr("证据说明（照片内容 / 送达记录）")}><textarea required value={evidence} onChange={e => setEvidence(e.target.value)} /></Field><Button type="submit">{_tr("\u63D0\u4EA4\u95EE\u9898\uFF0C\u4FDD\u6301\u8D44\u91D1\u7559\u7F6E")}</Button></form></Modal>)}</>;
}
