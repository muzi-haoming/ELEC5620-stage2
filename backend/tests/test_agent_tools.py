"""Supervisor-worker structure from the Stage 1 report: deterministic dispatch, workers call the
model only where AI adds value, SupervisionAgent checks outcomes, detects stalls and escalates."""
import json
from copy import deepcopy
import pytest
from app import agents, config, database as db, domain as d
from app.main import graph_context
from test_platform import call, ok, order, delivered


def no_model(*args, **kwargs):
    pytest.fail('This step must not call the model')


def test_business_actions_select_bounded_tools_in_live_mode(client, monkeypatch):
    monkeypatch.setattr(config, 'MODEL_MODE', 'live')
    from app.agent_tools import ToolSelection
    calls=[]
    def select(schema,prompt,content,**kw):
        calls.append(content)
        return ToolSelection(tool=json.loads(content)['tools'][0]['name'])
    monkeypatch.setattr(agents, 'structured_model', select)
    o = order(client)
    delivered(client, o)
    settled = ok(call(client, 'advance', {'orderId': o['id'], 'action': 'confirm'}))
    assert settled['status'] == 'settled'
    steps = next(x for x in db.snapshot()['orders'] if x['id'] == o['id'])['events'][-1]['execution']['steps']
    assert calls and any(s.get('selection')=='prepare_acceptance_settlement' for s in steps)
    assert all(s['agent'] in ('PaymentAgent','BusinessRules') for s in steps)
    check = next(s for s in steps if s.get('mode') == 'outcome_check')
    assert '通过' in check['summary'] and check['modelCall'] == 'not_called'


def test_supervisor_blocks_an_outcome_that_breaks_the_rules(client, monkeypatch):
    profile = db.seed()['profile']
    item = next(i for i in db.snapshot()['items'] if i['status'] == 'published')
    monkeypatch.setattr(d, 'recommend', lambda *a, **k: [dict(item, price=float(profile['budget']) + 100, score=99, matched=[])])
    before = db.snapshot()['audit']
    response = call(client, 'recommend', {'profile': profile})
    assert response.status_code == 409 and '监督检查未通过' in response.json()['detail']
    audit = db.snapshot()['audit']
    assert len(audit) == len(before) + 1 and audit[-1]['agent'] == 'BusinessRules'


def test_conflict_without_policy_escalates_with_options(client):
    state = db.snapshot()
    with db.transaction() as (_, s):
        for p in s['policies']:
            if p['id'] == 'P-EXTRA':
                p['active'] = False
        s['exceptions'] = []
    target = next(o for o in state['orders'] if o['status'] == 'pending')
    case = ok(call(client, 'conflict', {'orderId': target['id']}))
    assert case['status'] == 'open' and 1 <= len(case['options']) <= 3
    assert all(o['action'] and o['impact'] for o in case['options'])


def test_manager_sees_stalled_orders(client):
    from app import demo_clock
    with db.transaction() as (_, s):
        demo_clock.jump(s, 7 * d.DAY)
    manager = client.get('/api/state', headers={'X-Demo-Role': 'manager'}).json()
    assert manager['attention'] and all(a['reason'] for a in manager['attention'])
    assert 'attention' not in client.get('/api/state', headers={'X-Demo-Role': 'buyer'}).json()


def pricing_run(monkeypatch, live=([], []), history=(), price=None):
    """Run PricingAgent offline with scripted public search, stored rows and price model."""
    from app import market_pricing
    from app.market_pricing import NewPriceEstimate
    monkeypatch.setattr(config, 'MODEL_MODE', 'live')
    monkeypatch.setattr(market_pricing, 'public_candidates', lambda *a, **k: live)
    monkeypatch.setattr(market_pricing, 'reference_rows', lambda category: list(history))
    def model(schema, prompt, content, **kw):
        from app.agent_tools import ToolSelection
        if schema is ToolSelection:
            available=[t['name'] for t in json.loads(content)['tools']]
            preferred=['use_market_price','use_history_price','query_market','query_history','estimate_with_ai']
            return ToolSelection(tool=next(n for n in preferred if n in available))
        assert schema is NewPriceEstimate
        if price is None:
            raise TimeoutError('upstream')
        return NewPriceEstimate(new_price_aud=price, confidence='medium', basis='同类全新布艺沙发')
    monkeypatch.setattr(agents, 'structured_model', model)
    s = db.seed()
    output = agents.specialist('PricingAgent')({'operation': 'pricing', 'payload': {'form': s['items'][0]},
                                                 'context': graph_context(s, 'pricing', {}), 'result': {'assessment': {'errors': {}}}})
    return s['items'][0], output


def comparable(i, price, observed=None):
    row = dict(id=f'cmp-{i}', url=f'https://www.zirkly.com.au/second-hand-furniture/x?id={i}', title='Linen fabric sofa 3 seater',
               price=price, currency='AUD', description='good condition, 2 years old, 185 cm wide')
    if observed:
        row['observedAt'] = observed
    return row


def test_pricing_prefers_live_listings(monkeypatch):
    _, output = pricing_run(monkeypatch, live=([comparable(1, 400), comparable(2, 500)], []), price=1000)
    pricing = output['result']['pricing']
    assert pricing['pricingMethod'] == 'live' and pricing['status'] == 'ready' and pricing['evidence']


def test_pricing_falls_back_to_recent_stored_listings(monkeypatch):
    _, output = pricing_run(monkeypatch, live=([], ['timeout']), history=[comparable(3, 450, '2026-10-20T00:00:00+00:00')], price=1000)
    pricing = output['result']['pricing']
    assert pricing['pricingMethod'] == 'history' and pricing['collectedFrom'] == '2026-10-20'


def test_pricing_falls_back_to_ai_estimate(monkeypatch):
    item, output = pricing_run(monkeypatch, price=1000)
    pricing = output['result']['pricing']
    condition = {'一般': .65, '良好': .85, '优秀': 1.0}[item['condition']]
    age = max(.35, 1 - .06 * item['age'])
    assert pricing['pricingMethod'] == 'ai' and pricing['suggested'] == round(1000 * round(condition * age, 4))
    assert output['decisions'][-1]['modelCall'] == 'succeeded'


def test_pricing_without_any_estimate_lets_seller_price_manually(monkeypatch):
    _, output = pricing_run(monkeypatch, price=None)
    pricing = output['result']['pricing']
    assert pricing['status'] == 'no_estimate' and pricing['suggested'] is None
    assert output['decisions'][-1].get('errorClass')
