export const DAY = 86400000;
export const categories = ['沙发', '床', '其他'];
const statuses = {
  pending: '待取货',
  transit: '配送中',
  received: '已收货',
  confirmed: '待结算',
  settled: '已结算'
};
export const money = n => new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD'
}).format(Number(n) || 0);
export const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const uid = p => p + '-' + crypto.randomUUID().slice(0, 8).toUpperCase();
export const date = t => new Date(t).toLocaleString('zh-CN', {
  timeZone: 'Australia/Sydney',
  hour12: false
});
export const day = t => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Sydney',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date(t));
export function businessDaysBetween(start, end) {
  let count = 0;
  for (let t = start + DAY; t <= end; t += DAY) {
    const w = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Australia/Sydney',
      weekday: 'short'
    }).format(t);
    if (w !== 'Sat' && w !== 'Sun') count++;
  }
  return count;
}
export function addBusinessDays(start, count) {
  let t = start;
  while (count > 0) {
    t += DAY;
    const w = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Australia/Sydney',
      weekday: 'short'
    }).format(t);
    if (w !== 'Sat' && w !== 'Sun') count--;
  }
  return t;
}
export const providers = [{
  id: 'economy',
  name: 'Sydney Green Movers',
  price: 75,
  days: 5,
  eta: '3–5 个工作日',
  label: '经济配送'
}, {
  id: 'express',
  name: 'Swift Home Delivery',
  price: 110,
  days: 2,
  eta: '1–2 个工作日',
  label: '优先配送'
}];
const BASE_POLICIES = [{
  id: 'P-QUOTE',
  name: '报价有效期',
  rule: '演示报价 15 分钟有效。家具不可售、价格变化或过期时重新报价；同一报价只完成一次付款。'
}, {
  id: 'P-PAYMENT',
  name: '演示付款与标识',
  rule: 'Visa/Mastercard 或 BPAY 输入后直接模拟通过，不做后台支付验证，不保存付款表单值。BPAY 代码及参考号为演示生成。'
}, {
  id: 'P-WINDOW',
  name: '买家验收',
  rule: '送达后由买家验收；买家确认前保持已收货，未解决问题阻止结算。'
}, {
  id: 'P-ESCALATE',
  name: '升级与政策更新',
  rule: '证据核对后仍存在不兼容 Agent 结论且无适用政策，才升级经营者。受约束处理方向通过保护检查后自动形成新版本，不追溯改变交易。'
}, {
  id: 'P-MARKET',
  name: '定价证据不足',
  rule: '市场比较不足或接口失败时不生成有效建议；本演示保守阻止完成价格审核，恢复比较证据后再由卖家确认。'
}];
export function initialState() {
  const now = Date.parse('2026-10-21T10:00:00+11:00');
  const defs = [['周末时光 · 亚麻沙发', '沙发', 380, 185, 82, 78, 'sofa', ['绿色', '布艺', '扶手', '双人'], 'Newtown'], ['暖阳 · 双人沙发', '沙发', 460, 170, 80, 76, 'sofa', ['绿色', '布艺', '扶手', '双人'], 'Glebe'], ['拾光 · 三人沙发', '沙发', 520, 210, 88, 82, 'sofa', ['绿色', '布艺', '扶手', '三人'], 'Redfern'], ['静夜 · 双人床', '床', 320, 150, 200, 95, 'bed', ['木质', '双人', '白色'], 'Camperdown'], ['好梦 · 大床', '床', 490, 180, 210, 100, 'bed', ['木质', '双人', '白色'], 'Ultimo'], ['阅读时光 · 单椅', '其他', 160, 72, 75, 80, 'chair', ['扶手', '布艺', '单人'], 'Surry Hills'], ['日常 · 实木书桌', '其他', 240, 120, 65, 75, 'table', ['木质', '收纳'], 'Glebe']];
  const items = defs.map((d, i) => ({
    id: 'F-' + (101 + i),
    name: d[0],
    category: d[1],
    price: d[2],
    width: d[3],
    depth: d[4],
    height: d[5],
    image: '/images/' + d[6] + '.jpg',
    tags: d[7],
    suburb: d[8],
    material: i < 3 ? '亚麻混纺' : i < 5 ? '木质' : '木质 / 织物',
    condition: i % 2 ? '良好' : '优秀',
    age: 2 + i % 3,
    status: 'published',
    contact: 'seller@example.test',
    pickup: '18 Demo Street, ' + d[8],
    access: '底层，门宽 100 cm，装卸区可用',
    moveout: '2026-10-30',
    ownership: true,
    risk: 'none',
    screenReason: '预置样例：资料齐全，无已声明风险。非安全认证。',
    suggestion: d[2],
    evidence: '模拟市场成交数据',
    created: now - 15 * DAY
  }));
  const orders = Object.keys(statuses).map((status, i) => {
    const item = {
      ...items[i % items.length],
      id: 'HIST-' + i,
      name: items[i % items.length].name + ' · 样例 ' + (i + 1)
    };
    const created = now - (i + 1) * DAY;
    return {
      id: 'ORD-DEMO-' + (i + 1),
      item,
      created,
      total: round(item.price + 75),
      deliveryFee: 75,
      provider: 'Sydney Green Movers',
      address: '25 Demo Road, Glebe NSW',
      status,
      held: !['settled'].includes(status),
      paymentKey: 'PAY-DEMO-' + i,
      receipt: 'R-DEMO-' + i,
      providerAccepted: !['pending'].includes(status),
      requests: status === 'pending' ? [{
        token: 'property-demo-' + i,
        end: 'delivery',
        address: '25 Demo Road, Glebe NSW',
        email: 'strata@example.test',
        status: 'pending'
      }] : [],
      delivered: ['received', 'confirmed', 'settled'].includes(status) ? now - DAY : null,
      windowEnd: ['confirmed', 'settled'].includes(status) ? now - 3600000 : now + 6 * DAY,
      issue: false ? {
        text: '送达时发现扶手损伤',
        evidence: '样例：送达照片与上架描述不一致',
        created: now
      } : null,
      settledAt: status === 'settled' ? now - DAY : null,
      payoutKey: status === 'settled' ? 'OUT-DEMO-' + i : null,
      events: [{
        time: created,
        agent: 'PaymentAgent',
        text: '模拟支付成功并留置；预置状态：' + statuses[status]
      }]
    };
  });
  orders.push({
    ...orders[4],
    id: 'ORD-PRIOR',
    created: now - 12 * DAY,
    settledAt: now - 10 * DAY,
    item: {
      ...items[0],
      id: 'HIST-PRIOR'
    },
    total: 455,
    paymentKey: 'PAY-PRIOR',
    payoutKey: 'OUT-PRIOR',
    receipt: 'R-PRIOR'
  });
  return {
    version: 1,
    now,
    items,
    orders,
    quotes: [],
    audit: [],
    profile: {
      category: '沙发',
      budget: 600,
      width: 220,
      depth: 100,
      height: 110,
      door: 90,
      condition: '良好',
      preferences: '绿色，有扶手，双人'
    },
    policies: [...BASE_POLICIES.map(p => ({
      ...p,
      created: now - 20 * DAY,
      active: true,
      version: 1
    })), {
      id: 'P-FEE',
      name: '费用与固定报价',
      version: 1,
      rule: '卖家商品服务费 2%；物流方服务费 10%；买家仅支付商品与固定配送报价。',
      active: true,
      created: now - 20 * DAY
    }, {
      id: 'P-PAYOUT',
      name: '结算保护',
      version: 1,
      rule: '支付已留置、配送完成、买家验收通过、无未解决问题才可结算；重试复用标识。',
      active: true,
      created: now - 20 * DAY
    }, {
      id: 'P-ACCESS',
      name: '通行与配送',
      version: 1,
      rule: '订单创建后为待取货。必要物业回复、最终通行检查、承运接受齐全才可取货。条件不满足时保留待取货并处理异常。',
      active: true,
      created: now - 20 * DAY
    }, {
      id: 'P-MATCH',
      name: '推荐排序',
      version: 1,
      rule: '硬约束：类别、预算、空间尺寸、最低成色。文本偏好权重 60%，预算适配 20%，成色 20%；无解析偏好则重新归一化。最多 3 件。',
      active: true,
      created: now - 20 * DAY
    }, {
      id: 'P-SCREEN',
      name: '家具资料与筛查',
      version: 1,
      rule: '照片、家具与取货信息齐全，所有权声明必填；电气、结构、卫生风险拒绝；证据不足要求补充。',
      active: true,
      created: now - 20 * DAY
    }],
    exceptions: [{
      id: 'EX-001',
      orderId: 'ORD-DEMO-1',
      status: 'open',
      title: '配送条件与固定报价冲突',
      a: 'LogisticsAgent：原方案受限；替代方案增加 $25。',
      b: 'PricingAgent：买家已接受的固定总价不可增加。',
      evidence: '模拟物业限制记录 + 替代承运报价',
      gap: '现有政策未明确额外成本由谁承担。',
      created: now
    }],
    lastNotice: ''
  };
}
export function parsePreferences(text) {
  const pairs = [['绿色', ['绿', 'green']], ['木质', ['木', 'wood', 'oak']], ['布艺', ['布', 'linen', 'fabric']], ['扶手', ['扶手', 'armrest']], ['双人', ['双人', 'two', '2人']], ['三人', ['三人', 'three', '3人']], ['收纳', ['收纳', 'storage']], ['白色', ['白', 'white']]];
  return pairs.filter(([, keys]) => keys.some(k => text.toLowerCase().includes(k))).map(([tag]) => tag);
}
export function recommend(items, p) {
  const tags = parsePreferences(p.preferences || '');
  const grade = {
    '一般': 1,
    '良好': 2,
    '优秀': 3
  };
  return items.filter(i => i.status === 'published' && i.category === p.category && i.price <= p.budget && i.width <= p.width && i.depth <= p.depth && i.height <= p.height && grade[i.condition] >= grade[p.condition]).map(i => {
    const matched = tags.filter(t => i.tags.includes(t));
    const score = Math.round(tags.length ? 60 * matched.length / tags.length + 20 * (1 - i.price / p.budget) + 20 * grade[i.condition] / 3 : 50 * (1 - i.price / p.budget) + 50 * grade[i.condition] / 3);
    return {
      ...i,
      score,
      matched,
      requestedTags: tags,
      doorFit: Math.min(i.depth, i.height) <= p.door
    };
  }).sort((a, b) => b.score - a.score || a.price - b.price).slice(0, 3);
}
export function log(s, agent, text, object = '') {
  s.audit.push({
    id: uid('EV'),
    time: s.now,
    agent,
    text,
    object
  });
}
export function createQuote(s, itemId, delivery) {
  const item = s.items.find(i => i.id === itemId);
  if (!item || item.status !== 'published') throw Error('该家具已不可售。');
  const positive = v => ['string','number'].includes(typeof v) && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
  if (!delivery.address?.trim() || !positive(delivery.door) || !positive(delivery.doorHeight) || String(delivery.floor ?? '').trim() === '' || !Number.isInteger(Number(delivery.floor)) || Number(delivery.floor) < 0 || !['ground','lift','stairs'].includes(delivery.access) || ![2,3].includes(Number(delivery.movers)) || typeof delivery.pickupProperty !== 'boolean' || typeof delivery.deliveryProperty !== 'boolean') throw Error('请完整填写送货信息，并检查门宽、门高、楼层和搬运人数。');
  if (!delivery.pickupAccess || !delivery.loading) throw Error('请确认取货通行条件和送货装卸区可用。');
  // Same basic doorway check for ground floor, lift and stairs; no stair-specific assessment.
  const a = Math.min(item.depth, item.height), b = Math.max(item.depth, item.height);
  if (Number(delivery.door) < a || Number(delivery.doorHeight) < b) throw Error('门宽或门高不足，请调整配送方案。');
  for (const end of ['pickup', 'delivery']) if (delivery[end + 'Property'] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery[end + 'Email'] || '')) throw Error('需要物业确认时，请填写该端物业邮箱。');
  const p = providers.find(x => x.id === delivery.provider);
  if (!p) throw Error('请选择配送商。');
  const q = {
    id: uid('Q'),
    itemId,
    itemPrice: item.price,
    deliveryFee: p.price,
    total: round(item.price + p.price),
    provider: p.name,
    expected: day(addBusinessDays(s.now, p.days)),
    delivery: {
      ...delivery
    },
    created: s.now,
    expires: s.now + 15 * 60000,
    paymentKey: uid('PAY'),
    biller: '009921',
    reference: String(Math.floor(1000000000 + Math.random() * 8999999999)),
    consumed: false
  };
  s.quotes.push(q);
  log(s, 'LogisticsAgent', '初步通行检查完成，创建固定报价 ' + money(q.total), q.id);
  return q;
}
