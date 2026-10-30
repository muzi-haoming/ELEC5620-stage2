"""Live selection protocol tests with scripted model responses, isolated persistence and no APIs."""
from copy import deepcopy
import json
import time
import uuid
import pytest
from app import agents, config, domain as d, main, pricing_workflow, market_pricing, audit_worker
from app.agent_tools import ToolSelection, AgentUnavailable
from app.agent_workflows import business
from test_workflow_progress import memory, action, done, DELIVERY


def choose(monkeypatch, preferred=(), new_price=1000):
    calls=[]
    def model(schema, prompt, content, **kwargs):
        calls.append((schema, content))
        if schema is market_pricing.NewPriceEstimate:
            if new_price is None:
                raise TimeoutError()
            return schema(new_price_aud=new_price,confidence='medium',basis='同类全新家具估算')
        if schema is not ToolSelection:
            raise AssertionError('Unexpected model call')
        choices=[t['name'] for t in json.loads(content)['tools']]
        name=next((n for n in preferred if n in choices),choices[0])
        return ToolSelection(tool=name,reason='根据当前结果选择允许的工具')
    monkeypatch.setattr(agents,'structured_model',model)
    monkeypatch.setattr(config,'MODEL_MODE','live')
    return calls


def post(client,op,payload,role='buyer'):
    response=client.post('/api/actions',json={'operation':op,'payload':payload,'requestId':str(uuid.uuid4())},
                         headers={'Accept':'application/x-ndjson','X-Demo-Role':role})
    return [json.loads(line) for line in response.text.splitlines()]


def reference(price=400):
    return dict(id='reference',url='https://www.zirkly.com.au/item/1',title='Used fabric sofa',
                description='Good condition, 2 years old, 185 cm wide, 82 cm deep, 78 cm high',
                price=price,currency='AUD',observedAt='2026-10-20T00:00:00Z')


def price_state():
    s=json.loads((main.config.ROOT/'app/seed.json').read_text(encoding='utf-8'))
    return {'operation':'pricing','payload':{'form':s['items'][0]},
            'context':main.graph_context(s,'pricing',{}),'result':{'assessment':{'errors':{}}}}


def test_logistics_model_selects_read_order_and_event_tools_in_different_order(memory,monkeypatch):
    client,state,_=memory
    calls=choose(monkeypatch,preferred=['read_access','read_item'])
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':DELIVERY}))
    assert quote['total']==455
    traces=[r for r in state['audit'] if r.get('execution')][-1]['execution']['steps']
    choices=[r['selection'] for r in traces if r.get('selection')]
    assert choices[:2]==['read_access','read_item']
    assert len(calls)==3
    assert not any(r['agent']=='SupervisionAgent' for r in traces)
    assert any(r['agent']=='BusinessRules' for r in traces)


def test_payment_and_acceptance_choose_tools_without_changing_amounts(memory,monkeypatch):
    client,state,_=memory
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':DELIVERY}))
    calls=choose(monkeypatch)
    order=done(action(client,'purchase',{'quoteId':quote['id'],'method':'BPAY'}))
    assert order['held'] and order['total']==455
    for stage in ('book','pickup','deliver'):
        done(action(client,'advance',{'orderId':order['id'],'action':stage}))
    settled=done(action(client,'advance',{'orderId':order['id'],'action':'confirm'}))
    assert settled['status']=='settled' and settled['buyerAccepted'] and not settled['held']
    again=done(action(client,'advance',{'orderId':order['id'],'action':'confirm'}))
    assert settled['payoutKey']==again['payoutKey']
    trace=d.find(state['orders'],order['id'])['events'][-1]['execution']['steps']
    assert any(r.get('selection')=='prepare_acceptance_settlement' for r in trace)
    assert all(r['agent'] in ('PaymentAgent','BusinessRules') for r in trace)
    assert calls


@pytest.mark.parametrize('failure',['bad_tool','timeout','skipped_prerequisite'])
def test_invalid_model_response_never_changes_business_state(memory,monkeypatch,failure):
    client,state,_=memory
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':DELIVERY}))
    before={k:deepcopy(state[k]) for k in ('items','orders','quotes')}
    monkeypatch.setattr(config,'MODEL_MODE','live')
    def model(*args,**kwargs):
        if failure=='timeout':
            raise TimeoutError()
        return ToolSelection(tool='prepare_payment' if failure=='skipped_prerequisite' else 'delete_database')
    monkeypatch.setattr(agents,'structured_model',model)
    events=action(client,'purchase',{'quoteId':quote['id'],'method':'BPAY'})
    assert events[-1]['type']=='error' and events[-1]['status']==503
    assert {k:state[k] for k in before}==before
    assert state['audit'][-1]['execution']['steps'][-1]['tools']==[]


