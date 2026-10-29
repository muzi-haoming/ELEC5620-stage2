import json
from copy import deepcopy
import pytest
from app import agents, config, database as db
from app.agent_tools import Selection, AgentUnavailable, run_specialist
from app.main import graph_context
from test_platform import call, ok, order, delivered, scripted_model


def test_live_model_selected_payment_tools_and_atomic_settlement(client, monkeypatch):
    o=order(client)
    delivered(client,o)
    monkeypatch.setattr(config,'MODEL_MODE','live')
    selections=[]
    def model(schema,prompt,content,**kwargs):
        available=json.loads(content)['tools']
        tool='inspect_request' if 'inspect_request' in available else next(k for k in available if k!='read_policy')
        selections.append(tool)
        return Selection(tool=tool,reason='Test action selection')
    monkeypatch.setattr(agents,'structured_model',model)
    response=ok(call(client,'advance',{'orderId':o['id'],'action':'confirm'}))
    assert response['status']=='settled'
    assert 'PaymentAgent' in selections and 'LogisticsAgent' not in selections
    assert 'inspect_request' in selections and 'prepare_business_action' in selections
    saved=next(x for x in db.snapshot()['orders'] if x['id']==o['id'])
    steps=saved['events'][-1]['execution']['steps']
    assert any(t['name']=='prepare_business_action' and t['result']['committed'] is False for s in steps for t in s.get('tools',[]))
    assert all(s['modelCall']=='succeeded' for s in steps)
    assert 'execution' not in response['events'][-1]


def test_tool_preview_does_not_write_and_invalid_transition_cannot_bypass(client,monkeypatch):
    o=order(client)
    snapshot=db.snapshot()
    monkeypatch.setattr(config,'MODEL_MODE','live')
    monkeypatch.setattr(agents,'structured_model',scripted_model(lambda:None))
    response=call(client,'advance',{'orderId':o['id'],'action':'deliver'})
    assert response.status_code==409
    assert db.snapshot()['orders']==snapshot['orders']


@pytest.mark.parametrize('failure',['timeout','unknown_tool','premature_finish'])
def test_failed_planner_retains_order_and_does_not_write_receipt(client,monkeypatch,failure):
    o=order(client)
    before=db.snapshot()['orders']
    monkeypatch.setattr(config,'MODEL_MODE','live')
    def model(*a,**kw):
        if failure=='timeout': raise TimeoutError('secret upstream data')
        return Selection(tool='delete_all' if failure=='unknown_tool' else 'finish',reason='bad')
    monkeypatch.setattr(agents,'structured_model',model)
    r=call(client,'advance',{'orderId':o['id'],'action':'pickup'},request_id='failed-agent-test')
    assert r.status_code==503 and r.json()['retryable']
    assert db.snapshot()['orders']==before
    with db.connect() as conn:
        assert conn.execute('SELECT * FROM command_receipts WHERE id=%s',('failed-agent-test',)).fetchone() is None
    assert 'secret upstream' not in json.dumps(db.snapshot())


def test_failure_after_preparation_still_does_not_commit(client,monkeypatch):
    o=order(client)
    delivered(client,o)
    before=db.snapshot()['orders']
    monkeypatch.setattr(config,'MODEL_MODE','live')
    def model(schema,prompt,content,**kw):
        available=json.loads(content)['tools']
        if 'finish' in available: raise TimeoutError()
        return Selection(tool=next(k for k in available if k not in ('read_policy','inspect_request')),reason='test')
    monkeypatch.setattr(agents,'structured_model',model)
    assert call(client,'advance',{'orderId':o['id'],'action':'confirm'}).status_code==503
    assert db.snapshot()['orders']==before


def test_pricing_model_must_search_before_estimate(monkeypatch):
    from app import market_pricing
    monkeypatch.setattr(config,'MODEL_MODE','live')
    selected=[]
    def planner(schema,prompt,content,**kw):
        available=json.loads(content)['tools']
        if 'search_public_market' in available:
            assert 'estimate_market_price' not in available
        tool=next(k for k in available if k not in ('read_policy','inspect_request'))
        selected.append(tool)
        return Selection(tool=tool,reason='Offline pricing test')
    monkeypatch.setattr(agents,'structured_model',planner)
    rows=[{'id':'test-comparable','price':100}]
    monkeypatch.setattr(market_pricing,'public_candidates',lambda *a:(rows,[]))
    def estimate(form,**kw):
        assert kw['candidates']==(rows,[])
        return {'status':'ready','suggested':100}
    monkeypatch.setattr(market_pricing,'market_price',estimate)
    s=db.seed()
    output=run_specialist('PricingAgent',{'operation':'pricing','payload':{'form':s['items'][0]},
                         'context':graph_context(s,'pricing',{}),'result':{'assessment':{'errors':{}}}})
    assert selected==['search_public_market','estimate_market_price','finish']
    assert output['result']['pricing']['suggested']==100
