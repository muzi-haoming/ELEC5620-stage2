"""Carrier facts bypass model coordination; all existing state/transaction guards remain."""
from copy import deepcopy
import json
import uuid
import pytest
from app import agents, config, domain as d, main
from app.agent_tools import ToolSelection
from test_workflow_progress import memory, action, done, DELIVERY


def carrier_ready(client,state):
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':DELIVERY}))
    order=done(action(client,'purchase',{'quoteId':quote['id'],'method':'BPAY'}))
    done(action(client,'advance',{'orderId':order['id'],'action':'book'}))
    return order['id']


def forbid_models_and_graph(monkeypatch):
    monkeypatch.setattr(config,'MODEL_MODE','live')
    def forbidden(*args,**kwargs):
        pytest.fail('A pickup/delivery fact must not enter a model or graph')
    monkeypatch.setattr(agents,'structured_model',forbidden)
    monkeypatch.setattr(main.app.state.graph,'invoke',forbidden)
    class ModelLock:
        def __enter__(self):
            pytest.fail('Carrier facts must not wait behind the model lock')
        def __exit__(self,*args):
            pass
    monkeypatch.setattr(main,'graph_lock',ModelLock())


def test_pickup_and_delivery_work_when_model_and_graph_are_unavailable(memory,monkeypatch):
    client,state,_=memory
    oid=carrier_ready(client,state)
    forbid_models_and_graph(monkeypatch)
    for stage,status in [('pickup','transit'),('deliver','received')]:
        order=done(action(client,'advance',{'orderId':oid,'action':stage}))
        assert order['status']==status and order['held']
        stored=d.find(state['orders'],oid)
        event=stored['events'][-1]
        assert event['agent']=='System' and event['facts']['action']==stage
        trace=event['execution']['steps']
        assert trace[0]['mode']=='delivery_event'
        assert all(row['modelCall']=='not_called' for row in trace)
        assert all(row['agent'] in ('System','BusinessRules') for row in trace)
    assert order['delivered'] and not order.get('buyerAccepted')
    assert not order.get('settledAt')


def test_pickup_still_requires_carrier_acceptance(memory,monkeypatch):
    client,state,_=memory
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':DELIVERY}))
    order=done(action(client,'purchase',{'quoteId':quote['id'],'method':'BPAY'}))
    before=deepcopy(state['orders'])
    forbid_models_and_graph(monkeypatch)
    events=action(client,'advance',{'orderId':order['id'],'action':'pickup'})
    assert events[-1]['type']=='error' and events[-1]['status']==409
    assert state['orders']==before
    failure=state['audit'][-1]['execution']
    assert failure['action']=='pickup' and failure['steps'][0]['mode']=='delivery_event_rejected'


def test_deliver_cannot_skip_pickup(memory,monkeypatch):
    client,state,_=memory
    oid=carrier_ready(client,state)
    before=deepcopy(state['orders'])
    forbid_models_and_graph(monkeypatch)
    events=action(client,'advance',{'orderId':oid,'action':'deliver'})
    assert events[-1]['type']=='error' and events[-1]['status']==409
    assert state['orders']==before


def test_repeat_pickup_does_not_add_duplicate_event(memory,monkeypatch):
    client,state,_=memory
    oid=carrier_ready(client,state)
    forbid_models_and_graph(monkeypatch)
    done(action(client,'advance',{'orderId':oid,'action':'pickup'}))
    before=deepcopy(d.find(state['orders'],oid))
    events=action(client,'advance',{'orderId':oid,'action':'pickup'})
    assert events[-1]['type']=='error' and events[-1]['status']==409
    assert d.find(state['orders'],oid)==before


def test_delivery_save_failure_rolls_back_status_and_event(memory,monkeypatch):
    client,state,control=memory
    oid=carrier_ready(client,state)
    before=deepcopy(state['orders'])
    forbid_models_and_graph(monkeypatch)
    control['fail_commit']=True
    events=action(client,'advance',{'orderId':oid,'action':'pickup'})
    assert events[-1]['type']=='error' and state['orders']==before


def test_graph_route_has_no_agent_for_pickup_or_delivery():
    assert agents.route_for('advance',{'action':'pickup'})==[]
    assert agents.route_for('advance',{'action':'deliver'})==[]
    assert agents.route_for('advance',{'action':'book'})==['LogisticsAgent']
    assert agents.route_for('advance',{'action':'confirm'})==['PaymentAgent']


def test_property_conditions_flow_into_simulated_carrier_arrangement(memory,monkeypatch):
    client,state,_=memory
    quote=done(action(client,'quote',{'itemId':'F-101','delivery':{**DELIVERY,'deliveryProperty':True,'deliveryEmail':'strata@example.test'}}))
    order=done(action(client,'purchase',{'quoteId':quote['id'],'method':'BPAY'}))
    token=order['requests'][0]['token']
    calls=[]
    def select(schema,prompt,content,**kwargs):
        choices=json.loads(content)['tools'];calls.append(choices[0]['name'])
        return ToolSelection(tool=choices[0]['name'],reason='读取物业限制并准备承运协调')
    monkeypatch.setattr(config,'MODEL_MODE','live')
    monkeypatch.setattr(agents,'structured_model',select)
    reply=dict(name='Manager',status='conditional',reason='按预约时段进入',timeWindow='10:00–12:00',lift='已预约',loading='Bay 2')
    response=client.post('/api/actions',json=dict(operation='property',payload={'token':token,'reply':reply},requestId=str(uuid.uuid4())),
                         headers={'Accept':'application/x-ndjson','X-Demo-Role':'property','X-Property-Token':token})
    done([json.loads(line) for line in response.text.splitlines()])
    assert calls==['read_coordination_context','prepare_property_followup']
    stored=d.find(state['orders'],order['id'])
    assert stored['status']=='pending' and not stored['providerAccepted']
    assert stored['logisticsCoordination']['phase']=='ready_for_carrier'
    calls.clear()
    buyer_result=done(action(client,'advance',{'orderId':order['id'],'action':'book'}))
    assert calls==['read_coordination_context','prepare_carrier_arrangement']
    assert 'logisticsCoordination' not in buyer_result
    plan=d.find(state['orders'],order['id'])['logisticsCoordination']
    assert plan['phase']=='carrier_accepted' and plan['simulated'] and not plan['realMessageSent']
    assert plan['plannedDate']==order['expected']
    assert plan['carrierHandoff']['propertyConditions'][0]['timeWindow']=='10:00–12:00'
    assert plan['carrierHandoff']['propertyConditions'][0]['loading']=='Bay 2'
    assert 'logisticsCoordination' not in d.find(main.visible(state,'buyer')['orders'],order['id'])
    assert d.find(main.visible(state,'manager')['orders'],order['id'])['logisticsCoordination']
