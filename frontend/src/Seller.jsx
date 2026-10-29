import {PricingExplanation} from './PricingExplanation';
import { useLanguage, translate as _tr } from "./Language";
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from './store';
import { categories, money, round, sellerStatuses, sellerStatus, defaultPhotos, saveListing, day } from './domain-v2.mjs';
import { Head, Panel, Field, Button, Badge, Empty, Breakdown, Demo } from './ui';
import { Photo, PhotoUpload } from './Media';
export function Listings() {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const [filter, setFilter] = useState('published');
  const items = s.items.filter(i => sellerStatus(s, i) === filter);
  return <><Head eyebrow={_tr("SELLER WORKSPACE")} title={_tr("给旧家具，新的可能。")} text={_tr("从发布到交易完成，每一步都清晰可见。")}><Link className="button" to="/seller/listings/new">{_tr("\uFF0B \u53D1\u5E03\u4E00\u4EF6\u5BB6\u5177")}</Link></Head><div className="tabs wrap">{_tr(Object.entries(sellerStatuses).map(([v, t]) => <button className={filter === v ? 'selected' : ''} key={v} onClick={() => setFilter(v)}>{_tr(t)} <small>{_tr(s.items.filter(i => sellerStatus(s, i) === v).length)}</small></button>))}</div><div className="catalog-grid">{_tr(items.map(i => <Link className="furniture-card" key={i.id} to={'/seller/listings/' + i.id}><div className="photo"><Photo src={i.image} alt={_tr(i.name)} /><Badge>{_tr(sellerStatuses[sellerStatus(s, i)])}</Badge></div><div className="card-body"><div className="row between"><h3>{_tr(i.name)}</h3><strong>{_tr(money(i.price))}</strong></div><p>{_tr(i.category)} · {_tr(i.condition)} · {_tr(i.width)} × {_tr(i.depth)} × {_tr(i.height)} cm</p><small>⌖ {_tr(i.suburb || i.pickup)}<span>{_tr("\u67E5\u770B\u8BE6\u60C5 \u2192")}</span></small></div></Link>))}</div>{_tr(!items.length && <Empty text={_tr("该状态暂无家具")} />)}<Demo /></>;
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
export function Submit() {
  const _tr = useLanguage();
  const {
    listingId
  } = useParams();
  const {
    run,
    notify,
    s
  } = useStore();
  const nav = useNavigate();
  const existing = s.items.find(i => i.id === listingId);
  const [f, setF] = useState(() => ({
    ...defaults,
    moveout: day(s.now),
    ...existing,
    photos: existing?.photos || structuredClone(defaults.photos)
  }));
  const [recordId, setRecordId] = useState(listingId);
  const [errors, setErrors] = useState(existing?.errors || {});
  const [reviewStatus,setReviewStatus]=useState(existing?.reviewStatus||'');
  const [busy, setBusy] = useState(false);
  useEffect(()=>{setF({...defaults,moveout:day(s.now),...existing,photos:existing?.photos||structuredClone(defaults.photos)});setRecordId(listingId);setErrors(existing?.errors||{});},[listingId]);
  const set = (k, v) => setF(x => ({
    ...x,
    [k]: v
  }));
  const [estimate,setEstimate]=useState(null);
  const [pricingBusy,setPricingBusy]=useState(false);
  const requestEpoch=useRef(0);
  const pricingFields=['name','category','material','condition','age','width','depth','height','photos','risk','evidence'];
  const pricingInput=()=>Object.fromEntries(pricingFields.map(k=>[k,f[k]]));
  const [pricedInput,setPricedInput]=useState('');
  useEffect(()=>{requestEpoch.current++;setEstimate(null);setPricedInput('');setPricingBusy(false);return()=>{requestEpoch.current++;};},[listingId]);
  const suggested=estimate?.suggested;
  const pricingChanged=!!estimate && pricedInput!==JSON.stringify(pricingInput());
  async function getSuggestion(){
    if(pricingBusy)return;
    const stamp=++requestEpoch.current, input=pricingInput();
    setEstimate(null);
    setPricingBusy(true);
    try {
      const result=await run('pricing',{form:input});
      if(stamp!==requestEpoch.current)return;
      setEstimate(result||{status:'request_incomplete'});
      setPricedInput(JSON.stringify(input));
    } finally { if(stamp===requestEpoch.current)setPricingBusy(false); }
  }
  const pricingMessages={request_incomplete:'本次请求未完成，已填写的资料保留，请重试。',category_mismatch:'照片中的家具与所选类别不一致，请检查家具类别；椅子、桌子、柜子请选择“其他”。',review_input_limit:'图片审核请求超过服务输入限制，尚未完成审核；请联系平台处理。',review_busy:'图片审核服务繁忙，请稍后重试；尚未判定图片是否合格。',review_timeout:'图片审核超时，请稍后重试；尚未判定图片是否合格。',review_unavailable:'图片审核服务暂不可用，请稍后重试；尚未判定图片是否合格。',input_invalid:'家具资料不完整或格式不正确，请检查以下字段。',photo_rejected:'上传图片不符合平台政策',incomplete:'请先填写家具名称、类别、材质、成色、年限和尺寸。',not_configured:'外部比价服务尚未配置，暂时无法获取建议售价。',insufficient:'外部来源未找到符合条件的可比商品。这不代表表单填写错误，你仍可自行定价。',provider_unavailable:'外部商品查询失败，请稍后重试。',model_unavailable:'商品比对暂时不可用，请稍后重试。'};
  if (existing && existing.status !== 'rejected') return <Empty text={_tr("此家具不能修改")} to={'/seller/listings/' + listingId} />;
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await run('listing',{form:f,id:recordId});
    setBusy(false);
    if (!result) return;
    setRecordId(result.id);
    setErrors(result.errors);setReviewStatus(result.reviewStatus||'');
    if (result.status === 'published') {
      notify('家具已上架');
      nav('/seller/listings/' + result.id);
    } else notify(result.reviewStatus?.startsWith('review_')?'审核暂未完成，资料已保留，请稍后重新提交。':'资料已保存在拒绝上架中，请修改标记字段后重新提交。');
  }
  const error = k => {const value=errors[k]||(!pricingChanged?estimate?.errors?.[k]:null);return value?<small className="field-error" role="alert">{_tr(value)}</small>:null;};
  const textField = (key, label, props = {}) => <div><Field label={_tr(label + ' *')} value={f[key]} onChange={e => set(key, e.target.value)} aria-invalid={!!errors[key]} {...props} />{_tr(error(key))}</div>;
  const comps = s.items.filter(i => i.category === f.category && i.status === 'published');

  return <><Head eyebrow={_tr("LIST A PIECE")} title={_tr(existing ? '修改后重新提交' : '让闲置，开启下一段故事。')} text={_tr("填写家具资料与售价，审核通过后直接上架。")} /><form noValidate onSubmit={submit} className="split"><div><Panel title={_tr("家具照片")}><PhotoUpload photos={f.photos} errors={errors} onChange={v => set('photos', v)} onBusy={setBusy} /><details className="demo-settings"><summary>{_tr("\u6F14\u793A\u5DE5\u5177")}</summary><button type="button" className="text-button" disabled={busy} onClick={() => set('photos', defaultPhotos('/images/sofa.jpg'))}>{_tr("\u4F7F\u7528\u6F14\u793A\u7167\u7247")}</button></details></Panel><Panel title={_tr("家具资料")}><div className="form-grid">{_tr(textField('name', '家具名称', {
              maxLength: 80
            }))}<div><Field label={_tr("家具类别 *")}><select value={f.category} onChange={e => set('category', e.target.value)}>{_tr(categories.map(c => <option key={c} value={c}>{_tr(c)}</option>))}</select></Field>{_tr(error('category'))}</div>{_tr(textField('material', '材质', {
              maxLength: 80
            }))}<Field label={_tr("成色 *")}><select value={f.condition} onChange={e => set('condition', e.target.value)}>{_tr(['优秀', '良好', '一般'].map(c => <option key={c} value={c}>{_tr(c)}</option>))}</select></Field>{_tr([['width', '宽度 cm', 1, 1000], ['depth', '深度 cm', 1, 1000], ['height', '高度 cm', 1, 1000], ['age', '近似年龄（年）', 0, 100]].map(([k, t, min, max]) => <React.Fragment key={k}>{_tr(textField(k, t, {
                type: 'number',
                min,
                max
              }))}</React.Fragment>))}</div><Field label={_tr("已知风险 *")}><select value={f.risk} onChange={e => set('risk', e.target.value)}><option value="none">{_tr("\u65E0\u5DF2\u77E5\u98CE\u9669")}</option><option value={"\u7ED3\u6784"}>{_tr("\u7ED3\u6784")}</option><option value={"\u7535\u6C14"}>{_tr("\u7535\u6C14")}</option><option value={"\u536B\u751F"}>{_tr("\u536B\u751F")}</option></select></Field>{_tr(error('risk'))}<Field label={_tr("风险或其他说明")}><textarea value={f.evidence} maxLength={1000} onChange={e => set('evidence', e.target.value)} /></Field>{error('evidence')}</Panel></div><div><Panel title={_tr("联系与取货")}>{_tr(textField('contact', '联系邮箱', {
            type: 'email'
          }))}{_tr(textField('pickup', '取货地址', {
            maxLength: 250
          }))}{_tr(textField('moveout', '可取货日期', {
            type: 'date',
            min: day(s.now)
          }))}<Field label={_tr("通行条件 *")}><textarea aria-invalid={!!errors.access} maxLength={500} placeholder={_tr("楼层、电梯 / 楼梯、门宽、装卸区")} value={f.access} onChange={e => set('access', e.target.value)} /></Field>{_tr(error('access'))}<label className="check"><input type="checkbox" checked={f.ownership} onChange={e => set('ownership', e.target.checked)} />{_tr("\u6211\u58F0\u660E\u62E5\u6709\u8BE5\u5BB6\u5177\u5E76\u6709\u6743\u51FA\u552E\u3002")}</label>{_tr(error('ownership'))}</Panel><Panel title={_tr("确认售价")}><div className="suggestion" aria-live="polite">{_tr("参考价格")}<strong data-testid="suggested-price">{suggested ? money(suggested) : '—'}</strong>
            <Button loading={pricingBusy} type="button" className="pricing-request" data-testid="get-suggested-price" disabled={pricingBusy||busy} onClick={getSuggestion}>{_tr(pricingBusy?'正在审核并计算建议价…':'获取建议售价')}</Button>
            {estimate?.status!=='ready' && estimate && <p>{_tr(pricingMessages[estimate.status]||pricingMessages.provider_unavailable)}{estimate.status!=='photo_rejected' && estimate.errors && Object.entries(estimate.errors).map(([key,value])=><small style={{display:'block'}} key={key}>{_tr(({name:'家具名称',material:'材质',category:'家具类别',age:'近似年龄（年）',width:'宽度 cm',depth:'深度 cm',height:'高度 cm',front:'正面照片',top:'俯视照片',side:'侧面照片',details:'其他细节照片'})[key]||key)}：{_tr(value)}</small>)}</p>}
            {suggested && <><button type="button" className="text-button" disabled={pricingBusy||pricingChanged} onClick={()=>set('price',suggested)}>{_tr('使用参考价格')}</button><p>{_tr('依据本次查询的公开二手商品挂牌价估算，不代表实际成交价。')}</p><small>{_tr('参考资料采集时间')}：{estimate.retrievedAt}</small><details><summary>{_tr('查看比价依据')}</summary>{estimate.evidence?.map(row=><div key={row.id}><a href={row.url} target="_blank" rel="noopener noreferrer">{row.title}</a><p>{money(row.price)} AUD · {_tr('匹配度')} {row.matchScore}%</p><p>{_tr(row.reason)}</p>{row.adjustmentFactor!==undefined&&<small>{_tr('参数调整后参考价')}：{money(row.adjustedPrice)}</small>}{row.unknowns?.length>0&&<p>{_tr('未提供的参数')}：{row.unknowns.map(x=>_tr(x)).join(', ')}</p>}</div>)}</details></>}
            {estimate&&!pricingChanged&&<PricingExplanation estimate={estimate}/>}
            {pricingChanged&&<p>{_tr('家具资料已修改，可重新获取建议售价。')}</p>}
          </div>{_tr(textField('price', '商品售价 AUD', {
            type: 'number',
            min: '.01',
            max: '100000',
            step: '.01'
          }))}<Breakdown price={Number(f.price) || 0} seller /><Button type="submit" loading={busy} disabled={busy||pricingBusy}>{_tr(busy ? '照片处理中…' : recordId ? '修改并重新提交' : '提交并上架')}</Button>{_tr(Object.keys(errors).length > 0 && <p className="field-error">{_tr(reviewStatus.startsWith('review_')?'审核暂未完成，资料已保留，请稍后重新提交。':'请修改标记字段后重新提交。')}</p>)}</Panel></div></form></>;
}
export function ListingDetail() {
  const _tr = useLanguage();
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
  const photos = [['front', '正面'], ['top', '俯视'], ['side', '侧面']];
  return <><Head eyebrow={_tr(item.id)} title={_tr(item.name)}><Badge>{_tr(sellerStatuses[sellerStatus(s, item)])}</Badge></Head><div className="split"><div><Photo className="detail-photo" src={item.image} alt={_tr(item.name)} /><div className="photo-gallery">{_tr(photos.filter(([k]) => item.photos?.[k]).map(([k, t]) => <div key={k}><Photo src={item.photos[k].ref} alt={_tr(t)} /><small>{_tr(t)}</small></div>))}{_tr(item.photos?.details?.map((p, i) => <div key={p.ref}><Photo src={p.ref} alt={_tr("其他细节")} /><small>{_tr("\u5176\u4ED6\u7EC6\u8282")}{_tr(i + 1)}</small></div>))}</div><Panel title={_tr("家具资料")}><div className="specs"><span>{_tr("\u7C7B\u522B")}<b>{_tr(item.category)}</b></span><span>{_tr("\u5C3A\u5BF8")}<b>{_tr(item.width)} × {_tr(item.depth)} × {_tr(item.height)} cm</b></span><span>{_tr("\u6210\u8272")}<b>{_tr(item.condition)}</b></span><span>{_tr("\u5E74\u9F84")}<b>{_tr(item.age)}{_tr("\u5E74")}</b></span></div><p>{_tr(item.pickup)} · {_tr(item.access)}</p></Panel></div><div>{_tr(item.status === 'rejected' && <Panel title={_tr("拒绝上架")}><p className="notice warning">{_tr(item.screenReason)}</p><Link className="button" to={'/seller/listings/' + item.id + '/edit'}>{_tr("\u4FEE\u6539\u5E76\u91CD\u65B0\u63D0\u4EA4")}</Link></Panel>)}<Panel title={_tr("卖家金额明细")}><Breakdown price={item.price} seller /></Panel>{_tr(order && <Panel title={_tr("交易与结算")}><p>{_tr(order.id)}</p><Badge>{_tr(sellerStatuses[sellerStatus(s, item)])}</Badge><p>{_tr(order.status === 'settled' ? '结算已完成' : '等待买家完成验收')}</p>{_tr(order.payoutKey && <p className="muted">{_tr("\u7ED3\u7B97\u6807\u8BC6\uFF1A")}{_tr(order.payoutKey)}</p>)}<Demo order={order} /></Panel>)}</div></div></>;
}
