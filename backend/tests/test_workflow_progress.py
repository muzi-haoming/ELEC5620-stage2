"""Progress contract tests; all persistence is isolated in memory, with no external services."""
from contextlib import contextmanager
from copy import deepcopy
import json
from pathlib import Path
import queue
import uuid

import pytest
from fastapi import Request, HTTPException
from urllib.parse import urlsplit, parse_qs
from app import domain as d, progress, config
from app.agents import build_graph
from langgraph.checkpoint.memory import InMemorySaver
from app.main import app
from app import main


@pytest.fixture
def memory(monkeypatch):
    state = json.loads((Path(__file__).parents[1] / 'app/seed.json').read_text(encoding='utf-8'))
    control = {'fail_commit': False, 'commits': 0}
    class Connection:
        def execute(self, *args):
            return self
        def fetchone(self):
            return None
    @contextmanager
    def connect():
        yield Connection()
    @contextmanager
    def transaction():
        local = deepcopy(state)
        yield Connection(), local
        if control['fail_commit']:
            raise RuntimeError('simulated commit failure')
        state.clear()
        state.update(local)
        control['commits'] += 1
    monkeypatch.setattr(main.db, 'connect', connect)
    monkeypatch.setattr(main.db, 'transaction', transaction)
    monkeypatch.setattr(main.db, 'snapshot', lambda: deepcopy(state))
    monkeypatch.setattr(config, 'MODEL_MODE', 'fixture')
    monkeypatch.setattr(config, 'DEMO_MODE', True)
    monkeypatch.setattr(app.state, 'graph', build_graph(InMemorySaver()), raising=False)
    # Invoke handlers directly: no production lifespan, sockets or PostgreSQL pool.
    class Response:
        def __init__(self, value=None, status=200, text=''):
            self.value, self.status_code, self.text = value, status, text
        def json(self):
            return self.value
    monkeypatch.setattr(main, 'StreamingResponse', lambda lines, **kwargs: Response(text=''.join(lines)))
    class Client:
        def request(self, path, headers):
            return Request({'type':'http','method':'GET','path':path,'headers':[(k.lower().encode(),v.encode()) for k,v in headers.items()]})
        def post(self, path, json, headers):
            return main.action(main.Action(**json), self.request(path, headers))
        def get(self, url, headers):
            args=parse_qs(urlsplit(url).query)
            try:
                value=main.reports(self.request(url,headers),args['start'][0],args['end'][0])
                return value if isinstance(value,Response) else Response(value)
            except HTTPException as error:
                return Response(status=error.status_code)
    return Client(), state, control


DELIVERY = dict(address='25 Demo Road, Glebe NSW', door=100, doorHeight=210, floor=0,
                movers=2, pickupProperty=False, deliveryProperty=False,
                loading=True, pickupAccess=True, access='ground', provider='economy')


def action(client, operation, payload):
    response = client.post('/api/actions', json=dict(operation=operation, payload=payload, requestId=str(uuid.uuid4())),
                           headers={'Accept': 'application/x-ndjson', 'X-Demo-Role': 'buyer'})
    assert response.status_code == 200
    return [json.loads(line) for line in response.text.splitlines()]


def done(events):
    assert events[-1]['type'] == 'result', events
    steps = [e for e in events if e['type'] == 'progress']
    assert steps and all(e['status'] == 'done' for e in {e['key']: e for e in steps}.values())
    return events[-1]['result']


def test_real_checks_quote_payment_and_atomic_acceptance(memory):
    client, state, control = memory
    events = action(client, 'quote', {'itemId': 'F-101', 'delivery': DELIVERY})
    quote = done(events)
    assert any('门尺寸' in e.get('label', '') for e in events)
    assert quote['total'] == (d.cents(quote['itemPrice']) + d.cents(quote['deliveryFee'])) / 100
    order = done(action(client, 'purchase', {'quoteId': quote['id'], 'method': 'BPAY'}))
    assert order['held'] and order['receipt']
    for name in ('book', 'pickup', 'deliver'):
        done(action(client, 'advance', {'orderId': order['id'], 'action': name}))
    events = action(client, 'advance', {'orderId': order['id'], 'action': 'confirm'})
    settled = done(events)
    assert settled['status'] == 'settled' and not settled['held']
    assert any('服务费与净额' in e.get('label', '') for e in events)
    assert '保存结果与账本' in events[-2]['label'] and events[-2]['status'] == 'done'
    assert control['commits'] == 6
    again = done(action(client, 'advance', {'orderId': order['id'], 'action': 'confirm'}))
    assert again['payoutKey'] == settled['payoutKey']


def test_failed_check_does_not_emit_later_steps_or_commit(memory):
    client, state, control = memory
    events = action(client, 'quote', {'itemId': 'F-101', 'delivery': {**DELIVERY, 'door': 1}})
    assert events[-1]['type'] == 'error'
    assert any(e.get('status') == 'failed' and '门尺寸' in e['label'] for e in events)
    assert not any('计算配送费' in e.get('label', '') for e in events)
    assert control['commits']==1  # failure audit only; rejected business state is not saved
    assert not any(q.get('delivery',{}).get('door')==1 for q in state['quotes'])


def test_commit_failure_never_announces_saved_or_paid(memory):
    client, state, control = memory
    quote = done(action(client, 'quote', {'itemId': 'F-101', 'delivery': DELIVERY}))
    before = deepcopy(state)
    control['fail_commit'] = True
    events = action(client, 'purchase', {'quoteId': quote['id'], 'method': 'BPAY'})
    assert events[-1]['type'] == 'error'
    assert not any(e['type'] == 'result' for e in events)
    assert not any('保存结果与账本' in e.get('label', '') and e.get('status') == 'done' for e in events)
    assert state == before


def test_report_stream_matches_json_and_enforces_role(memory):
    client, state, control = memory
    url = '/api/reports?start=2026-01-01&end=2026-12-31'
    assert client.get(url, headers={'Accept': 'application/x-ndjson'}).status_code == 403
    assert client.get('/api/reports?start=bad&end=bad', headers={'X-Demo-Role': 'manager'}).status_code == 422
    expected = client.get(url, headers={'X-Demo-Role': 'manager'}).json()
    response = client.get(url, headers={'X-Demo-Role': 'manager', 'Accept': 'application/x-ndjson'})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert done(events) == expected
    assert any('读取数据库' in e.get('label', '') for e in events)
    assert '保存报告查询记录' in events[-2]['label']


def test_scopes_do_not_leak_after_exception():
    sink = queue.Queue()
    progress.register('test-request', sink)
    try:
        with pytest.raises(ValueError), progress.request_scope('test-request'):
            with progress.step('real failing work'):
                raise ValueError()
        with progress.step('outside request'):
            pass
        events = [sink.get_nowait(), sink.get_nowait()]
        assert [e['status'] for e in events] == ['running', 'failed']
        assert sink.empty()
    finally:
        progress.unregister('test-request')


def test_report_save_failure_is_failed_not_completed(memory):
    client, state, control = memory
    control['fail_commit'] = True
    response = client.get('/api/reports?start=2026-01-01&end=2026-12-31',
                          headers={'X-Demo-Role': 'manager', 'Accept': 'application/x-ndjson'})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]['type'] == 'error'
    assert not any(e['type'] == 'result' for e in events)
    assert any(e.get('status') == 'failed' and '保存报告' in e.get('label', '') for e in events)
