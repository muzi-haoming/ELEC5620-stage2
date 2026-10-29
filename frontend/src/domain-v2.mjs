import {initialState as seedData,createQuote as baseQuote,uid,log,round,money,day,parsePreferences} from './domain.mjs';
export {DAY,categories,round,money,day,uid,log,providers,parsePreferences,recommend,businessDaysBetween,addBusinessDays} from './domain.mjs';
export const date=t=>new Date(t).toLocaleString(globalThis.localStorage?.getItem('second-space-language')==='en'?'en-AU':'zh-CN',{timeZone:'Australia/Sydney',hour12:false});
export const statuses={pending:'待取货',transit:'配送中',received:'已收货',settled:'已结算'};
export const buyerStatuses={pending:'待取货',transit:'配送中',received:'已收货',completed:'交易完成'};
export const sellerStatuses={published:'可售',rejected:'拒绝上架',...buyerStatuses};
export const buyerStatus=o=>o.status==='settled'?'completed':o.status;
export const sellerStatus=(s,i)=>i.status==='rejected'?'rejected':buyerStatus(s.orders.find(o=>o.item.id===i.id)||{status:'published'});
export const defaultPhotos=image=>({front:{ref:image,name:'front.jpg'},top:{ref:image,name:'top.jpg'},side:{ref:image,name:'side.jpg'},details:[]});
const policyUpdates={
 'P-WINDOW':'物流送达后为已收货；必须由买家验收通过才交易完成，不会因时间经过自动验收。',
 'P-PAYOUT':'买家验收通过后立即完成模拟结算；管理员显示已结算，买家和卖家显示交易完成。',
 'P-ACCESS':'订单创建后为待取货。必要物业回复、最终通行检查、承运接受齐全才可取货。条件不满足时保留待取货并处理异常。',
 'P-SCREEN':'正面、俯视、侧面照片及家具、取货资料必填。校验或筛查失败统一拒绝上架，保留原因，可修改后重新提交。',
 'P-MARKET':'提交页确认有效售价后直接上架，不设待定价阶段。比较数据不足时不编造建议。',
 'P-EXTRA':'先请求不提高买家固定总价的可行替代方案；无可行方案时保留待取货并升级处理，不启动退款，不绕过验收和结算。'
};
function migrateLegacy(old){if(old.version===2)return old;const s=structuredClone(old);s.version=2;s.legacyArchive=[...(s.legacyArchive||[]),...s.orders.filter(o=>o.status==='cancelled')];s.orders=s.orders.filter(o=>o.status!=='cancelled');for(const o of s.orders){o.status=({waiting:'pending',blocked:'pending',ready:'pending',inspection:'received',disputed:'received'})[o.status]||o.status;if(['confirmed','settled'].includes(o.status))o.buyerAccepted=o.windowEnd||o.settledAt||s.now;}for(const i of s.items){if(['pricing','information','rejected'].includes(i.status)){i.status='rejected';i.screenReason||='请补全资料与售价后重新提交。';}i.photos||={front:{ref:i.image,name:'original'},top:null,side:null,details:[]};}s.policyArchive=structuredClone(s.policies);s.policies=s.policies.filter(p=>p.id!=='P-CANCEL').map(p=>({...p,rule:policyUpdates[p.id]||p.rule}));return s;}
export function migrateState(old){
 const s=structuredClone(migrateLegacy(old));
 for(const o of s.orders){
  if(o.status==='confirmed'){
   o.buyerAccepted ||= o.windowEnd || s.now;
   completeSettlement(s,o);
  }
 }
 s.policies=s.policies.map(p=>p.id==='P-PAYOUT'?{...p,rule:policyUpdates[p.id]}:p);
 return s;
}
function completeSettlement(s,o){
 if(o.status==='settled')return;
 o.payoutKey ||= uid('OUT');o.status='settled';o.settlementError=null;o.held=false;o.settledAt=s.now;
 event(s,o,'PaymentAgent','结算完成。卖家 '+money(round(o.item.price*.98))+'；物流方 '+money(round(o.deliveryFee*.9)));
}
export function initialState(){const s=migrateState(seedData());s.legacyArchive=[];for(const i of s.items)i.photos=defaultPhotos(i.image);for(const o of s.orders){o.events=o.events.map(e=>e.text.startsWith('结算完成。')?e:({...e,text:'付款完成，订单已创建。'}));o.item.photos=defaultPhotos(o.item.image);if(!s.items.some(i=>i.id===o.item.id))s.items.push({...o.item,status:'sold'});}s.items.push({...s.items[5],id:'F-REJECT',name:'待修复单椅',status:'rejected',risk:'结构',screenReason:'结构风险：椅腿不稳，请修复并更新照片后重新提交。',evidence:'椅腿不稳',errors:{risk:'结构风险：椅腿不稳'}});return s;}
export function validateListing(f,now){const e={};for(const [k,min,max] of [['name',2,80],['material',2,80],['pickup',5,250],['access',5,500]])if(typeof f[k]!=='string'||f[k].trim().length<min||f[k].length>max)e[k]='请填写有效内容（'+min+'–'+max+' 字符）';if(!['沙发','床','其他'].includes(f.category))e.category='请选择家具类型';if(!['优秀','良好','一般'].includes(f.condition))e.condition='请选择成色';for(const [k,min,max] of [['width',1,1000],['depth',1,1000],['height',1,1000],['age',0,100],['price',.01,100000]])if(!['string','number'].includes(typeof f[k])||String(f[k]).trim()==='' ||!Number.isFinite(Number(f[k]))||Number(f[k])<min||Number(f[k])>max)e[k]='请输入 '+min+'–'+max+' 范围内的数值';if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact||''))e.contact='请输入有效邮箱';if(!/^\d{4}-\d{2}-\d{2}$/.test(f.moveout||'')||!Number.isFinite(Date.parse(f.moveout))||new Date(f.moveout).toISOString().slice(0,10)!==f.moveout||f.moveout<day(now))e.moveout='可取货日期不能早于当前日期';if(f.ownership!==true)e.ownership='请确认所有权声明';for(const key of ['front','top','side'])if(!f.photos?.[key]?.ref)e[key]='请上传'+({front:'正面',top:'俯视',side:'侧面'})[key]+'照片';if((f.photos?.details?.length||0)>2)e.details='其他细节最多 2 张';if(!['none','结构','电气','卫生'].includes(f.risk))e.risk='请选择风险情况';else if(f.risk!=='none')e.risk=f.risk+'风险：'+(f.evidence?.trim()||'请补充风险说明');if(typeof f.evidence!=='string'||f.evidence.length>1000)e.evidence='说明不能超过 1000 字符';if(Number.isFinite(Number(f.price))&&Math.abs(Number(f.price)*100-Math.round(Number(f.price)*100))>.00001)e.price='售价最多保留两位小数';return e;}
export function saveListing(s,f,id){const existing=s.items.find(i=>i.id===id);if(existing&&existing.status!=='rejected')throw Error('仅拒绝上架的家具可以重新提交。');const errors=validateListing(f,s.now);const value={...structuredClone(f),id:existing?.id||uid('F'),name:f.name?.trim()||'未命名家具',price:Number(f.price)||0,width:Number(f.width)||0,depth:Number(f.depth)||0,height:Number(f.height)||0,age:Number(f.age)||0,status:Object.keys(errors).length?'rejected':'published',errors,image:f.photos?.front?.ref||'/images/sofa.jpg',created:existing?.created||s.now,updated:s.now,tags:parsePreferences((f.name||'')+' '+(f.material||'')+' '+(f.evidence||'')),suburb:f.pickup,screenReason:Object.keys(errors).length?Object.values(errors).join('；'):'资料审核通过',history:[...(existing?.history||[]),{time:s.now,errors}]};if(existing)Object.assign(existing,value);else s.items.unshift(value);log(s,'ListingAgent',value.status==='published'?'资料及售价通过审核，家具已上架。':'拒绝上架：'+value.screenReason,value.id);return value;}
function event(s,o,agent,text){o.events.push({time:s.now,agent,text});log(s,agent,text,o.id);}
export const createQuote=baseQuote;
export function purchase(s,id,method){const q=s.quotes.find(q=>q.id===id);if(!q)throw Error('报价不存在。');if(q.consumed)return s.orders.find(o=>o.quoteId===id);if(q.expires<=s.now)throw Error('报价已过期，请重新确认配送方案。');const i=s.items.find(i=>i.id===q.itemId);if(!i||i.status!=='published'||i.price!==q.itemPrice)throw Error('家具状态或价格变化，请重新获取报价。');const requests=['pickup','delivery'].filter(e=>q.delivery[e+'Property']).map(e=>({token:uid('PROP'),end:e,address:e==='pickup'?i.pickup:q.delivery.address,email:q.delivery[e+'Email'],status:'pending'}));const o={id:uid('ORD'),quoteId:q.id,item:{...i},total:q.total,deliveryFee:q.deliveryFee,provider:q.provider,expected:q.expected,address:q.delivery.address,access:q.delivery,created:s.now,status:'pending',held:true,providerAccepted:false,paymentKey:q.paymentKey,receipt:uid('R'),method,requests,events:[],issue:null,buyerAccepted:null};q.consumed=true;i.status='sold';s.orders.unshift(o);event(s,o,'PaymentAgent','付款完成，订单已创建，等待取货。');return o;}
export function propertyReply(s,token,reply){const o=s.orders.find(o=>o.requests.some(r=>r.token===token));const r=o?.requests.find(r=>r.token===token);if(!r||r.status!=='pending')throw Error('申请已回复或不存在。');if(!reply.name?.trim()||(['conditional','rejected'].includes(reply.status)&&!reply.reason?.trim()))throw Error('请填写姓名和必要的条件 / 拒绝原因。');if(!['approved','conditional','rejected'].includes(reply.status))throw Error('请选择回复。');Object.assign(r,reply,{time:s.now});event(s,o,'LogisticsAgent','物业回复已记录：'+reply.status);return o;}
export function canSettle(s,o){return o.status==='received'&&o.held&&!!o.delivered&&!!o.buyerAccepted&&!o.issue;}
export function advanceOrder(s,id,action,payload={}){const o=s.orders.find(x=>x.id===id);if(!o)throw Error('订单不存在。');if(action==='book'){if(o.status!=='pending'||o.providerAccepted)throw Error('当前状态不能重复确认。');if(o.requests.some(r=>r.status==='pending'||r.status==='rejected'))throw Error('必要物业回复未齐或已拒绝。');o.providerAccepted=true;event(s,o,'LogisticsAgent','最终检查通过，承运方接受，等待取货。');}
else if(action==='pickup'){if(o.status!=='pending'||!o.providerAccepted)throw Error('取货前须完成最终检查及承运确认。');o.status='transit';event(s,o,'LogisticsAgent','承运方已取货，配送中。');}
else if(action==='deliver'){if(o.status!=='transit')throw Error('订单尚未配送。');o.status='received';o.delivered=s.now;event(s,o,'LogisticsAgent','物流送达已记录，等待买家验收。');}
else if(action==='confirm'){if(o.status!=='received'||o.issue)throw Error('当前不能确认收货。');o.buyerAccepted=s.now;event(s,o,'Buyer','买家验收通过，交易完成。');completeSettlement(s,o);}
else if(action==='issue'){if(o.status!=='received')throw Error('当前不能报告交付问题。');if(!payload.text?.trim()||!payload.evidence?.trim())throw Error('问题和证据说明都需要填写。');o.issue={...payload,created:s.now};event(s,o,'SupervisionAgent','交付问题已记录，等待处理。');}
else if(action==='resolve'){if(!o.issue)throw Error('没有待处理问题。');o.issue=null;event(s,o,'SupervisionAgent','问题已处理，等待买家验收。');}
else if(action==='settle'){if(o.status==='settled')return o;if(!canSettle(s,o))throw Error('结算条件未全部满足。');completeSettlement(s,o);}
else throw Error('未知操作。');return o;}
export function autoSettle(s,{orderId}={}){let count=0;for(const o of s.orders){if((!orderId||o.id===orderId)&&canSettle(s,o)){event(s,o,'PaymentAgent','结算条件已满足，系统自动发起结算。');advanceOrder(s,o.id,'settle');count++;}}return count;}
export function tick(s,days){s.now+=days*86400000;log(s,'DemoClock','演示时钟推进 '+days+' 天');autoSettle(s);}
export function decidePolicy(s,id,reason){const ex=s.exceptions.find(e=>e.id===id);if(!ex||ex.status!=='open')throw Error('该案件已处理。');if(!reason.trim())throw Error('请输入处理理由。');const old=s.policies.find(p=>p.id==='P-EXTRA'&&p.active);if(old)old.active=false;const p={id:'P-EXTRA',name:'配送额外成本处理',version:old?old.version+1:1,rule:policyUpdates['P-EXTRA'],active:true,created:s.now,source:ex.id,reason};s.policies.push(p);ex.status='resolved';ex.reason=reason;ex.decided=s.now;log(s,'SupervisionAgent','政策 '+p.id+' v'+p.version+' 自动生效。',ex.id);return p;}
export function metrics(s,start,end){const list=s.orders.filter(o=>day(o.created)>=start&&day(o.created)<=end);return {list,count:list.length,sales:round(list.reduce((a,o)=>a+o.item.price,0)),income:round(s.orders.filter(o=>o.settledAt&&day(o.settledAt)>=start&&day(o.settledAt)<=end).reduce((a,o)=>a+round(o.item.price*.02)+round(o.deliveryFee*.1),0)),held:round(list.filter(o=>o.held).reduce((a,o)=>a+o.total,0))};}
