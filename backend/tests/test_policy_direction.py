"""The founder's chosen side decides the P-EXTRA rule and how later conflicts are handled.
Amounts never change: the logistics direction is recorded as a simulated platform absorption."""
from app import database as db, domain as d
from test_platform import call, ok


def test_founder_direction_versions_policy_and_drives_later_conflicts(client):
    state = db.snapshot()
    case = state['exceptions'][0]
    ok(call(client, 'conflict', {'orderId': case['orderId']}))
    assert call(client, 'policy', {'caseId': case['id'], 'reason': 'x', 'direction': 'other'}, 'manager').status_code == 409
    policy = ok(call(client, 'policy', {'caseId': case['id'], 'reason': 'Platform covers it', 'direction': 'logistics'}, 'manager'))
    assert policy['active'] and policy['direction'] == 'logistics' and policy['side'] == 'LogisticsAgent'
    assert d.find(db.snapshot()['exceptions'], case['id'])['direction'] == 'logistics'

    target = next(o for o in db.snapshot()['orders'] if o['status'] == 'pending' and o['id'] != case['orderId'])
    handled = ok(call(client, 'conflict', {'orderId': target['id']}))
    assert handled['handledByPolicy'] and handled['direction'] == 'logistics'
    after = db.snapshot()
    order = d.find(after['orders'], target['id'])
    assert order['total'] == target['total'] and order['policyHandling']['simulated']
    assert '平台承担' in after['audit'][-1]['text']
    buyer_view = client.get('/api/state', headers={'X-Demo-Role': 'buyer'}).json()
    assert all('policyHandling' not in o for o in buyer_view['orders'])


def test_policy_without_direction_keeps_previous_behaviour():
    s = dict(now=0, policies=[], exceptions=[dict(id='EX-T', status='open', orderId='O')], audit=[])
    policy = d.policy_decision(s, 'EX-T', 'reason')
    assert policy['direction'] == 'pricing' and '不提高买家固定总价' in policy['rule']