def test_existing_payment_rules_reject_expired_quotes_before_paid(memory,monkeypatch):
    client,state,_=memory
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':DELIVERY}))
    d.find(state['quotes'],quote['id'])['expires']=state['now']-1
    choose(monkeypatch)
    before=len(state['orders'])
    events=action(client,'purchase',{'quoteId':quote['id'],'method':'BPAY'})
    assert events[-1]['type']=='error' and events[-1]['status']==409
    assert len(state['orders'])==before


def test_property_pending_still_prevents_booking(memory,monkeypatch):
    client,state,_=memory
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':{**DELIVERY,'pickupProperty':True,'pickupEmail':'test@example.test'}}))
    order=done(action(client,'purchase',{'quoteId':quote['id'],'method':'BPAY'}))
    choose(monkeypatch)
    events=action(client,'advance',{'orderId':order['id'],'action':'book'})
    assert events[-1]['type']=='error'
    assert not d.find(state['orders'],order['id'])['providerAccepted']


def test_transaction_rechecks_item_after_model_preparation(memory,monkeypatch):
    client,state,_=memory
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':DELIVERY}))
    original=main.app.state.graph
    class RacingGraph:
        def invoke(self,*args,**kwargs):
            result=original.invoke(*args,**kwargs)
            d.find(state['items'],'F-101')['status']='sold'
            return result
    monkeypatch.setattr(main.app.state,'graph',RacingGraph())
    events=action(client,'purchase',{'quoteId':quote['id'],'method':'BPAY'})
    assert events[-1]['type']=='error' and events[-1]['status']==409
    assert not any(o.get('quoteId')==quote['id'] for o in state['orders'])


@pytest.mark.parametrize('first',['query_history','query_market'])
def test_pricing_model_can_select_either_reference_source(monkeypatch,first):
    choose(monkeypatch,preferred=[first])
    monkeypatch.setattr(market_pricing,'reference_rows',lambda category:[reference()])
    monkeypatch.setattr(market_pricing,'public_candidates',lambda *args,**kwargs:([reference()],[]))
    monkeypatch.setattr(market_pricing,'store',lambda *args:0)
    output=agents.specialist('PricingAgent')(price_state())
    assert output['result']['pricing']['status']=='ready'
    assert output['result']['pricing']['pricingMethod']==('history' if first=='query_history' else 'live')
    assert output['decisions'][0]['selection']==first
    assert output['result']['pricing']['evidence']


def test_pricing_checks_other_source_before_ai(monkeypatch):
    calls=choose(monkeypatch)
    monkeypatch.setattr(market_pricing,'reference_rows',lambda category:[])
    monkeypatch.setattr(market_pricing,'public_candidates',lambda *args,**kwargs:([],[]))
    output=agents.specialist('PricingAgent')(price_state())
    names=[r.get('selection') for r in output['decisions'] if r.get('selection')]
    assert names==['query_history','query_market','estimate_with_ai']
    assert output['result']['pricing']['pricingMethod']=='ai'
    assert output['result']['pricing']['evidence']==[]


def test_ai_unavailable_allows_manual_price_but_selector_failure_does_not(monkeypatch):
    choose(monkeypatch,new_price=None)
    monkeypatch.setattr(market_pricing,'reference_rows',lambda category:[])
    monkeypatch.setattr(market_pricing,'public_candidates',lambda *args,**kwargs:([],[]))
    output=agents.specialist('PricingAgent')(price_state())
    assert output['result']['pricing']['status']=='no_estimate'
    assert output['result']['pricing']['suggested'] is None
    monkeypatch.setattr(agents,'structured_model',lambda *args,**kwargs:ToolSelection(tool='estimate_with_ai'))
    with pytest.raises(AgentUnavailable):
        agents.specialist('PricingAgent')(price_state())


def test_timeout_uses_ai_and_discards_late_reference(monkeypatch):
    choose(monkeypatch)
    monkeypatch.setattr(pricing_workflow,'QUERY_BUDGET_SECONDS',.15)
    def slow(category):
        time.sleep(.3)
        return [reference()]
    monkeypatch.setattr(market_pricing,'reference_rows',slow)
    monkeypatch.setattr(market_pricing,'store',lambda *args:pytest.fail('Late references cannot be stored'))
    output=agents.specialist('PricingAgent')(price_state())
    assert output['result']['pricing']['pricingMethod']=='ai'


def test_supervisor_applies_existing_policy_only_on_conflict(memory,monkeypatch):
    client,state,_=memory
    state['policies'].append(dict(id='P-EXTRA',active=True,version=1,rule='保持买家固定总价，请求可行替代方案。'))
    choose(monkeypatch)
    target=next(o for o in state['orders'] if o['status']=='pending')
    before=target['total']
    result=done(action(client,'conflict',{'orderId':target['id']}))
    assert result['handledByPolicy'] and result['policy']=={'id':'P-EXTRA','version':1}
    assert d.find(state['orders'],target['id'])['total']==before
    assert not d.find(state['orders'],target['id'])['providerAccepted']


