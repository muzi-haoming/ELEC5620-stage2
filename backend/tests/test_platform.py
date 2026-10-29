from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import io
import uuid
import pytest
from PIL import Image
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.types import Command
from app import database as db, domain as d, config
from app.agents import build_graph
from app.main import app

DELIVERY = dict(address='25 Demo Street, Glebe', door=100, doorHeight=210, floor=0,
                movers=2, pickupProperty=True, pickupEmail='pickup@example.test',
                deliveryProperty=True, deliveryEmail='delivery@example.test',
                loading=True, pickupAccess=True, access='stairs', provider='economy')


def call(client, op, payload=None, actor='buyer', request_id=None, token=None):
    return client.post('/api/actions', json={'operation': op, 'payload': payload or {}, 'requestId': request_id or str(uuid.uuid4())},
                       headers={'X-Demo-Role': actor, 'X-Property-Token': token or ''})


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()['result']


def order(client, item='F-101'):
    quote = ok(call(client, 'quote', {'itemId': item, 'delivery': DELIVERY}))
    return ok(call(client, 'purchase', {'quoteId': quote['id'], 'method': 'BPAY'}))


def delivered(client, o):
    for r in o['requests']:
        ok(call(client, 'property', {'token': r['token'], 'reply': {'name': 'Manager', 'status': 'approved', 'timeWindow': '10:00', 'lift': 'Booked', 'loading': 'Bay 2'}}, 'property', token=r['token']))
    for action in ['book', 'pickup', 'deliver']:
        ok(call(client, 'advance', {'orderId': o['id'], 'action': action}))


def test_full_flow_atomic_settlement_and_role_views(client):
    o = order(client)
    assert call(client, 'advance', {'orderId': o['id'], 'action': 'book'}).status_code == 409
    delivered(client, o)
    ok(call(client, 'tick', {'days': 35}))
    assert d.find(db.snapshot()['orders'], o['id'])['status'] == 'received'
    result = ok(call(client, 'advance', {'orderId': o['id'], 'action': 'confirm'}))
    assert result['status'] == 'settled' and result['held'] is False
    again = ok(call(client, 'advance', {'orderId': o['id'], 'action': 'confirm'}))
    assert result['payoutKey'] == again['payoutKey']
    assert all(e['agent'] == '系统消息' for e in result['events'])
    with db.connect() as conn:
        ledger = conn.execute('SELECT * FROM settlements WHERE order_id=%s', (o['id'],)).fetchall()
        assert len(ledger) == 1
        row = ledger[0]
        assert row['seller_cents'] == 37240 and row['carrier_cents'] == d.cents(o['deliveryFee'])-d.cents(o['deliveryFee']*.1)
        assert row['seller_cents'] + row['carrier_cents'] + row['platform_cents'] == d.cents(o['total'])
    admin = client.get('/api/state', headers={'X-Demo-Role': 'manager'}).json()
    assert any(e['agent'] == 'PaymentAgent' for e in d.find(admin['orders'], o['id'])['events'])
    buyer = client.get('/api/state').json()
    assert buyer['audit'] == [] and buyer['policies'] == []
    assert all(o['status'] != 'confirmed' for o in admin['orders'])


def test_concurrent_buyers_cannot_buy_same_item(client):
    quotes = [ok(call(client, 'quote', {'itemId': 'F-101', 'delivery': DELIVERY})) for _ in range(2)]
    def pay(q):
        return call(client, 'purchase', {'quoteId': q['id'], 'method': 'Visa / Mastercard'})
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(pay, quotes))
    assert sorted(r.status_code for r in responses) == [200, 409]
    assert len([o for o in db.snapshot()['orders'] if o['item']['id'] == 'F-101']) == 1


def test_event_evidence_matches_actions_and_shared_request(client):
    o = order(client)
    initial = len(d.find(db.snapshot()['orders'], o['id'])['events'])
    assert call(client, 'advance', {'orderId': o['id'], 'action': 'deliver'}).status_code == 409
    assert len(d.find(db.snapshot()['orders'], o['id'])['events']) == initial
    delivered(client, o)
    event = d.find(db.snapshot()['orders'], o['id'])['events'][-1]
    assert event['facts']['action'] == 'deliver'
    assert event['facts']['checks'] == [{'label': '订单正在配送', 'result': 'passed'}]
    assert {'field': 'status', 'before': 'transit', 'after': 'received'} in event['facts']['changes']
    assert event['execution']['action'] == 'deliver'
    public = ok(call(client, 'advance', {'orderId': o['id'], 'action': 'confirm'}))
    assert all('facts' not in e and 'execution' not in e for e in public['events'])
    events = d.find(db.snapshot()['orders'], o['id'])['events'][-2:]
    assert [e['facts']['action'] for e in events] == ['confirm', 'settle']
    assert events[0]['execution']['requestId'] == events[1]['execution']['requestId']
    assert {'field': 'buyerAccepted', 'before': False, 'after': True} in events[0]['facts']['changes']
    assert not any(c['field'] == 'status' for c in events[0]['facts']['changes'])
    assert {'field': 'status', 'before': 'received', 'after': 'settled'} in events[1]['facts']['changes']
    assert {'field': 'held', 'before': True, 'after': False} in events[1]['facts']['changes']


