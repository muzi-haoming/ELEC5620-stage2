import { useLanguage, translate as _tr } from "./Language";
import { LanguageProvider, LanguageSwitch } from './Language';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Store, useStore } from './store';
import { Shell, Modal, Button, Head, Panel, Demo, Empty } from './ui';
import { Listings, Submit, ListingDetail } from './Seller';
import { Discover, Item, Delivery, Checkout, Orders, OrderDetail } from './Buyer';
import { Overview, Exceptions, Policies, Property } from './Manager';
import './styles.css';
import './themes.css';
function Home() {
  const _tr = useLanguage();
  const {
    s
  } = useStore();
  const [property, setProperty] = useState(false);
  const requests = s.orders.flatMap(o => o.requests.map(r => ({
    ...r,
    order: o.id
  })));
  return <div className="landing"><header className="landing-header"><Link to="/" className="brand"><span className="chair-mark">▰</span>second space</Link><Link to="/manager/overview" className="admin-link">{_tr("Admin \xB7 \u7ECF\u8425\u8005 \u2197")}</Link></header><section className="welcome"><p>{_tr("\u55E8\uFF0C\u6B22\u8FCE\u6765\u5230 second space")}</p><h1>{_tr("\u8BA9\u597D\u5BB6\u5177\uFF0C")}<span>{_tr("\u9047\u89C1\u65B0\u4E3B\u4EBA")}</span></h1><h2>{_tr("\u4ECA\u5929\uFF0C\u4F60\u60F3\u4E70\u5BB6\u5177\uFF0C\u8FD8\u662F\u5356\u5BB6\u5177\uFF1F")}</h2></section><div className="entry-cards"><article><img src="/images/chair.jpg" alt={_tr("舒适的休闲椅")} /><div><h2>{_tr("\u6211\u662F\u4E70\u5BB6")}</h2><p>{_tr("\u53D1\u73B0\u5FC3\u4EEA\u597D\u7269\uFF0C\u5E03\u7F6E\u7406\u60F3\u7A7A\u95F4")}</p><Link className="button yellow" to="/buyer/discover">{_tr("\u53BB\u6DD8\u5BB6\u5177")}<span>→</span></Link></div></article><article><img src="/images/sofa.jpg" alt={_tr("等待新主人的绿色沙发")} /><div><h2>{_tr("\u6211\u662F\u5356\u5BB6")}</h2><p>{_tr("\u8BA9\u95F2\u7F6E\u5BB6\u5177\uFF0C\u5F00\u542F\u4E0B\u4E00\u6BB5\u6545\u4E8B")}</p><Link className="button entry-outline" to="/seller/listings">{_tr("\u53D1\u5E03\u95F2\u7F6E")}<span>→</span></Link></div></article></div><div className="landing-bottom"><span>{_tr("\u65E7 \u7269 \u65B0 \u751F \uFF0C \u7A7A \u95F4 \u7115 \u65B0")}</span><button className="text-button" onClick={() => setProperty(true)}>{_tr("Building Manager \xB7 \u7269\u4E1A\u6A21\u62DF\u5165\u53E3 \u2197")}</button></div><Demo />{_tr(property && <Modal title={_tr("选择物业通行申请")} onClose={() => setProperty(false)}>{_tr(requests.length ? requests.map(r => <Link className="request-link" key={r.token} to={'/property-confirm/' + r.token}><b>{_tr(r.order)} · {_tr(r.end === 'pickup' ? '取货' : '送货')}</b><span>{_tr(r.address)} · {_tr(r.status === 'pending' ? '待回复' : '已回复')} →</span></Link>) : <p>{_tr("\u6CA1\u6709\u7533\u8BF7\u3002\u4E70\u5BB6\u5728 B3 \u52FE\u9009\u9700\u8981\u7269\u4E1A\u786E\u8BA4\u5E76\u5B8C\u6210\u4E0B\u5355\u540E\uFF0C\u7533\u8BF7\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002")}</p>)}</Modal>)}</div>;
}
function Agreement() {
  const _tr = useLanguage();
  return <div className="public-page"><Link to="/" className="brand">second space</Link><Head eyebrow={_tr("DEMO AGREEMENT")} title={_tr("演示用户协议")} text={_tr("测试文本，不用于真实交易。")} /><Panel><ol><li>{_tr("\u672C\u5E94\u7528\u7528\u4E8E ELEC5620 \u8BFE\u7A0B\u6F14\u793A\uFF0C\u6240\u6709\u4ED8\u6B3E\u3001\u7269\u4E1A\u901A\u77E5\u548C\u914D\u9001\u5747\u4E3A\u6A21\u62DF\u3002")}</li><li>{_tr("\u4E70\u5BB6\u786E\u8BA4\u5546\u54C1\u91D1\u989D\u4E0E\u56FA\u5B9A\u914D\u9001\u8D39\u540E\u63A5\u53D7\u62A5\u4EF7\u3002\u62A5\u4EF7\u8FC7\u671F\u6216\u6761\u4EF6\u53D8\u52A8\u9700\u8981\u91CD\u65B0\u786E\u8BA4\u3002")}</li><li>{_tr("\u4ED8\u6B3E\u6F14\u793A\u5B8C\u6210\u540E\u8D44\u91D1\u88AB\u6807\u8BB0\u4E3A\u7559\u7F6E\uFF0C\u672A\u53D1\u751F\u771F\u5B9E\u6263\u6B3E\u3002")}</li><li>{_tr("\u5FC5\u8981\u7269\u4E1A\u56DE\u590D\u3001\u6700\u7EC8\u53EF\u884C\u6027\u4E0E\u627F\u8FD0\u65B9\u786E\u8BA4\u5B8C\u6210\u540E\u624D\u80FD\u5B89\u6392\u914D\u9001\u3002")}</li><li>{_tr("\u7269\u6D41\u9001\u8FBE\u540E\u53EF\u68C0\u67E5\u5BB6\u5177\u3001\u62A5\u544A\u95EE\u9898\uFF1B\u4E70\u5BB6\u786E\u8BA4\u9A8C\u6536\u540E\u4EA4\u6613\u5B8C\u6210\u3002")}</li><li>{_tr("\u672A\u89E3\u51B3\u95EE\u9898\u963B\u6B62\u7ED3\u7B97\uFF0C\u9700\u5904\u7406\u5B8C\u6210\u540E\u7531\u4E70\u5BB6\u786E\u8BA4\u9A8C\u6536\u3002")}</li><li>{_tr("\u4EC5\u4F7F\u7528\u6D4B\u8BD5\u4E2A\u4EBA\u4FE1\u606F\u4E0E\u4ED8\u6B3E\u5185\u5BB9\u3002\u4ED8\u6B3E\u8868\u5355\u5185\u5BB9\u4E0D\u4F1A\u4FDD\u5B58\u3002")}</li></ol><Link to="/">{_tr("\u8FD4\u56DE\u89D2\u8272\u5165\u53E3")}</Link></Panel></div>;
}
function Layout() {
  const _tr = useLanguage();
  const location = useLocation();
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return <Shell><Outlet /></Shell>;
}
class Boundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = {
      error: null
    };
  }
  static getDerivedStateFromError(e) {
    return {
      error: e
    };
  }
  render() {
    return this.state.error ? <div className="public-page"><h1>{_tr("\u9875\u9762\u6682\u65F6\u65E0\u6CD5\u663E\u793A")}</h1><p>{_tr("\u8BF7\u5237\u65B0\u9875\u9762\u3002\u539F\u6F14\u793A\u6570\u636E\u4FDD\u7559\u5728\u672C\u6D4F\u89C8\u5668\u4E2D\u3002")}</p><pre>{_tr(this.state.error.message)}</pre><a href="/">{_tr("\u8FD4\u56DE\u5165\u53E3")}</a></div> : this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<Boundary><LanguageProvider><LanguageSwitch /><HashRouter><Store><Routes><Route path="/" element={<Home />} /><Route path="/agreement" element={<Agreement />} /><Route path="/property-confirm/:token" element={<Property />} /><Route element={<Layout />}><Route path="/seller" element={<Navigate to="/seller/listings" replace />} /><Route path="/seller/listings" element={<Listings />} /><Route path="/seller/listings/new" element={<Submit />} /><Route path="/seller/listings/:listingId/edit" element={<Submit />} /><Route path="/seller/listings/:listingId" element={<ListingDetail />} /><Route path="/buyer" element={<Navigate to="/buyer/discover" replace />} /><Route path="/buyer/discover" element={<Discover />} /><Route path="/buyer/items/:listingId" element={<Item />} /><Route path="/buyer/items/:listingId/delivery" element={<Delivery />} /><Route path="/buyer/checkout/:quoteId" element={<Checkout />} /><Route path="/buyer/orders" element={<Orders />} /><Route path="/buyer/orders/:orderId" element={<OrderDetail />} /><Route path="/manager" element={<Navigate to="/manager/overview" replace />} /><Route path="/manager/overview" element={<Overview />} /><Route path="/manager/records/:orderId" element={<OrderDetail admin />} /><Route path="/manager/exceptions" element={<Exceptions />} /><Route path="/manager/policies" element={<Policies />} /></Route><Route path="*" element={<div className="public-page"><Empty text={_tr("页面不存在")} to="/" label={_tr("返回角色入口")} /></div>} /></Routes></Store></HashRouter></LanguageProvider></Boundary>);
