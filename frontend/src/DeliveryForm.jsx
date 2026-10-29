import {BackStep} from './BackStep';
import React,{useState,useEffect} from 'react';
import {useNavigate,useParams,useLocation} from 'react-router-dom';
import {useLanguage} from './Language';
import {useStore} from './store';
import {Head,Panel,Field,Button,Empty} from './ui';
import {createQuote,providers,money,day,addBusinessDays} from './domain-v2.mjs';
export function Delivery(){
 const t=useLanguage(),{s,run}=useStore(),{listingId}=useParams(),nav=useNavigate(),location=useLocation();
 const item=s.items.find(i=>i.id===listingId);
 const [d,setD]=useState(()=>({...{address:'',door:95,doorHeight:210,floor:0,access:'ground',loading:true,pickupAccess:true,pickupProperty:false,pickupEmail:'',deliveryProperty:false,deliveryEmail:'',provider:'economy',movers:2},...location.state?.delivery}));
 const [prices,setPrices]=useState(null),[priceError,setPriceError]=useState(false);
 useEffect(()=>{let active=true;const abort=new AbortController();setPrices(null);setPriceError(false);
 const timer=setTimeout(async()=>{if(d.address.trim().length<5)return;try{const r=await fetch('/api/delivery-options',{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Role':'buyer'},body:JSON.stringify({itemId:listingId,address:d.address}),signal:abort.signal});if(!r.ok)throw Error();const value=await r.json();if(active)setPrices(value);}catch(e){if(active&&e.name!=='AbortError')setPriceError(true);}},300);
 return()=>{active=false;clearTimeout(timer);abort.abort();};},[listingId,item?.pickup,d.address]);
 const set=(k,v)=>setD(x=>({...x,[k]:v}));
 if(!item)return <Empty text={t('未找到家具')} to="/buyer/discover"/>;
 return <><BackStep to={"/buyer/items/"+listingId} itemId={listingId}/><Head eyebrow="DELIVERY · STEP 01" title={t('从原来的家，到你的家。')} text={t('根据两端通行条件，选择固定配送方案。')}/><form onSubmit={async e=>{e.preventDefault();const q=await run('quote',{itemId:item.id,delivery:d});if(q)nav('/buyer/checkout/'+q.id);}}><div className="split"><Panel title={t('取货与送货信息')}>
 <div className="notice"><b>{t('取货：')}{item.pickup}</b><p>{t(item.access)}</p></div>
 <label className="check"><input type="checkbox" required checked={d.pickupAccess} onChange={e=>set('pickupAccess',e.target.checked)}/>{t('已确认取货端尺寸、搬运与装卸条件适合该家具')} *</label>
 <Field label={t('送货地址')+' *'} required value={d.address} onChange={e=>set('address',e.target.value)} placeholder={t('街道、区域和邮编')}/>
 <div className="form-grid">{[['door','送货门宽 cm'],['doorHeight','送货门高 cm'],['floor','楼层']].map(([k,label])=><Field key={k} label={t(label)+' *'} required type="number" min={k==='floor'?0:1} step={k==='floor'?1:'any'} value={d[k]} onChange={e=>set(k,e.target.value)}/>)}
 <Field label={t('通行方式')+' *'}><select required value={d.access} onChange={e=>set('access',e.target.value)}>{[['ground','底层'],['lift','可容纳家具的电梯'],['stairs','楼梯']].map(([v,l])=><option key={v} value={v}>{t(l)}</option>)}</select></Field>
 <Field label={t('搬运人数')+' *'}><select required value={d.movers} onChange={e=>set('movers',+e.target.value)}><option value="2">{t('2 人')}</option><option value="3">{t('3 人')}</option></select></Field></div>
 <label className="check"><input type="checkbox" required checked={d.loading} onChange={e=>set('loading',e.target.checked)}/>{t('送货端装卸区可用')} *</label>
 {['pickup','delivery'].map(k=><div className="property-field" key={k}><Field label={t(k==='pickup'?'取货端需要物业确认':'送货端需要物业确认')+' *'}><select required value={String(d[k+'Property'])} onChange={e=>set(k+'Property',e.target.value==='true')}><option value="false">{t('否')}</option><option value="true">{t('是')}</option></select></Field>{d[k+'Property']&&<Field label={t(k==='pickup'?'取货端物业邮箱':'送货端物业邮箱')+' *'} required type="email" value={d[k+'Email']} onChange={e=>set(k+'Email',e.target.value)} placeholder="strata@example.test"/>}</div>)}
 </Panel><div><Panel title={t('选择配送方案')+' *'}>{providers.map(p=><label className={'delivery-option '+(d.provider===p.id?'chosen':'')} key={p.id}><input required type="radio" name="provider" checked={d.provider===p.id} onChange={()=>set('provider',p.id)}/><div><div className="row between"><h3>{t(p.label)}</h3><strong>{prices?money(prices.find(x=>x.id===p.id)?.price):'—'}</strong></div><p>{p.name}</p><small>{t('配送时效：')}{t(p.eta)}<br/>{t('预计上门日期：')}{day(addBusinessDays(s.now,p.days))}</small></div></label>)}<p className="muted">{t(priceError?'配送报价暂不可用，请重新填写地址后重试。':prices?'配送费按取送地址分区估算。':'填写送货地址后显示配送费。')}</p></Panel><Button type="submit" disabled={item.status!=='published'||!prices}>{t('确认配送方案 →')}</Button></div></div></form></>;
}

