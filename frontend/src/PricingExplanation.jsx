import React from 'react';
import {useLanguage} from './Language';
import {money} from './domain-v2.mjs';
export function PricingExplanation({estimate:e}){
 const t=useLanguage(),d=e.diagnostics,c=e.calculation;
 const fields={width:'宽度 cm',height:'高度 cm'};
 const reasons={type:'商品类型或套装不符',subtype:'家具细分类别不符',material:'已知材质不符',dimensions:'已知尺寸差异过大',low_similarity:'相似度不足',invalid_price:'价格或币种不可用'};
 return <div data-testid="pricing-explanation">
 {Object.entries(e.warnings||{}).map(([k,v])=><p key={k}>{t('请核对')} · {t(fields[k]||k)}：{t(v)}</p>)}
 {e.sampleLimited&&<p className="notice">{t('参考样本较少（仅 1–2 件），估价可靠性有限，请结合来源和商品差异决定售价。')}</p>}
 {d&&<><p>{t('本次外部查询')}：{t('取得商品')} {d.fetched} · {t('用于估价')} {d.matched}</p>
 {Object.entries(d.excluded||{}).map(([k,n])=><small key={k} style={{display:'block'}}>{t(reasons[k]||k)}：{n}</small>)}
 {d.failedSources>0&&<p>{t('部分外部页面暂时不可用，本次查询覆盖不完整。')}</p>}
 <small>{t('查询关键词')}：{e.query}</small></>}
 {c&&<><h4>{t('为什么是这个价格')}</h4>
 <p>{t('先根据类型、材质、成色、年限和尺寸匹配商品；只对来源明确披露的成色和年限折算价格，再取相似度加权中位数。')}</p>
 <p>{t('最终采用的参考挂牌价')} {money(c.marketPrice)} × {t('综合折算系数')} {c.factor} = <b>{money(c.result)}</b></p>
 <p>{t('成色系数')} {c.conditionFactor} · {t('年限系数')} {c.ageFactor}</p>
 <small>{t('成色按一般 0.65、良好 0.85、优秀 1.00 比较；年限每年折减 6%，最低保留 35%；综合折算限制在 0.7–1.3。来源未披露的参数不臆测、不折算。')}</small>
 <p>{t('可比商品调整后区间')}：{money(e.range[0])}–{money(e.range[1])}</p>
 <small>{t('最终采用的来源')}：<a href={e.evidence.find(r=>r.id===c.sourceId)?.url} target="_blank" rel="noopener noreferrer">{e.evidence.find(r=>r.id===c.sourceId)?.title}</a></small>
 </>}
 </div>;
}