def test_idempotency_and_payment_fields(client):
    q = ok(call(client, 'quote', {'itemId': 'F-101', 'delivery': DELIVERY}))
    payload = {'quoteId': q['id'], 'method': 'BPAY'}
    key = str(uuid.uuid4())
    a = ok(call(client, 'purchase', payload, request_id=key))
    b = ok(call(client, 'purchase', payload, request_id=key))
    assert a['id'] == b['id']
    assert all(e['agent'] == '系统消息' for e in b['events'])
    assert call(client, 'purchase', {**payload, 'method': 'Visa / Mastercard'}, request_id=key).status_code == 409
    assert call(client, 'purchase', {**payload, 'cardNumber': '4242'}).status_code == 422


@pytest.mark.parametrize('access', ['ground', 'lift', 'stairs'])
def test_common_delivery_checks(client, access):
    assert call(client, 'quote', {'itemId': 'F-101', 'delivery': {**DELIVERY, 'access': access}}).status_code == 200
    for field, value in [('doorHeight', 20), ('doorHeight', ''), ('floor', -1), ('loading', False), ('deliveryEmail', '')]:
        response = call(client, 'quote', {'itemId': 'F-101', 'delivery': {**DELIVERY, 'access': access, field: value}})
        assert response.status_code == 409


def test_expiry_and_back_discard(client):
    q = ok(call(client, 'quote', {'itemId': 'F-101', 'delivery': DELIVERY}))
    ok(call(client, 'tick', {'days': 16 / 1440}))
    assert call(client, 'purchase', {'quoteId': q['id'], 'method': 'BPAY'}).status_code == 409
    ok(call(client, 'discard_quotes', {'itemId': 'F-101'}))
    assert not db.snapshot()['quotes']


def test_public_property_scope_and_replay(client):
    o = order(client)
    r = o['requests'][0]
    public = client.get('/api/state', headers={'X-Demo-Role': 'property', 'X-Property-Token': r['token']}).json()
    assert len(public['orders']) == 1 and len(public['orders'][0]['requests']) == 1
    assert 'paymentKey' not in public['orders'][0] and not public['audit']
    payload = {'token': r['token'], 'reply': {'name': 'Manager', 'status': 'approved'}}
    assert call(client, 'property', payload, 'property').status_code == 403
    assert call(client, 'property', payload, 'property', token=r['token']).status_code == 200
    assert call(client, 'property', payload, 'property', token=r['token']).status_code == 409


def test_listing_reject_edit_pricing_and_matching(client):
    form = deepcopy(db.seed()['items'][0])
    form['name'] = 'New green sofa'
    form['contact'] = 'bad'
    rejected = ok(call(client, 'listing', {'form': form}, 'seller'))
    assert rejected['status'] == 'rejected' and 'contact' in rejected['errors']
    form['contact'] = 'seller@example.test'
    accepted = ok(call(client, 'listing', {'form': form, 'id': rejected['id']}, 'seller'))
    assert accepted['status'] == 'published' and accepted['id'] == rejected['id']
    assert accepted['price'] == form['price']
    result = ok(call(client, 'recommend', {'profile': db.seed()['profile']}))
    assert len(result) <= 3
    assert all(i['category'] == '沙发' and i['price'] <= 600 for i in result)
    assert ok(call(client, 'pricing', {'form': {'category': '不存在'}}, 'seller'))['suggested'] is None


def test_graph_human_checkpoint_survives_reconstruction(client):
    state = db.snapshot()
    case = state['exceptions'][0]
    result = ok(call(client, 'conflict', {'orderId': case['orderId']}))
    thread = d.find(db.snapshot()['exceptions'], case['id'])['graphThread']
    options = {'configurable': {'thread_id': thread}}
    with PostgresSaver.from_conn_string(config.DATABASE_URL) as saver:
        graph = build_graph(saver)
        paused = graph.get_state(options)
        assert paused.next == ('HumanReview',)
        assert set(graph.nodes) >= {'ListingAgent', 'PricingAgent', 'MatchingAgent', 'LogisticsAgent', 'PaymentAgent', 'SupervisionAgent', 'AuditReportingAgent'}
    policy = ok(call(client, 'policy', {'caseId': case['id'], 'reason': 'Use an alternative within the fixed total'}, 'manager'))
    assert policy['active'] and policy['version'] == 1
    after = db.snapshot()
    assert d.find(after['orders'], case['orderId'])['total'] == d.find(state['orders'], case['orderId'])['total']
    assert d.find(after['exceptions'], case['id'])['status'] == 'resolved'


