from app import agents
from app.main import visible, result_view


def test_execution_metadata_is_manager_only():
    event = {'agent': 'MatchingAgent', 'text': 'done', 'execution': {'steps': [{'modelCall': 'succeeded'}]}}
    order = {'events': [event]}
    state = {'orders': [order], 'items': [], 'audit': [], 'policies': [], 'exceptions': []}
    assert visible(state, 'manager')['orders'][0]['events'][0]['execution']
    for role in ('buyer', 'seller'):
        assert 'execution' not in visible(state, role)['orders'][0]['events'][0]
        assert 'execution' not in result_view(order, role)['events'][0]
    assert event['agent'] == 'MatchingAgent'


def test_matching_logs_actual_call_not_agent_name(monkeypatch):
    monkeypatch.setattr(agents.config, 'MODEL_MODE', 'live')
    calls = []
    def model(*args, **kwargs):
        calls.append(True)
        return agents.Preferences(tags=[])
    monkeypatch.setattr(agents, 'structured_model', model)
    run = agents.specialist('MatchingAgent')
    def invoke(text):
        return run({'operation': 'recommend', 'payload': {'profile': {'preferences': text}}})['decisions'][0]
    assert invoke('')['modelCall'] == 'not_called'
    assert not calls
    decision = invoke('green')
    assert decision['modelCall'] == 'succeeded'
    assert decision['endpoint'] == '/v1/chat/completions'
    assert decision['durationMs'] >= 0
    assert decision['modelDurationMs'] >= 0
    def failed(*args, **kwargs):
        raise TimeoutError()
    monkeypatch.setattr(agents, 'structured_model', failed)
    assert invoke('green')['modelCall'] == 'failed'
