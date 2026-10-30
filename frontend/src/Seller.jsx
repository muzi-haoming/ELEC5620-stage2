import {ProgressSteps} from './Progress';
import { useLanguage, useLanguageCode, translate as _tr } from "./Language";
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useStore } from './store';
import { categories, money, round, sellerStatuses, sellerStatus, defaultPhotos, saveListing, day } from './domain-v2.mjs';
import { Head, Panel, Field, Button, Badge, Empty, Breakdown, Demo } from './ui';
import { Photo, PhotoUpload, PhotoGallery } from './Media';
// Status badge colour: not approved = red, completed = grey, everything else keeps the role colour.
const sellerTone = status => status === 'rejected' ? 'danger' : status === 'completed' ? 'muted' : '';
export function Listings() {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const [filter, setFilter] = useState('all');
  // Seller-facing groups: the three logistics stages are one "in progress" group (each card still shows its exact stage).
  const groups = {all: ['全部', null], published: ['在售', ['published']], rejected: ['未通过审核', ['rejected']], active: ['交易中', ['pending', 'transit', 'received']], completed: ['交易完成', ['completed']]};
  const inGroup = key => groups[key][1] ? s.items.filter(i => groups[key][1].includes(sellerStatus(s, i))) : s.items;
  const items = inGroup(filter);
  return <><Head eyebrow={_tr("SELLER WORKSPACE")} title={_tr("我的家具")}><Link className="button" to="/seller/listings/new">{_tr("\uFF0B \u53D1\u5E03\u4E00\u4EF6\u5BB6\u5177")}</Link></Head><div className="tabs wrap">{_tr(Object.entries(groups).map(([v, [t]]) => <button className={(filter === v ? 'selected' : '') + (v === 'rejected' ? ' tab-danger' : '')} key={v} onClick={() => setFilter(v)}>{_tr(t)} <small>{_tr(inGroup(v).length)}</small></button>))}</div><div className="catalog-grid">{_tr(items.map(i => <Link className="furniture-card" key={i.id} to={'/seller/listings/' + i.id}><div className="photo"><Photo src={i.image} alt={_tr(i.name)} /><Badge tone={sellerTone(sellerStatus(s, i))}>{_tr(sellerStatuses[sellerStatus(s, i)])}</Badge></div><div className="card-body"><div className="row between"><h3>{_tr(i.name)}</h3><strong>{_tr(money(i.price))}</strong></div><p>{_tr(i.category)} · {_tr(i.condition)} · {_tr(i.width)} × {_tr(i.depth)} × {_tr(i.height)} cm</p><small>⌖ {_tr(i.suburb || i.pickup)}<span>{_tr("\u67E5\u770B\u8BE6\u60C5 \u2192")}</span></small></div></Link>))}</div>{_tr(!items.length && <Empty text={_tr("该状态暂无家具")} />)}<Demo /></>;
}
const defaults = {
  name: '',
  category: '沙发',
  material: '',
  condition: '良好',
  age: 2,
  width: 180,
  depth: 80,
  height: 75,
  price: 380,
  contact: '',
  pickup: '',
  access: '',
  moveout: '2026-10-30',
  ownership: false,
  risk: 'none',
  evidence: '',
  photos: {
    front: null,
    top: null,
    side: null,
    details: []
  }
};
// Client-side checks mirroring the server's listing validation (price is checked at the last step).
function detailErrors(f, today) {
  const e = {}, text = (k, lo, hi) => {const v = f[k]; if (typeof v !== 'string' || v.trim().length < lo || v.trim().length > hi) e[k] = `请填写有效内容（${lo}–${hi} 字符）`;};
  text('name', 2, 80); text('material', 2, 80); text('pickup', 5, 250); text('access', 5, 500);
  if (!['沙发', '床', '其他'].includes(f.category)) e.category = '请选择家具类型';
  if (!['一般', '良好', '优秀'].includes(f.condition)) e.condition = '请选择成色';
  for (const [k, lo, hi] of [['width', 1, 1000], ['depth', 1, 1000], ['height', 1, 1000], ['age', 0, 100]]) {
    const n = Number(f[k]); if (f[k] === '' || f[k] === null || !Number.isFinite(n) || n < lo || n > hi) e[k] = `请输入 ${lo}–${hi} 范围内的数值`;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.contact || ''))) e.contact = '请输入有效邮箱';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.moveout || '')) || f.moveout < today) e.moveout = '可取货日期不能早于当前日期';
  if (f.ownership !== true) e.ownership = '请确认所有权声明';
  for (const [k, label] of [['front', '正面'], ['top', '俯视'], ['side', '侧面']]) if (!f.photos?.[k]?.ref) e[k] = `请上传${label}照片`;
  if ((f.photos?.details || []).length > 2) e.details = '其他细节最多 2 张';
  if (f.risk !== 'none') e.risk = f.risk + '风险：' + (f.evidence || '请补充风险说明');
  if ((f.evidence || '').length > 1000) e.evidence = '说明不能超过 1000 字符';
  return e;
}
function priceError(price) {
  const n = Number(price);
  if (price === '' || !Number.isFinite(n) || n < 0.01 || n > 100000) return '请输入 0.01–100000 范围内的数值';
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return '售价最多保留两位小数';
  return null;
}
// The reviewer's own short reason and suggestion when there is one; otherwise a generic line.
function rejectionNotice(result, fallback = '审核未通过，请按标记修改后重新提交。') {
  const status = String(result.reviewStatus || result.status || '');
  if (status.startsWith('review_')) return '审核暂未完成，资料已保留，请稍后重新提交。';
  const f = result.feedback;
  return f?.reason ? `未通过：${f.reason}\n建议：${f.suggestion}` : fallback;
}
// Explains where the suggested price came from: live listings, stored listings or an AI estimate.
function PricingBasis({estimate: e}) {
  const _tr = useLanguage(), unit = useLanguageCode() === 'en' ? 'items' : '件';
  const c = e.calculation || {};
  const day = iso => iso ? new Date(iso).toLocaleDateString() : '';
  const rule = <small>{_tr('成色按一般 0.65、良好 0.85、优秀 1.00 折算；年限每年折减 6%，最低保留 35%。')}</small>;
  if (e.pricingMethod === 'ai') return <>
    <p className="pricing-label">{_tr('未找到同类在售商品，以下为估算。')}</p>
    <p>{_tr('全新估价')} {money(c.newPrice)} × {_tr('成色系数')} {c.conditionFactor} × {_tr('年限系数')} {c.ageFactor} = <b>{money(c.result)}</b></p>
    {e.basis && <p>{_tr('估价依据')}：{e.basis}</p>}
    <small>{_tr('可信度')}：{_tr({low: '低', medium: '中', high: '高'}[e.confidence] || e.confidence)} · </small>{rule}
  </>;
  const rows = e.evidence || [];
  const source = rows.find(r => r.id === c.sourceId);
  return <>
    <p className="pricing-label">{e.pricingMethod === 'history'
      ? _tr('依据近期采集的同类二手商品') + `（${day(e.collectedFrom)}${e.collectedTo && e.collectedTo !== e.collectedFrom ? ' – ' + day(e.collectedTo) : ''}，${rows.length} ${unit}）`
      : _tr('依据今天采集的同类二手商品') + `（${rows.length} ${unit}）`}</p>
    {e.sampleLimited && <p className="notice warning">{_tr('参考样本较少，请结合自己的情况决定售价。')}</p>}
    {c.marketPrice !== undefined && <p>{_tr('最接近的挂牌价')} {money(c.marketPrice)} × {_tr('成色、年限折算')} {c.factor} = <b>{money(c.result)}</b>{source && <> · <a href={source.url} target="_blank" rel="noopener noreferrer">{_tr('查看来源')}</a></>}</p>}
    {rule}
    <details><summary>{_tr('查看全部参考商品')}</summary>{rows.map(r => <div className="pricing-source" key={r.id}>
      <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
      <small>{money(r.price)} · {_tr('匹配度')} {r.matchScore}% · {r.source || ''}{r.observedAt ? ' · ' + day(r.observedAt) : ''}</small>
    </div>)}</details>
    <small>{_tr('挂牌价不等于成交价，仅供定价参考。')}</small>
  </>;
}
const reviewKey = f => JSON.stringify({...f, price: undefined});
const CANCEL_NOTE = '取消只是停止等待：后台可能仍会把这一步跑完，但不会改动你的资料或上架状态。';
export function Submit() {
  const _tr = useLanguage();
  const {listingId} = useParams();
  const {run, notify, s, cancel} = useStore();
  const nav = useNavigate();
  const existing = s.items.find(i => i.id === listingId);
  const blank = () => ({...defaults, moveout: day(s.now), ...existing, photos: existing?.photos || structuredClone(defaults.photos)});
  const [f, setF] = useState(blank);
  const [recordId, setRecordId] = useState(listingId);
  const [errors, setErrors] = useState(existing?.errors || {});
  const [reviewStatus, setReviewStatus] = useState(existing?.reviewStatus || '');
  const [uploading, setUploading] = useState(false);
  // details → offer (ask about the pricing assistant) → price
  const [step, setStep] = useState('details');
  const [agent, setAgent] = useState('');          // 'review' | 'pricing' | 'listing' while a request runs
  const [reviewedKey, setReviewedKey] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [pricingFailure, setPricingFailure] = useState('');
  useEffect(() => {setF(blank()); setRecordId(listingId); setErrors(existing?.errors || {}); setStep('details'); setReviewedKey(''); setEstimate(null);}, [listingId]);
  const set = (k, v) => setF(x => ({...x, [k]: v}));
  const goTo = next => {setStep(next); window.scrollTo(0, 0);};
  const pricingFields = ['name', 'category', 'material', 'condition', 'age', 'width', 'depth', 'height', 'photos', 'risk', 'evidence'];
  const pricingMessages = {request_incomplete: '本次请求未完成，已填写的资料保留，请重试。', category_mismatch: '照片中的家具与所选类别不一致，请检查家具类别；椅子、桌子、柜子请选择“其他”。', review_input_limit: '图片审核请求超过服务输入限制，尚未完成审核；请联系平台处理。', review_busy: '图片审核服务繁忙，请稍后重试；尚未判定图片是否合格。', review_timeout: '图片审核超时，请稍后重试；尚未判定图片是否合格。', review_unavailable: '图片审核服务暂不可用，请稍后重试；尚未判定图片是否合格。', input_invalid: '家具资料不完整或格式不正确，请检查以下字段。', photo_rejected: '上传图片不符合平台政策', no_estimate: '暂时无法估价，你可以自己定价。'};
  if (existing && existing.status !== 'rejected') return <Empty text={_tr("此家具不能修改")} to={'/seller/listings/' + listingId} />;
  const stopWaiting = () => {cancel(); setAgent(''); notify('已停止等待，你的资料都还在。');};

  async function review(e) {
    e?.preventDefault();
    if (agent || uploading) return;
    const found = detailErrors(f, day(s.now));
    setErrors(found);
    if (Object.keys(found).length) {
      notify('请先修改标记的字段。', 'error');
      requestAnimationFrame(() => document.querySelector('[role=alert]')?.scrollIntoView({behavior: 'smooth', block: 'center'}));
      return;
    }
    if (reviewKey(f) === reviewedKey) return goTo(estimate ? 'price' : 'offer');
    setAgent('review');
    const result = await run('review', {form: f});
    setAgent('');
    if (!result) return;
    if (!result.approved) {
      setErrors(result.errors || {}); setReviewStatus(result.reviewStatus || result.status || '');
      notify(rejectionNotice(result), 'error');
      return;
    }
    setWarnings(result.warnings || []); setReviewedKey(reviewKey(f)); setEstimate(null); setPricingFailure('');
    goTo('offer');
  }
  async function askPricing() {
    if (agent) return;
    setAgent('pricing'); setPricingFailure('');
    const result = await run('pricing', {form: Object.fromEntries(pricingFields.map(k => [k, f[k]]))});
    setAgent('');
    if (!result) return;
    if (result.status !== 'ready') {setPricingFailure(pricingMessages[result.status] || '价格小助手暂时无法给出建议，你可以自己定价。'); return;}
    setEstimate(result);
    goTo('price');
  }
  async function submit(e) {
    e.preventDefault();
    if (agent) return;
    const problem = priceError(f.price);
    if (problem) {setErrors({price: problem}); return;}
    setAgent('listing');
    const result = await run('listing', {form: f, id: recordId});
    setAgent('');
    if (!result) return;
    setRecordId(result.id);
    if (result.status === 'published') {notify(''); nav('/seller/listings/' + result.id, {state:{published:true}}); return;}
    setErrors(result.errors || {}); setReviewStatus(result.reviewStatus || ''); setReviewedKey('');
    notify(rejectionNotice(result, '资料已保存在未通过审核中，请修改标记字段后重新提交。'), 'error');
    goTo('details');
  }

  const error = k => errors[k] ? <small className="field-error" role="alert">{_tr(errors[k])}</small> : null;
  const textField = (key, label, props = {}) => <div><Field label={_tr(label + ' *')} value={f[key]} onChange={e => set(key, e.target.value)} aria-invalid={!!errors[key]} {...props} />{error(key)}</div>;
  const stepper = <ol className="listing-steps">{[['details', '填写资料'], ['offer', '审核与估价'], ['price', '定价上架']].map(([k, label], i) =>
    <li key={k} className={step === k ? 'current' : ['details', 'offer', 'price'].indexOf(step) > i ? 'done' : ''}><span>{i + 1}</span>{_tr(label)}</li>)}</ol>;
  const head = <Head eyebrow={_tr("LIST A PIECE")} title={_tr(existing ? '修改后重新提交' : '发布家具')} />;

  if (step === 'offer') return <>{head}{stepper}<Panel title={_tr('家具审核通过')}>
    <p className="notice success">{_tr('家具审核助手已检查你的资料和照片，可以继续定价。')}</p>
    {warnings.length > 0 && <div className="notice warning"><b>{_tr('小提示（不影响上架）')}</b>{warnings.map(w => <p key={w}>{_tr(w)}</p>)}</div>}
    <h3>{_tr('需要价格小助手帮你评估售价吗？')}</h3>
    <p className="muted">{_tr('价格小助手会根据家具名称、类别、材质和尺寸，用 AI 估算全新时的零售价，再按成色和年限折算出建议售价。')}</p>
    {agent === 'pricing' ? <ProgressSteps title="价格小助手正在估价" onCancel={stopWaiting} cancelNote={CANCEL_NOTE} /> :
      <div className="row wrap"><Button onClick={askPricing}>{_tr('需要，帮我估价')}</Button><Button secondary onClick={() => goTo('price')}>{_tr('不需要，我自己定价')}</Button></div>}
    {pricingFailure && <p className="notice warning">{_tr(pricingFailure)}</p>}
    <button type="button" className="text-button" disabled={!!agent} onClick={() => goTo('details')}>{_tr('← 返回修改资料')}</button>
  </Panel></>;

  if (step === 'price') {
    const c = estimate?.calculation;
    return <>{head}{stepper}<form noValidate onSubmit={submit} className="split"><div><Panel title={_tr('家具资料')}>
      <div className="item-summary"><Photo src={f.photos?.front?.ref} alt={f.name} /><div><h2>{f.name}</h2><p>{_tr(f.category)} · {_tr(f.condition)} · {f.width} × {f.depth} × {f.height} cm · {f.age}{_tr('年')}</p></div></div>
      <button type="button" className="text-button" disabled={!!agent} onClick={() => goTo('details')}>{_tr('← 返回修改资料')}</button>
    </Panel></div><div><Panel title={_tr('确认售价')}>
      <div className="suggestion" aria-live="polite">{_tr('建议售价')}<strong data-testid="suggested-price">{estimate ? money(estimate.suggested) : '—'}</strong>
        {estimate ? <>
          <button type="button" className="button pricing-request" disabled={!!agent} onClick={() => set('price', estimate.suggested)}>{_tr('使用建议售价')}</button>
          <PricingBasis estimate={estimate} />
        </> : <><p>{_tr('未使用价格小助手，请自行填写售价。')}</p><button type="button" className="text-button" disabled={!!agent} onClick={() => goTo('offer')}>{_tr('让价格小助手估一下 →')}</button></>}
      </div>
      {textField('price', '商品售价 AUD', {type: 'number', min: '.01', max: '100000', step: '.01'})}
      <Breakdown price={Number(f.price) || 0} seller />
      {agent === 'listing' && <ProgressSteps title="正在提交并上架" />}
      <Button type="submit" loading={agent === 'listing'} disabled={!!agent}>{_tr(recordId ? '修改并重新提交' : '提交并上架')}</Button>
    </Panel></div></form></>;
  }

  return <>{head}{stepper}<form noValidate onSubmit={review} className="split"><div><Panel title={_tr("家具照片")}><PhotoUpload photos={f.photos} errors={errors} onChange={v => set('photos', v)} onBusy={setUploading} /><details className="demo-settings"><summary>{_tr("演示工具")}</summary><button type="button" className="text-button" disabled={uploading || !!agent} onClick={() => set('photos', defaultPhotos('/images/sofa.jpg'))}>{_tr("使用演示照片")}</button></details></Panel><Panel title={_tr("家具资料")}><div className="form-grid">{textField('name', '家具名称', {maxLength: 80})}<div><Field label={_tr("家具类别 *")}><select value={f.category} onChange={e => set('category', e.target.value)}>{categories.map(c => <option key={c} value={c}>{_tr(c)}</option>)}</select></Field>{error('category')}</div>{textField('material', '材质', {maxLength: 80})}<Field label={_tr("成色 *")}><select value={f.condition} onChange={e => set('condition', e.target.value)}>{['优秀', '良好', '一般'].map(c => <option key={c} value={c}>{_tr(c)}</option>)}</select></Field>{[['width', '宽度 cm', 1, 1000], ['depth', '深度 cm', 1, 1000], ['height', '高度 cm', 1, 1000], ['age', '近似年龄（年）', 0, 100]].map(([k, t, min, max]) => <React.Fragment key={k}>{textField(k, t, {type: 'number', min, max})}</React.Fragment>)}</div><Field label={_tr("已知风险 *")}><select value={f.risk} onChange={e => set('risk', e.target.value)}><option value="none">{_tr("无已知风险")}</option><option value="结构">{_tr("结构")}</option><option value="电气">{_tr("电气")}</option><option value="卫生">{_tr("卫生")}</option></select></Field>{error('risk')}<Field label={_tr("风险或其他说明")}><textarea value={f.evidence} maxLength={1000} onChange={e => set('evidence', e.target.value)} /></Field>{error('evidence')}</Panel></div><div><Panel title={_tr("联系与取货")}>{textField('contact', '联系邮箱', {type: 'email'})}{textField('pickup', '取货地址', {maxLength: 250})}{textField('moveout', '可取货日期', {type: 'date', min: day(s.now)})}<Field label={_tr("通行条件 *")}><textarea aria-invalid={!!errors.access} maxLength={500} placeholder={_tr("楼层、电梯 / 楼梯、门宽、装卸区")} value={f.access} onChange={e => set('access', e.target.value)} /></Field>{error('access')}<label className="check"><input type="checkbox" checked={f.ownership} onChange={e => set('ownership', e.target.checked)} />{_tr("我声明拥有该家具并有权出售。")}</label>{error('ownership')}</Panel>
    <Panel title={_tr('提交审核')}><p className="muted">{_tr('家具审核助手只会拦下明显不是实物家具的照片；类别、角度、清晰度等小问题只会提示，不影响通过。')}</p>
      {agent === 'review' ? <ProgressSteps title="家具审核助手正在审核" onCancel={stopWaiting} cancelNote="停止等待后，审核可能仍会继续，您可稍后查看结果。" /> :
        <Button type="submit" disabled={uploading}>{_tr(reviewKey(f) === reviewedKey ? '资料未改动，继续下一步' : '提交给家具审核助手')}</Button>}
    </Panel></div></form></>;
}
export function ListingDetail() {
  const _tr = useLanguage();
  const location = useLocation();
  const [showPublished, setShowPublished] = useState(!!location.state?.published);
  useEffect(() => {
    setShowPublished(!!location.state?.published);
    if (!location.state?.published) return;
    const timer = setTimeout(() => setShowPublished(false), 6000);
    return () => clearTimeout(timer);
  }, [location.key]);
  const {
    listingId
  } = useParams();
  const {
    s,
    run
  } = useStore();
  const item = s.items.find(i => i.id === listingId);
  if (!item) return <Empty text={_tr("家具记录不存在")} to="/seller/listings" />;
  const order = s.orders.find(o => o.item.id === item.id);
  return <><Head eyebrow={_tr(item.id)} title={_tr(item.name)}><Badge tone={sellerTone(sellerStatus(s, item))}>{_tr(sellerStatuses[sellerStatus(s, item)])}</Badge></Head><div className="split"><div>{showPublished && item.status === 'published' && <div className="listing-published-notice" role="status"><span>{_tr("家具已上架")}</span><button type="button" aria-label={_tr("关闭提示")} onClick={() => setShowPublished(false)}>×</button></div>}<PhotoGallery item={item} /><Panel title={_tr("家具资料")}><div className="specs"><span>{_tr("\u7C7B\u522B")}<b>{_tr(item.category)}</b></span><span>{_tr("\u5C3A\u5BF8")}<b>{_tr(item.width)} × {_tr(item.depth)} × {_tr(item.height)} cm</b></span><span>{_tr("\u6210\u8272")}<b>{_tr(item.condition)}</b></span><span>{_tr("\u5E74\u9F84")}<b>{_tr(item.age)}{_tr("\u5E74")}</b></span></div><p>{_tr(item.pickup)} · {_tr(item.access)}</p></Panel></div><div>{_tr(item.status === 'rejected' && <Panel title={_tr("未通过审核")}><p className="notice warning">{_tr(item.screenReason)}</p><Link className="button" to={'/seller/listings/' + item.id + '/edit'}>{_tr("\u4FEE\u6539\u5E76\u91CD\u65B0\u63D0\u4EA4")}</Link></Panel>)}<Panel title={_tr("卖家金额明细")}><Breakdown price={item.price} seller /></Panel>{_tr(order && <Panel title={_tr("交易与结算")}><p>{_tr(order.id)}</p><Badge>{_tr(sellerStatuses[sellerStatus(s, item)])}</Badge><p>{_tr(order.status === 'settled' ? '结算已完成' : '等待买家完成验收')}</p>{_tr(order.payoutKey && <p className="muted">{_tr("\u7ED3\u7B97\u6807\u8BC6\uFF1A")}{_tr(order.payoutKey)}</p>)}<Demo order={order} /></Panel>)}</div></div></>;
}