def test_reports_match_ledger_and_roles(client):
    assert client.get('/api/reports?start=2026-01-01&end=2026-12-31').status_code == 403
    result = client.get('/api/reports?start=2026-01-01&end=2026-12-31', headers={'X-Demo-Role': 'manager'})
    assert result.status_code == 200
    with db.connect() as conn:
        expected = conn.execute('SELECT sum(platform_cents) AS total FROM settlements').fetchone()['total']
    assert result.json()['income'] == int(expected) / 100


def test_photo_upload_and_unavailable_vision(client, monkeypatch):
    image = io.BytesIO()
    Image.new('RGB', (32, 32), 'green').save(image, 'JPEG')
    result = client.post('/api/media', files={'file': ('front.jpg', image.getvalue(), 'image/jpeg')}, headers={'X-Demo-Role': 'seller'})
    assert result.status_code == 200
    assert client.get(result.json()['ref']).status_code == 200
    assert client.post('/api/media', files={'file': ('bad.jpg', b'not an image')}, headers={'X-Demo-Role': 'seller'}).status_code == 422
    form = deepcopy(db.seed()['items'][0])
    form['photos'] = {k: result.json() for k in ['front', 'top', 'side']}
    form['photos']['details'] = []
    monkeypatch.setattr(config, 'MODEL_MODE', 'live')
    monkeypatch.setattr('app.agents.structured_model', lambda *a: (_ for _ in ()).throw(RuntimeError('Unavailable')))
    before=len(db.snapshot()['items'])
    rejected = call(client, 'listing', {'form': form}, 'seller')
    assert rejected.status_code == 503 and rejected.json()['retryable']
    assert len(db.snapshot()['items']) == before


def test_invalid_payload_and_roles(client):
    assert call(client, 'quote', {}).status_code == 422
    assert call(client, 'policy', {'caseId': 'EX-001', 'reason': 'x'}).status_code == 403
    assert call(client, 'listing', {'form': {}}, 'buyer').status_code == 403


def test_failed_purchase_rolls_back_and_concurrent_acceptance_settles_once(client):
    o = order(client)
    before = db.snapshot()
    assert call(client, 'advance', {'orderId': o['id'], 'action': 'confirm'}).status_code == 409
    after=db.snapshot()
    assert {k:v for k,v in after.items() if k!='now'} == {k:v for k,v in before.items() if k!='now'}
    assert after['now']>=before['now']
    delivered(client, o)
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: call(client, 'advance', {'orderId': o['id'], 'action': 'confirm'}), range(2)))
    assert all(r.status_code == 200 for r in results)
    assert results[0].json()['result']['payoutKey'] == results[1].json()['result']['payoutKey']
    with db.connect() as conn:
        assert conn.execute('SELECT count(*) AS n FROM settlements WHERE order_id=%s', (o['id'],)).fetchone()['n'] == 1


def test_model_empty_response_does_not_use_keyword_fallback(client, monkeypatch):
    from app.agents import Preferences
    monkeypatch.setattr(config, 'MODEL_MODE', 'live')
    monkeypatch.setattr('app.agents.structured_model', scripted_model(lambda: Preferences(tags=[])))
    result = ok(call(client, 'recommend', {'profile': db.seed()['profile']}))
    assert result and result[0]['requestedTags']==[]
    assert not any('fallback' in e['text'] for e in db.snapshot()['audit'])


def test_heic_upload_and_size_boundary(client):
    from pathlib import Path
    fixture = Path(__file__).resolve().parents[2] / 'frontend/tests/fixtures/sample.heic'
    response = client.post('/api/media', files={'file': ('sample.heic', fixture.read_bytes(), 'image/heic')}, headers={'X-Demo-Role': 'seller'})
    assert response.status_code == 200
    assert client.get(response.json()['ref']).headers['content-type'] == 'image/jpeg'
    image = io.BytesIO()
    Image.new('RGB', (8, 8), 'green').save(image, 'JPEG')
    data = image.getvalue()
    maximum = data + b'\0' * (15 * 1024 * 1024 - len(data))
    assert client.post('/api/media', files={'file': ('max.jpg', maximum)}, headers={'X-Demo-Role': 'seller'}).status_code == 200
    assert client.post('/api/media', files={'file': ('large.jpg', maximum + b'0')}, headers={'X-Demo-Role': 'seller'}).status_code == 422


