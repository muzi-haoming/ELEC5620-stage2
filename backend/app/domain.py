"""Server-authoritative rules. Money is rounded as integer cents at ledger boundaries."""
from copy import deepcopy
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import math
import re
import secrets
from zoneinfo import ZoneInfo
from .delivery_pricing import delivery_price

DAY = 86400000
SYDNEY = ZoneInfo('Australia/Sydney')
PROVIDERS = {
    'economy': ('Sydney Green Movers', 75, 5),
    'express': ('Swift Home Delivery', 110, 2),
}
TAGS = {'绿色': ['绿', 'green'], '木质': ['木', 'wood', 'oak'],
        '布艺': ['布', 'linen', 'fabric'], '扶手': ['扶手', 'armrest'],
        '双人': ['双人', 'two', '2人'], '三人': ['三人', 'three', '3人'],
        '收纳': ['收纳', 'storage'], '白色': ['白', 'white']}
GRADES = {'一般': 1, '良好': 2, '优秀': 3}


class BusinessError(ValueError):
    pass


def uid(prefix):
    return f'{prefix}-{secrets.token_hex(12).upper()}'


def cents(value):
    return int((Decimal(str(value)) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def money(value):
    return f'${value:,.2f}'


def day(value):
    return datetime.fromtimestamp(value / 1000, SYDNEY).date().isoformat()


def business_date(now, count):
    date = datetime.fromtimestamp(now / 1000, SYDNEY)
    while count:
        date += timedelta(days=1)
        if date.weekday() < 5:
            count -= 1
    return date.date().isoformat()


def number(value):
    if isinstance(value, bool) or value is None or str(value).strip() == '':
        return float('nan')
    try:
        return float(value)
    except (ValueError, TypeError):
        return float('nan')


def tags(text):
    return [tag for tag, keys in TAGS.items() if any(k in str(text).lower() for k in keys)]


def audit(s, agent, text, object_id=''):
    s['audit'].append(dict(id=uid('EV'), time=s['now'], agent=agent, text=text, object=object_id))


def event_snapshot(order):
    return dict(status=order.get('status'), providerAccepted=bool(order.get('providerAccepted')),
                held=bool(order.get('held')), buyerAccepted=bool(order.get('buyerAccepted')),
                delivered=bool(order.get('delivered')), issue=bool(order.get('issue')),
                property={r['end']: r['status'] for r in order.get('requests', [])})


def event(s, order, agent, text, *, action=None, checks=None, before=None):
    row = dict(time=s['now'], agent=agent, text=text)
    if action and before is not None:
        after = event_snapshot(order)
        row['facts'] = dict(action=action, checks=[dict(label=c, result='passed') for c in (checks or [])],
                            changes=[dict(field=k, before=before.get(k), after=v)
                                     for k, v in after.items() if before.get(k) != v])
    order['events'].append(row)
    audit(s, agent, text, order['id'])


def find(rows, key):
    result = next((x for x in rows if x['id'] == key), None)
    if result is None:
        raise BusinessError('记录不存在。')
    return result


def validate_listing(f, now):
    errors = {}
    for k, lo, hi in [('name', 2, 80), ('material', 2, 80), ('pickup', 5, 250), ('access', 5, 500)]:
        v = f.get(k)
        if not isinstance(v, str) or not lo <= len(v.strip()) <= hi:
            errors[k] = f'请填写有效内容（{lo}–{hi} 字符）'
    if f.get('category') not in ['沙发', '床', '其他']:
        errors['category'] = '请选择家具类型'
    if f.get('condition') not in GRADES:
        errors['condition'] = '请选择成色'
    for k, lo, hi in [('width', 1, 1000), ('depth', 1, 1000), ('height', 1, 1000), ('age', 0, 100), ('price', .01, 100000)]:
        if not lo <= number(f.get(k)) <= hi:
            errors[k] = f'请输入 {lo}–{hi} 范围内的数值'
    if math.isfinite(number(f.get('price'))) and abs(number(f['price']) * 100 - round(number(f['price']) * 100)) > .00001:
        errors['price'] = '售价最多保留两位小数'
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', str(f.get('contact', ''))):
        errors['contact'] = '请输入有效邮箱'
    try:
        if datetime.strptime(f['moveout'], '%Y-%m-%d').date().isoformat() != f['moveout'] or f['moveout'] < day(now):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        errors['moveout'] = '可取货日期不能早于当前日期'
    if f.get('ownership') is not True:
        errors['ownership'] = '请确认所有权声明'
    photos = f.get('photos') or {}
    for k, label in [('front', '正面'), ('top', '俯视'), ('side', '侧面')]:
        if not (photos.get(k) or {}).get('ref'):
            errors[k] = f'请上传{label}照片'
    if len(photos.get('details', [])) > 2:
        errors['details'] = '其他细节最多 2 张'
    if f.get('risk') not in ['none', '结构', '电气', '卫生']:
        errors['risk'] = '请选择风险情况'
    elif f['risk'] != 'none':
        errors['risk'] = f['risk'] + '风险：' + (f.get('evidence') or '请补充风险说明')
    if not isinstance(f.get('evidence'), str) or len(f.get('evidence', '')) > 1000:
        errors['evidence'] = '说明不能超过 1000 字符'
    return errors


def save_listing(s, f, listing_id=None, assessment=None):
    previous = find(s['items'], listing_id) if listing_id else None
    if previous and previous['status'] != 'rejected':
        raise BusinessError('仅拒绝上架的家具可以重新提交。')
    errors = validate_listing(f, s['now'])
    errors.update((assessment or {}).get('errors', {}))
    allowed = ['name', 'category', 'material', 'condition', 'age', 'width', 'depth', 'height', 'price', 'contact', 'pickup', 'access', 'moveout', 'ownership', 'risk', 'evidence', 'photos']
    value = {k: deepcopy(f.get(k)) for k in allowed}
    for k in ['age', 'width', 'depth', 'height', 'price']:
        n = number(f.get(k))
        value[k] = n if math.isfinite(n) else 0
    value.update(id=listing_id or uid('F'), name=str(f.get('name') or '未命名家具').strip(),
                 status='rejected' if errors else 'published', errors=errors,
                 image=((f.get('photos') or {}).get('front') or {}).get('ref', '/images/sofa.jpg'),
                 created=previous['created'] if previous else s['now'], updated=s['now'],
                 tags=tags(' '.join(str(f.get(k) or '') for k in ['name', 'material', 'evidence'])),
                 suburb=f.get('pickup'), screenReason='；'.join(errors.values()) if errors else '资料审核通过',
                 history=[*(previous or {}).get('history', []), {'time': s['now'], 'errors': errors}],
                 assessment=assessment or {})
    if previous:
        previous.update(value)
    else:
        s['items'].insert(0, value)
    audit(s, 'ListingAgent', '拒绝上架：' + value['screenReason'] if errors else '资料及售价通过审核，家具已上架。', value['id'])
    return value


def recommend(s, p, parsed_tags=None):
    if p.get('category') not in ['沙发', '床', '其他'] or p.get('condition') not in GRADES or any(not 0 < number(p.get(k)) < 1e9 for k in ['budget', 'width', 'depth', 'height', 'door']):
        raise BusinessError('请填写有效需求。')
    selected = tags(p.get('preferences', '')) if parsed_tags is None else parsed_tags
    result = []
    for i in s['items']:
        if i['status'] != 'published' or i['category'] != p['category'] or i['price'] > number(p['budget']) or any(i[k] > number(p[k]) for k in ['width', 'depth', 'height']) or GRADES[i['condition']] < GRADES[p['condition']]:
            continue
        matched = [t for t in selected if t in i['tags']]
        grade = GRADES[i['condition']]
        score = (60 * len(matched) / len(selected) + 20 * (1 - i['price'] / number(p['budget'])) + 20 * grade / 3) if selected else (50 * (1 - i['price'] / number(p['budget'])) + 50 * grade / 3)
        result.append({**i, 'score': math.floor(score + .5), 'matched': matched, 'requestedTags': selected, 'doorFit': min(i['depth'], i['height']) <= number(p['door'])})
    return sorted(result, key=lambda i: (-i['score'], i['price']))[:3]


def create_quote(s, item_id, d):
    i = find(s['items'], item_id)
    if i['status'] != 'published':
        raise BusinessError('该家具已不可售。')
    if not str(d.get('address') or '').strip() or not number(d.get('door')) > 0 or not number(d.get('doorHeight')) > 0 or not number(d.get('floor')).is_integer() or number(d['floor']) < 0 or d.get('access') not in ['ground', 'lift', 'stairs'] or number(d.get('movers')) not in [2, 3] or any(type(d.get(k + 'Property')) is not bool for k in ['pickup', 'delivery']):
        raise BusinessError('请完整填写送货信息，并检查门宽、门高、楼层和搬运人数。')
    if d.get('pickupAccess') is not True or d.get('loading') is not True:
        raise BusinessError('请确认取货通行条件和送货装卸区可用。')
    if number(d['door']) < min(i['depth'], i['height']) or number(d['doorHeight']) < max(i['depth'], i['height']):
        raise BusinessError('门宽或门高不足，请调整配送方案。')
    for end in ['pickup', 'delivery']:
        if d[end + 'Property'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', str(d.get(end + 'Email', ''))):
            raise BusinessError('需要物业确认时，请填写该端物业邮箱。')
    if d.get('provider') not in PROVIDERS:
        raise BusinessError('请选择配送商。')
    provider, _, days = PROVIDERS[d['provider']]
    delivery_pricing=delivery_price(i['pickup'],d['address'],d['provider'])
    fee=delivery_pricing['price']
    q = dict(id=uid('Q'), itemId=item_id, itemPrice=i['price'], deliveryFee=fee,
             total=(cents(i['price']) + cents(fee)) / 100, provider=provider, deliveryPricing=delivery_pricing,
             expected=business_date(s['now'], days), delivery=deepcopy(d), created=s['now'],
             expires=s['now'] + 900000, paymentKey=uid('PAY'), biller='009921',
             reference=str(secrets.randbelow(9000000000) + 1000000000), consumed=False)
    s['quotes'].append(q)
    audit(s, 'LogisticsAgent', '初步通行检查完成，创建固定报价 ' + money(q['total']), q['id'])
    return q


def purchase(s, quote_id, method):
    if method not in ['Visa / Mastercard', 'BPAY']:
        raise BusinessError('请选择付款方式。')
    q = find(s['quotes'], quote_id)
    if q['consumed']:
        return next(o for o in s['orders'] if o.get('quoteId') == quote_id)
    if q['expires'] <= s['now']:
        raise BusinessError('报价已过期，请重新确认配送方案。')
    i = find(s['items'], q['itemId'])
    if i['status'] != 'published' or i['price'] != q['itemPrice']:
        raise BusinessError('家具状态或价格变化，请重新获取报价。')
    d = q['delivery']
    requests = [dict(token=uid('PROP'), end=end, address=i['pickup'] if end == 'pickup' else d['address'], email=d[end + 'Email'], status='pending') for end in ['pickup', 'delivery'] if d[end + 'Property']]
    order = dict(id=uid('ORD'), quoteId=q['id'], item=deepcopy(i), total=q['total'], deliveryFee=q['deliveryFee'], provider=q['provider'], expected=q['expected'], address=d['address'], access=deepcopy(d), created=s['now'], status='pending', held=True, providerAccepted=False, paymentKey=q['paymentKey'], receipt=uid('R'), method=method, requests=requests, events=[], issue=None, buyerAccepted=None)
    q['consumed'] = True
    i['status'] = 'sold'
    s['orders'].insert(0, order)
    event(s, order, 'PaymentAgent', '付款完成，订单已创建，等待取货。', action='purchase', before={}, checks=['付款方式为 Visa/Mastercard 或 BPAY', '报价未使用且未过期', '家具可售且价格与报价一致'])
    return order


def property_reply(s, token, reply):
    for o in s['orders']:
        r = next((r for r in o['requests'] if r['token'] == token), None)
        if r:
            if r['status'] != 'pending':
                raise BusinessError('申请已回复或不存在。')
            if not str(reply.get('name') or '').strip() or reply.get('status') not in ['approved', 'conditional', 'rejected'] or (reply['status'] != 'approved' and not str(reply.get('reason') or '').strip()):
                raise BusinessError('请填写姓名和必要的条件 / 拒绝原因。')
            before = event_snapshot(o)
            r.update({k: reply.get(k, '') for k in ['name', 'status', 'reason', 'timeWindow', 'lift', 'loading']}, replyVersion=2, time=s['now'])
            event(s, o, 'LogisticsAgent', '物业回复已记录：' + reply['status'], action='property', before=before, checks=['物业申请存在且尚未回复', '回复姓名、状态及必要原因已填写'])
            return o
    raise BusinessError('申请已回复或不存在。')


def advance(s, order_id, action, payload=None):
    o = find(s['orders'], order_id)
    before = event_snapshot(o)
    payload = payload or {}
    if action == 'book':
        if o['status'] != 'pending' or o['providerAccepted']:
            raise BusinessError('当前状态不能重复确认。')
        if any(r['status'] in ['pending', 'rejected'] for r in o['requests']):
            raise BusinessError('必要物业回复未齐或已拒绝。')
        o['providerAccepted'] = True
        event(s, o, 'LogisticsAgent', '最终检查通过，承运方接受，等待取货。', action='book', before=before, checks=['订单待取货且承运方尚未接受', '必要物业申请无待回复或拒绝'])
    elif action == 'pickup':
        if o['status'] != 'pending' or not o['providerAccepted']:
            raise BusinessError('取货前须完成最终检查及承运确认。')
        o['status'] = 'transit'
        event(s, o, 'LogisticsAgent', '承运方已取货，配送中。', action='pickup', before=before, checks=['订单待取货', '承运方已接受'])
    elif action == 'deliver':
        if o['status'] != 'transit':
            raise BusinessError('订单尚未配送。')
        o.update(status='received', delivered=s['now'])
        event(s, o, 'LogisticsAgent', '物流送达已记录，等待买家验收。', action='deliver', before=before, checks=['订单正在配送'])
    elif action == 'confirm':
        if o['status'] == 'settled':
            return o
        if o['status'] != 'received' or o.get('issue') or not o.get('delivered') or not o.get('held'):
            raise BusinessError('当前不能确认收货。')
        o['buyerAccepted'] = s['now']
        event(s, o, 'Buyer', '买家验收通过，交易完成。', action='confirm', before=before, checks=['订单已收货且有送达记录', '没有未解决的交付问题', '资金仍处于留置状态'])
        before = event_snapshot(o)
        o.update(status='settled', held=False, payoutKey=o.get('payoutKey') or uid('OUT'), settledAt=s['now'])
        event(s, o, 'PaymentAgent', '结算完成。卖家 ' + money((cents(o['item']['price']) - cents(Decimal(str(o['item']['price'])) * Decimal('.02'))) / 100) + '；物流方 ' + money((cents(o['deliveryFee']) - cents(Decimal(str(o['deliveryFee'])) * Decimal('.1'))) / 100), action='settle', before=before, checks=['同一请求中的买家验收条件已通过'])
    elif action == 'issue':
        if o['status'] != 'received' or not payload.get('text', '').strip() or not payload.get('evidence', '').strip():
            raise BusinessError('问题和证据说明都需要填写。')
        o['issue'] = dict(text=payload['text'], evidence=payload['evidence'], created=s['now'])
        event(s, o, 'SupervisionAgent', '交付问题已记录，等待处理。', action='issue', before=before, checks=['订单已收货', '问题描述和证据说明非空'])
    elif action == 'resolve':
        if not o.get('issue'):
            raise BusinessError('没有待处理问题。')
        o['issue'] = None
        event(s, o, 'SupervisionAgent', '问题已处理，等待买家验收。', action='resolve', before=before, checks=['订单存在待处理问题'])
    else:
        raise BusinessError('未知操作。')
    return o


def policy_decision(s, case_id, reason):
    ex = find(s['exceptions'], case_id)
    if ex['status'] != 'open' or not reason.strip():
        raise BusinessError('该案件已处理或处理理由为空。')
    old = next((p for p in s['policies'] if p['id'] == 'P-EXTRA' and p['active']), None)
    if old:
        old['active'] = False
    p = dict(id='P-EXTRA', name='配送额外成本处理', version=old['version'] + 1 if old else 1,
             rule='先请求不提高买家固定总价的可行替代方案；无可行方案时保留待取货并升级处理，不启动退款，不绕过验收和结算。',
             active=True, created=s['now'], source=case_id, reason=reason)
    s['policies'].append(p)
    ex.update(status='resolved', reason=reason, decided=s['now'])
    audit(s, 'SupervisionAgent', f"政策 {p['id']} v{p['version']} 自动生效。", case_id)
    return p