def test_missing_policy_pauses_and_founder_can_resume(memory):
    client,state,_=memory
    target=next(o for o in state['orders'] if o['status']=='pending')
    case=done(action(client,'conflict',{'orderId':target['id']}))
    thread=d.find(state['exceptions'],case['id'])['graphThread']
    assert case['status']=='open' and thread
    paused=main.app.state.graph.get_state({'configurable':{'thread_id':thread}})
    assert paused.next==('HumanReview',)
    policy=done(post(client,'policy',{'caseId':case['id'],'reason':'保持固定总价，要求替代方案'},'manager'))
    assert policy['active'] and d.find(state['exceptions'],case['id'])['status']=='resolved'


def test_audit_reads_new_event_and_never_mutates_business(memory,monkeypatch):
    _,state,_=memory
    calls=choose(monkeypatch,preferred=['read_related_records','read_agent_decisions'])
    before=deepcopy(state)
    source=dict(requestId='source-1',operation='advance',objectId=state['orders'][0]['id'],committed=True,
                execution={'steps':[{'agent':'LogisticsAgent','mode':'model_selected_tools','selection':'prepare_delivery_update',
                                     'modelCall':'succeeded','tools':[{'name':'prepare_delivery_update','status':'succeeded'}]}]})
    result=audit_worker.inspect(source,state)
    assert not result['findings'] and result['execution']['steps']
    assert state==before and calls
    assert all(r['agent']=='AuditReportingAgent' for r in result['execution']['steps'])


def test_audit_failure_is_detected_without_inventing_success(memory,monkeypatch):
    _,state,_=memory
    choose(monkeypatch)
    source=dict(requestId='failed-source',operation='purchase',objectId='',committed=False,
                execution={'steps':[{'agent':'PaymentAgent','modelCall':'failed','tools':[]}]})
    outcome=audit_worker.inspect(source,state)
    assert len(outcome['findings'])==2


def test_seller_cannot_initiate_acceptance_or_settlement(memory,monkeypatch):
    client,state,_=memory
    choose(monkeypatch)
    before=deepcopy(state['orders'])
    result=post(client,'advance',{'orderId':state['orders'][0]['id'],'action':'confirm'},'seller')
    assert result[-1]['type']=='error' and result[-1]['status']==403
    assert state['orders']==before


def test_policy_changed_during_model_work_is_rejected(memory,monkeypatch):
    client,state,_=memory
    state['policies'].append(dict(id='P-EXTRA',active=True,version=1,rule='保持买家固定总价，请求替代方案'))
    graph=main.app.state.graph
    class ChangePolicy:
        def invoke(self,*args,**kwargs):
            result=graph.invoke(*args,**kwargs)
            state['policies'][-1]['version']=2
            return result
    monkeypatch.setattr(main.app.state,'graph',ChangePolicy())
    target=next(o for o in state['orders'] if o['status']=='pending')
    events=action(client,'conflict',{'orderId':target['id']})
    assert events[-1]['type']=='error' and events[-1]['status']==409


def test_audit_financial_checks_use_code_and_do_not_rewrite_records(memory,monkeypatch):
    _,state,_=memory
    order=state['orders'][0]
    order['total']+=1
    source=dict(requestId='source-amount',operation='purchase',objectId=order['id'],committed=True,execution={'steps':[]})
    choose(monkeypatch)
    before=deepcopy(state)
    outcome=audit_worker.inspect(source,state)
    assert any('总价' in issue for issue in outcome['findings'])
    assert state==before


def test_storage_without_tool_authorization_is_blocked(memory,monkeypatch):
    client,state,_=memory
    class NoAuthorization:
        def invoke(self,*args,**kwargs):
            return {'result':{},'decisions':[]}
    monkeypatch.setattr(main.app.state,'graph',NoAuthorization())
    before=deepcopy(state['quotes'])
    events=action(client,'quote',{'itemId':'F-101','delivery':DELIVERY})
    assert events[-1]['type']=='error' and events[-1]['status']==503
    assert state['quotes']==before


def test_tool_selection_uses_configured_output_budget(memory,monkeypatch):
    from app.agent_tools import run_tools,Tool
    monkeypatch.setattr(config,'MODEL_MODE','live')
    monkeypatch.setattr(config,'MODEL_MAX_OUTPUT_TOKENS',2048)
    seen=[]
    def model(schema,prompt,content,**kwargs):
        seen.append(kwargs['max_tokens'])
        return ToolSelection(tool='read_only')
    monkeypatch.setattr(agents,'structured_model',model)
    run_tools('LogisticsAgent',{},[Tool('read_only','只读检查',lambda:{'ok':True},terminal=True)],task='Read only')
    assert seen==[2048]