def test_fractional_service_fee_keeps_ledger_balanced(client):
    with db.transaction() as (_, s):
        d.find(s['items'], 'F-101')['price'] = 12.25
    o = order(client)
    delivered(client, o)
    ok(call(client, 'advance', {'orderId': o['id'], 'action': 'confirm'}))
    with db.connect() as conn:
        ledger = conn.execute('SELECT * FROM settlements WHERE order_id=%s', (o['id'],)).fetchone()
    assert ledger['seller_cents'] == 1200
    assert ledger['platform_cents'] == 25 + d.cents(o['deliveryFee']*.1)
    assert ledger['seller_cents'] + ledger['carrier_cents'] + ledger['platform_cents'] == d.cents(o['total'])


@pytest.mark.parametrize('real_furniture,category_match', [(False,False),(True,False)])
def test_pricing_requires_furniture_and_matching_category(client,monkeypatch,real_furniture,category_match):
    from app.agents import VisualAssessment
    image=io.BytesIO();Image.new('RGB',(32,32),'blue').save(image,'JPEG')
    uploaded=client.post('/api/media',files={'file':('test.jpg',image.getvalue(),'image/jpeg')},headers={'X-Demo-Role':'seller'}).json()
    form=deepcopy(db.seed()['items'][0])
    form['photos']={k:uploaded for k in ['front','top','side']};form['photos']['details']=[]
    monkeypatch.setattr(config,'MODEL_MODE','live')
    monkeypatch.setattr('app.agents.structured_model',scripted_model(lambda:VisualAssessment(approved=True,depicts_real_furniture=real_furniture,category_match=category_match,directions_match=True,description_match=True,clear_and_relevant=True,reasons=['Not furniture or category mismatch'])))
    monkeypatch.setattr('app.market_pricing.market_price',lambda *a:pytest.fail('Rejected photos must never reach pricing'))
    result=ok(call(client,'pricing',{'form':form},'seller'))
    assert result['suggested'] is None and result['status']==('category_mismatch' if real_furniture else 'photo_rejected')
    assert ('照片中的家具与所选类别不一致' in result['errors'].get('category','')) if real_furniture else ('上传图片不符合平台政策' in result['errors'].values())
    rejected=ok(call(client,'listing',{'form':form},'seller'))
    assert rejected['status']=='rejected'
    assert ('类别不一致' in rejected['screenReason']) if real_furniture else ('上传图片不符合平台政策' in rejected['screenReason'])
    admin=client.get('/api/state',headers={'X-Demo-Role':'manager'}).json()
    internal=next(i for i in admin['items'] if i['id']==rejected['id'])
    assert internal['assessment']
    assert internal['assessment']['checks'] is not None


def test_demo_category_mismatch_blocks_pricing(client,monkeypatch):
    form=deepcopy(db.seed()['items'][0]);form['category']='床'
    form['photos']={k:{'ref':'/images/sofa.jpg'} for k in ['front','top','side']};form['photos']['details']=[]
    monkeypatch.setattr('app.market_pricing.market_price',lambda *a:pytest.fail('Wrong category reached pricing'))
    result=ok(call(client,'pricing',{'form':form},'seller'))
    assert result['status']=='category_mismatch' and result['suggested'] is None


def test_running_clock_and_quote_expiry_without_tick(client,monkeypatch):
    from app import demo_clock
    before=client.get('/api/state').json();anchor=before['demoClock']['anchor']
    monkeypatch.setattr(demo_clock,'wall_ms',lambda:anchor+16000)
    after=client.get('/api/state').json()
    assert after['now']>=before['now']+15000
    assert after['demoClock']['runId']==before['demoClock']['runId']
    q=ok(call(client,'quote',{'itemId':'F-101','delivery':DELIVERY}))
    monkeypatch.setattr(demo_clock,'wall_ms',lambda:anchor+1000000)
    assert call(client,'purchase',{'quoteId':q['id'],'method':'BPAY'}).status_code==409

def test_delivery_preview_matches_fixed_quote(client):
    near=client.post('/api/delivery-options',headers={'X-Demo-Role':'buyer'},json={'itemId':'F-101','address':'25 Demo Street, Glebe NSW 2037'}).json()
    far=client.post('/api/delivery-options',headers={'X-Demo-Role':'buyer'},json={'itemId':'F-101','address':'20 High Street, Penrith NSW 2750'}).json()
    assert near[0]['price']!=far[0]['price']
    q=ok(call(client,'quote',{'itemId':'F-101','delivery':dict(DELIVERY,address='20 High Street, Penrith NSW 2750')}))
    assert q['deliveryFee']==far[0]['price']
    assert far[1]['price']>far[0]['price']


def scripted_model(assessment):
    """Offline planner double; production always calls the campus model."""
    def invoke(schema,prompt,content,**kwargs):
        from app.agent_tools import Selection
        import json
        if schema is Selection:
            available=json.loads(content)['tools']
            selected=next(k for k in available if k not in ('read_policy','inspect_request'))
            return Selection(tool=selected,reason='Offline test choice')
        return assessment()
    return invoke
