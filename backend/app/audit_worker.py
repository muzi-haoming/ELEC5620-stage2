"""Durable, event-triggered incremental audit. No model polling when there are no new events."""
from copy import deepcopy
import logging
import threading
import time
from decimal import Decimal
from psycopg.types.json import Jsonb
from . import database as db, domain as d, progress
from .agent_tools import Tool, run_tools

_wake = threading.Event()
_stop = threading.Event()
_thread = None


def enqueue(conn, request_id, operation, object_id, execution, committed=True):
    source=dict(requestId=request_id, operation=operation, objectId=object_id,
                execution=deepcopy(execution), committed=committed)
    conn.execute('INSERT INTO agent_audit_jobs(id,source) VALUES (%s,%s) ON CONFLICT(id) DO NOTHING',
                 (request_id,Jsonb(source)))


def inspect(source, snapshot):
    """An auditor can read and analyse evidence, never mutate orders/payments/policies."""
    # The progress id only feeds the manager's read-only activity board; no client listens to it.
    context={'deadline':time.monotonic()+120,'progressId':'audit-'+str(source.get('requestId',''))}
    findings=[]
    def read_event():
        return {k:source.get(k) for k in ('requestId','operation','objectId','committed')}
    def read_decisions():
        rows=source.get('execution',{}).get('steps',[])
        return {'steps':[{k:r.get(k) for k in ('agent','mode','selection','summary','modelCall')} for r in rows]}
    def related():
        order=next((o for o in snapshot.get('orders',[]) if o['id']==source.get('objectId')),None)
        facts={'orderFound':bool(order),'currentStatus':order.get('status') if order else None,
               'held':order.get('held') if order else None,'settlementRecorded':bool(order and order.get('settledAt'))}
        if order and all(k in order for k in ('item','total','deliveryFee')):
            facts['totalMatchesQuoteParts']=d.cents(order['total'])==d.cents(order['item']['price'])+d.cents(order['deliveryFee'])
            if order['status']=='settled':
                seller=d.cents(order['item']['price'])-d.cents(Decimal(str(order['item']['price']))*Decimal('.02'))
                carrier=d.cents(order['deliveryFee'])-d.cents(Decimal(str(order['deliveryFee']))*Decimal('.1'))
                facts.update(sellerNetCents=seller,carrierNetCents=carrier,platformFeeCents=d.cents(order['total'])-seller-carrier,
                             acceptanceEvidence=bool(order.get('buyerAccepted') and order.get('delivered') and not order.get('issue') and not order.get('held')))
        return facts
    def check():
        rows=source.get('execution',{}).get('steps',[])
        for row in rows:
            if row.get('mode')=='model_selected_tools' and (not row.get('selection') or not row.get('tools')):
                findings.append('工具选择缺少执行依据')
            if any(t.get('status')!='succeeded' for t in row.get('tools',[])):
                findings.append('存在未成功执行的工具，请检查原始记录')
            if row.get('modelCall')=='failed':
                findings.append('存在模型调用失败记录，请查看该操作的最终结果')
        current=related()
        if current.get('totalMatchesQuoteParts') is False:
            findings.append('关联订单当前总价与商品、配送金额不一致')
        if current.get('acceptanceEvidence') is False:
            findings.append('关联订单当前结算缺少必要验收证据')
        if not source.get('committed'):
            findings.append('本次业务未提交，不能作为成功记录')
        return {'findings':list(dict.fromkeys(findings)),'checkedDecisionCount':len(rows),
                'businessStateChangedByAudit':False}
    def finish():
        return {'findings':list(dict.fromkeys(findings)),
                'summary':'增量审计完成：'+('发现需关注记录，见关联执行依据。' if findings else '本次决定与工具执行记录完整。')}
    tools=[Tool('read_source_event','读取新增业务事件',read_event),
           Tool('read_agent_decisions','读取各 Agent 决定与工具记录',read_decisions,{'read_source_event'}),
           Tool('read_related_records','查询关联订单与资金状态',related,{'read_source_event'}),
           Tool('check_evidence','检查执行依据与结果完整性',check,{'read_agent_decisions','read_related_records'}),
           Tool('summarize_audit','形成可追溯的审计结论',finish,{'check_evidence'},True)]
    with progress.step('审计 Agent：增量审计新业务事件',context['progressId']):
        traces=run_tools('AuditReportingAgent',context,tools,task='Audit only this committed event. '
                         'Look up decision evidence and related records, check completeness, then summarise. '
                         'Do not reinterpret later order changes as historical errors. Never modify business state or invent money.',
                         facts={'operation':source.get('operation')},max_steps=6)
    return {**finish(),'execution':dict(requestId='audit-'+source['requestId'],operation='audit',steps=traces)}


def process(job_id):
    with db.connect() as conn:
        row=conn.execute("UPDATE agent_audit_jobs SET status='running',attempts=attempts+1,updated_at=now() "
                         "WHERE id=%s AND status IN ('pending','failed') AND attempts<3 RETURNING source",(job_id,)).fetchone()
    if not row:
        return
    try:
        outcome=inspect(row['source'],db.snapshot())
        with db.transaction() as (conn,s):
            if not conn.execute("SELECT 1 FROM agent_audit_jobs WHERE id=%s AND status='running'",(job_id,)).fetchone():
                return
            d.audit(s,'AuditReportingAgent',outcome['summary'],row['source'].get('objectId',''))
            s['audit'][-1].update(execution=outcome['execution'],auditFindings=outcome['findings'],sourceRequestId=job_id)
            conn.execute("UPDATE agent_audit_jobs SET status='done',result=%s,updated_at=now() WHERE id=%s",
                         (Jsonb(outcome),job_id))
    except Exception as exc:
        with db.transaction() as (conn,s):
            if not conn.execute("SELECT 1 FROM agent_audit_jobs WHERE id=%s AND status='running'",(job_id,)).fetchone():
                return
            d.audit(s,'AuditReportingAgent','增量审计未完成，业务结果不受影响；下次新事件将重试。',row['source'].get('objectId',''))
            trace=getattr(exc,'steps',[])
            s['audit'][-1]['execution']=dict(requestId='audit-failed-'+job_id,operation='audit',steps=trace)
            conn.execute("UPDATE agent_audit_jobs SET status='failed',result=%s,updated_at=now() WHERE id=%s",
                         (Jsonb({'error':type(exc).__name__}),job_id))


def drain():
    with db.connect() as conn:
        # Only stale claims are recovered; healthy workers in another process keep their lease.
        conn.execute("UPDATE agent_audit_jobs SET status='pending' WHERE status='running' AND updated_at<now()-interval '10 minutes'")
        rows=conn.execute("SELECT id FROM agent_audit_jobs WHERE status IN ('pending','failed') AND attempts<3 ORDER BY created_at LIMIT 100").fetchall()
    for row in rows:
        if _stop.is_set():
            return
        process(row['id'])
    # A large queue is drained in bounded batches; failed jobs wait for another new event.
    if len(rows)==100:
        with db.connect() as conn:
            if conn.execute("SELECT 1 FROM agent_audit_jobs WHERE status='pending' LIMIT 1").fetchone():
                _wake.set()


def _run():
    while not _stop.is_set():
        _wake.wait()
        _wake.clear()
        if _stop.is_set():
            return
        try:
            drain()
        except Exception:
            logging.exception('Incremental audit worker failed; durable jobs retained')


def start():
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread=threading.Thread(target=_run,name='incremental-audit',daemon=True)
    _thread.start()
    notify()


def notify():
    _wake.set()


def stop():
    _stop.set()
    _wake.set()
    if _thread:
        _thread.join(timeout=2)
