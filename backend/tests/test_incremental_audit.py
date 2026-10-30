"""Audit outbox lifecycle with an isolated transactional adapter (no production database)."""
from contextlib import contextmanager
from copy import deepcopy
import pytest
from app import audit_worker, config, agents
from app.agent_tools import AgentUnavailable


@pytest.fixture
def outbox(monkeypatch):
    source={'requestId':'request-1','operation':'purchase','objectId':'order-1','committed':True,
            'execution':{'steps':[{'agent':'PaymentAgent','mode':'fixture_tools','modelCall':'not_called',
                                  'selection':'prepare_payment','tools':[{'name':'prepare_payment','status':'succeeded'}]}]}}
    data={'jobs':{'request-1':{'source':source,'status':'pending','attempts':0}},
          'state':{'now':1,'audit':[],'orders':[{'id':'order-1','status':'pending','held':True}]}}
    class Connection:
        result=None
        def __init__(self,store):
            self.data=store
        def execute(self,sql,args=()):
            self.result=None
            jobs=self.data['jobs']
            if sql.startswith('INSERT INTO agent_audit_jobs'):
                jobs.setdefault(args[0],{'source':args[1].obj,'status':'pending','attempts':0})
            elif "SET status='running'" in sql:
                job=jobs.get(args[0])
                if job and job['status'] in ('pending','failed') and job['attempts']<3:
                    job.update(status='running',attempts=job['attempts']+1)
                    self.result={'source':deepcopy(job['source'])}
            elif "SELECT 1 FROM agent_audit_jobs WHERE id=" in sql:
                job=jobs.get(args[0]);self.result={'exists':1} if job and job['status']=='running' else None
            elif "SET status='done'" in sql or "SET status='failed'" in sql:
                jobs[args[1]].update(status='done' if "status='done'" in sql else 'failed',result=args[0].obj)
            elif sql.startswith('SELECT id FROM agent_audit_jobs'):
                self.result=[{'id':key} for key,job in jobs.items() if job['status'] in ('pending','failed') and job['attempts']<3]
            return self
        def fetchone(self):
            return self.result
        def fetchall(self):
            return self.result or []
    @contextmanager
    def connect():
        local=deepcopy(data)
        yield Connection(local)
        data.clear();data.update(local)
    @contextmanager
    def transaction():
        local=deepcopy(data)
        yield Connection(local),local['state']
        data.clear();data.update(local)
    monkeypatch.setattr(audit_worker.db,'connect',connect)
    monkeypatch.setattr(audit_worker.db,'transaction',transaction)
    monkeypatch.setattr(audit_worker.db,'snapshot',lambda:deepcopy(data['state']))
    monkeypatch.setattr(config,'MODEL_MODE','fixture')
    audit_worker._stop.clear()
    return data,transaction


def test_pending_event_is_audited_once_and_not_recursively_enqueued(outbox):
    data,_=outbox
    before=deepcopy(data['state']['orders'])
    audit_worker.drain()
    assert data['jobs']['request-1']['status']=='done'
    assert data['state']['orders']==before
    assert len(data['jobs'])==1 and len(data['state']['audit'])==1
    audit_worker.drain()
    assert len(data['state']['audit'])==1


def test_no_new_events_means_no_model_calls(outbox,monkeypatch):
    data,_=outbox
    data['jobs'].clear()
    monkeypatch.setattr(config,'MODEL_MODE','live')
    monkeypatch.setattr(agents,'structured_model',lambda *a,**k:pytest.fail('No work means no model call'))
    audit_worker.drain()
    assert not data['state']['audit']


def test_audit_failure_preserves_order_and_retries_on_next_event(outbox,monkeypatch):
    data,_=outbox
    before=deepcopy(data['state']['orders'])
    real=audit_worker.inspect
    def fail(*args):
        raise AgentUnavailable([])
    monkeypatch.setattr(audit_worker,'inspect',fail)
    audit_worker.drain()
    assert data['jobs']['request-1']['status']=='failed'
    assert data['jobs']['request-1']['attempts']==1
    assert data['state']['orders']==before
    monkeypatch.setattr(audit_worker,'inspect',real)
    audit_worker.drain()
    assert data['jobs']['request-1']['status']=='done'
    assert data['jobs']['request-1']['attempts']==2


def test_outbox_insert_rolls_back_with_business_transaction(outbox):
    data,transaction=outbox
    with pytest.raises(RuntimeError):
        with transaction() as (conn,state):
            audit_worker.enqueue(conn,'rolled-back','purchase','order-1',{'steps':[]})
            raise RuntimeError('simulated storage failure')
    assert 'rolled-back' not in data['jobs']


def test_reset_removed_job_cannot_reappear_after_audit(outbox,monkeypatch):
    data,_=outbox
    def reset_during_audit(source,snapshot):
        data['jobs'].clear()
        return {'summary':'old result','execution':{},'findings':[]}
    monkeypatch.setattr(audit_worker,'inspect',reset_during_audit)
    audit_worker.process('request-1')
    assert not data['state']['audit'] and not data['jobs']
