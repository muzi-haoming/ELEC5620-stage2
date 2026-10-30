from contextlib import asynccontextmanager
from copy import deepcopy
from decimal import Decimal
from hashlib import sha256
import io
import json
import logging
import math
import queue
import threading
import time
from pathlib import Path
from threading import Lock
import warnings
from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from PIL import Image
from pillow_heif import register_heif_opener
from psycopg.types.json import Jsonb
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.types import Command
from . import config, database as db, domain as d, demo_clock, progress, review_cache, supervision
from .agents import build_graph, ROUTES, route_for
from . import audit_worker
from .agent_workflows import command_key, coordination_plan
from .agent_tools import AgentUnavailable

register_heif_opener()
Image.MAX_IMAGE_PIXELS = 40_000_000
graph_lock = Lock()


@asynccontextmanager
async def lifespan(app):
    db.open_pool()
    try:
        db.setup()
        config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        with PostgresSaver.from_conn_string(config.DATABASE_URL) as saver:
            saver.setup()
            app.state.graph = build_graph(saver)
            audit_worker.start()
            try:
                yield
            finally:
                audit_worker.stop()
    finally:
        db.close_pool()



app = FastAPI(title='Second Space API', version='0.2.0', lifespan=lifespan)


SUPERVISED_OPS = {'review', 'listing', 'pricing', 'recommend', 'quote', 'purchase', 'property', 'advance', 'conflict', 'policy'}


def record_supervision_block(command, op, reason):
    # The blocked transaction was rolled back; keep the supervision decision for the audit trail.
    with db.transaction() as (_, s):
        d.audit(s, 'BusinessRules', reason, command.payload.get('orderId', ''))
        s['audit'][-1]['execution'] = {'requestId': command.requestId, 'operation': op,
                                       'steps': [{'agent': 'BusinessRules', 'mode': 'outcome_check', 'summary': reason, 'modelCall': 'not_called'}]}
        audit_worker.enqueue(_,s['audit'][-1]['id'],op,command.payload.get('orderId',''),s['audit'][-1]['execution'],committed=False)
    audit_worker.notify()


def record_agent_failure(command, exc):
    # No business transaction has committed. Persist only the sanitized failure trace.
    with db.transaction() as (failure_conn, s):
        d.audit(s, 'System', '请求未完成，业务未提交，请重试。',command.get('payload',{}).get('orderId',''))
        s['audit'][-1]['execution'] = {'requestId':command.get('requestId') or d.uid('FAILED'), 'operation':command.get('operation','report'), 'action':command.get('payload',{}).get('action'), 'steps':exc.steps}
        audit_worker.enqueue(failure_conn,s['audit'][-1]['id'],command.get('operation','report'),command.get('payload',{}).get('orderId',''),s['audit'][-1]['execution'],committed=False)
    audit_worker.notify()


@app.exception_handler(AgentUnavailable)
async def agent_unavailable(request, exc):
    try:
        command=await request.json()
    except Exception:
        command={}
    record_agent_failure(command, exc)
    return JSONResponse(status_code=503, content={'detail':str(exc), 'retryable':True})


@app.exception_handler(d.BusinessError)
async def business_error(request, exc):
    return JSONResponse(status_code=409, content={'detail': str(exc)})


class Action(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation: str
    payload: dict = Field(default_factory=dict)
    requestId: str = Field(min_length=8, max_length=100)


def role(request):
    # Intentionally selected demo role, not production authentication.
    if not config.DEMO_MODE:
        raise HTTPException(503, 'This MVP requires demo identities; production authentication is not configured.')
    name = request.headers.get('X-Demo-Role', 'buyer')
    if name not in ['buyer', 'seller', 'manager', 'property']:
        raise HTTPException(403, 'Unknown demo role')
    return name



PHOTO_POLICY_MESSAGE='上传图片不符合平台政策'
def public_photo_errors(value):
    from .review_messages import review_status, MESSAGES, CATEGORY_MESSAGE
    assessment=value.get('assessment') or {}
    status=review_status(assessment) if assessment else value.get('status')
    errors=value.get('errors',{})
    if assessment:value['reviewStatus']=status
    # The reviewer's short reason and suggestion (already length-limited and cleaned) are shown
    # to the seller as-is; service problems still use the fixed retry messages.
    feedback=assessment.get('feedback') if status=='photo_rejected' else None
    if feedback:value['feedback']=feedback
    for key,text in list(errors.items()):
        if key=='category' and str(text).startswith('照片'):
            errors[key]=CATEGORY_MESSAGE
        elif key in {'front','top','side','details'}:
            if feedback:continue
            if status in MESSAGES:errors[key]=MESSAGES[status]
            elif status=='category_mismatch':errors[key]=MESSAGES['photo_rejected']
    if 'screenReason' in value and errors:value['screenReason']='；'.join(dict.fromkeys(errors.values()))
    return value


def visible(s, actor, token=''):
    view = deepcopy(s)
    if actor == 'property':
        view['orders'] = [dict(id=o['id'], item={k: o['item'][k] for k in ['name', 'width', 'depth', 'height']},
                               expected=o.get('expected'), access={'movers': o.get('access', {}).get('movers', 2)},
                               requests=[r for r in o['requests'] if r['token'] == token])
                          for o in s['orders'] if any(r['token'] == token for r in o['requests'])]
        for key in ['items', 'quotes', 'audit', 'policies', 'exceptions']:
            view[key] = []
    elif actor != 'manager':
        view['audit'] = []
        view['policies'] = []
        view['exceptions'] = []
        for o in view['orders']:
            for event in o['events']:
                event['agent'] = '系统消息'
                event.pop('execution', None)
                event.pop('facts', None)
            o.pop('graphThread', None)
            o.pop('logisticsCoordination',None)
            o.pop('policyHandling',None)
        for i in view['items']:
            public_photo_errors(i)
            i.pop('assessment', None)
    if actor == 'manager':
        view['attention'] = supervision.stalls(s)
    view.pop('agentAudit',None)
    view.pop('policyArchive', None)
    view.pop('legacyArchive', None)
    return view


@app.get('/api/health')
def health():
    with db.connect() as conn, db.autocommit(conn):
        conn.execute('SELECT 1')
    return {'status': 'ok', 'database': 'postgresql', 'model': config.MODEL_NAME, 'modelMode': config.MODEL_MODE, 'modelConnectivity': 'not checked by health endpoint'}


_audit_queue = {'at': 0.0, 'value': None}
_audit_queue_lock = threading.Lock()


@app.get('/api/agent-activity')
def agent_activity(request: Request):
    """Read-only live Agent board for the manager overview. Never runs agents or mutates state."""
    if role(request) != 'manager':
        raise HTTPException(403, 'Action not allowed for this demo role')
    with _audit_queue_lock:
        if time.monotonic() - _audit_queue['at'] > 5:
            try:
                with db.connect() as conn, db.autocommit(conn):
                    rows = conn.execute('SELECT status, count(*) AS n FROM agent_audit_jobs GROUP BY status').fetchall()
                _audit_queue['value'] = {r['status']: r['n'] for r in rows}
            except Exception:
                logging.exception('Reading audit queue counts failed')
                _audit_queue['value'] = None
            _audit_queue['at'] = time.monotonic()
        queue_counts = _audit_queue['value']
    return {**progress.activity(), 'auditQueue': queue_counts}


@app.get('/api/state')
def state(request: Request):
    return visible(db.snapshot(), role(request), request.headers.get('X-Property-Token', ''))


def permissions(actor, operation, payload):
    allowed = {'listing': ['seller'], 'review': ['seller'], 'pricing': ['seller'], 'recommend': ['buyer'],
               'quote': ['buyer'], 'purchase': ['buyer'], 'property': ['property'],
               'policy': ['manager'], 'report': ['manager'], 'discard_quotes': ['buyer'],
               'advance': ['buyer', 'seller', 'manager'], 'tick': ['buyer', 'seller', 'manager'],
               'reset': ['buyer', 'seller', 'manager'], 'conflict': ['buyer', 'seller', 'manager']}
    if actor not in allowed.get(operation, []):
        raise HTTPException(403, 'Action not allowed for this demo role')
    if operation == 'advance' and payload.get('action') in ['confirm', 'issue'] and actor != 'buyer':
        raise HTTPException(403, 'Buyer acceptance requires the buyer demo role')


def validate_payload(op, p):
    required = {'listing': {'form': dict}, 'review': {'form': dict}, 'pricing': {'form': dict}, 'recommend': {'profile': dict},
                'quote': {'itemId': str, 'delivery': dict}, 'purchase': {'quoteId': str, 'method': str},
                'advance': {'orderId': str, 'action': str}, 'property': {'token': str, 'reply': dict},
                'policy': {'caseId': str, 'reason': str}, 'conflict': {'orderId': str}, 'tick': {'days': (int, float)}}
    if any(not isinstance(p.get(k), kind) for k, kind in required.get(op, {}).items()):
        raise HTTPException(422, 'Missing or invalid action fields')
    if len(json.dumps(p)) > 200000:
        raise HTTPException(413, 'Action payload too large')


def result_view(result, actor):
    result = deepcopy(result)
    if actor == 'property':
        return True
    if actor != 'manager' and isinstance(result, dict):
        public_photo_errors(result)
        result.pop('assessment', None)
        result.pop('graphThread', None)
        result.pop('logisticsCoordination',None)
        result.pop('policyHandling',None)
        for event in result.get('events', []):
            event['agent'] = '系统消息'
            event.pop('execution', None)
            event.pop('facts', None)
    return result


def graph_context(s, operation, payload, progress_id=None):
    snapshot={k:deepcopy(s[k]) for k in ('now','items','orders','quotes','policies','exceptions')}
    snapshot['audit']=[]
    for order in snapshot['orders']:
        order['events']=[]
    context={'now': s['now'], 'snapshot': snapshot, 'deadline':time.monotonic()+150,
             'hasPolicy': any(p['id'] == 'P-EXTRA' and p['active'] for p in s['policies'])}
    if progress_id:
        context['progressId']=progress_id
    if operation in ('listing','pricing','review') and isinstance((payload or {}).get('form'),dict):
        # A review that already passed for these exact photos/fields is reused, not re-sent to the model.
        prior=review_cache.get(payload['form'])
        if prior:
            context['priorAssessment']=prior
    return context


def ensure_media(form):
    photos = form.get('photos') or {}
    if not isinstance(photos, dict) or not isinstance(photos.get('details', []), list):
        raise d.BusinessError('照片资料格式无效。')
    for entry in [photos.get(k) for k in ['front', 'top', 'side']] + photos.get('details', []):
        if entry is not None and (not isinstance(entry, dict) or not isinstance(entry.get('ref'), str)):
            raise d.BusinessError('照片资料格式无效。')
    refs = [(form.get('photos', {}).get(k) or {}).get('ref') for k in ['front', 'top', 'side']]
    refs += [p.get('ref') for p in form.get('photos', {}).get('details', [])]
    for ref in filter(None, refs):
        if config.DEMO_MODE and ref in ['/images/sofa.jpg', '/images/bed.jpg', '/images/chair.jpg', '/images/table.jpg']:
            continue
        if not ref.startswith('/api/media/') or not (config.UPLOAD_DIR / Path(ref).name).is_file():
            raise d.BusinessError('照片未上传或不存在，请重新上传。')


def dispatch(conn, s, operation, p, proposal, thread_id):
    if operation == 'listing':
        ensure_media(p['form'])
        assessment = proposal.get('result', {}).get('assessment')
        if assessment is None:
            raise d.BusinessError('图片审核暂时无法完成，请稍后重新提交。')
        return d.save_listing(s, p['form'], p.get('id'), assessment)
    if operation == 'review':
        # Review only: nothing is published or saved; the seller continues to pricing/submission.
        from .review_messages import review_status
        assessment = proposal.get('result', {}).get('assessment')
        if assessment is None:
            raise d.BusinessError('图片审核暂时无法完成，请稍后重新提交。')
        review_cache.put(p['form'], assessment)
        return {'status': review_status(assessment), 'approved': not assessment.get('errors'),
                'errors': dict(assessment.get('errors') or {}), 'warnings': list(assessment.get('warnings') or []),
                'feedback': assessment.get('feedback'), 'assessment': assessment}
    if operation == 'pricing':
        review_cache.put(p['form'], proposal.get('result', {}).get('assessment'))
        return proposal['result']['pricing']
    if operation == 'recommend':
        result = d.recommend(s, p['profile'], proposal['result']['tags'])
        s['profile'] = p['profile']
        return result
    if operation == 'quote':
        return d.create_quote(s, p['itemId'], p['delivery'])
    if operation == 'purchase':
        if set(p) - {'quoteId', 'method'}:
            raise d.BusinessError('不接收或保存银行卡资料。')
        return d.purchase(s, p['quoteId'], p['method'])
    if operation == 'advance':
        result=d.advance(s, p['orderId'], p['action'], p.get('data'))
        if p['action']=='book':
            result['logisticsCoordination']=coordination_plan(result,'book')
        return result
    if operation == 'property':
        result=d.property_reply(s, p['token'], p['reply'])
        result['logisticsCoordination']=coordination_plan(result,'property')
        return result
    if operation == 'discard_quotes':
        s['quotes'] = [q for q in s['quotes'] if q['consumed'] or (p.get('itemId') and q['itemId'] != p['itemId'])]
        return True
    if operation == 'tick':
        value = d.number(p.get('days'))
        if not math.isfinite(value) or not 0 < value <= 36500:
            raise d.BusinessError('无效时间增量。')
        demo_clock.jump(s, round(value * d.DAY))
        d.audit(s, 'DemoClock', f'演示时钟推进 {value:g} 天')
        return True
    if operation == 'reset':
        conn.execute('DELETE FROM agent_audit_jobs')
        conn.execute('DELETE FROM settlements')
        conn.execute('DELETE FROM payments')
        conn.execute('DELETE FROM command_receipts')
        s.clear()
        s.update(db.seed())
        return True
    if operation == 'conflict':
        o = d.find(s['orders'], p['orderId'])
        if o['status'] != 'pending':
            raise d.BusinessError('当前阶段不能变更配送方案。')
        o['providerAccepted'] = False
        if proposal.get('result',{}).get('conflictResolution')=='policy':
            policy=proposal['result'].get('policyEvidence',{})
            active=[v for v in s['policies'] if v['id']=='P-EXTRA' and v['active']]
            if len(active)!=1 or any(active[0].get(k)!=policy.get(k) for k in ('id','version')):
                raise d.BusinessError('政策已变化，请重新处理该冲突。')
            direction = proposal['result'].get('policyDirection', 'pricing')
            label = f"按政策 {policy.get('id')} v{policy.get('version')} 自动处理，不升级经营者："
            if direction == 'logistics':
                # Demo compromise: the decision is recorded; amounts and settlement split are unchanged.
                o['policyHandling'] = dict(policy=policy, direction=direction, platformAbsorbs=25, simulated=True, time=s['now'])
                d.audit(s, 'SupervisionAgent', label + '接受替代配送方案，额外 $25 由平台承担（模拟记录，不改变实际分账）。', o['id'])
            else:
                o['policyHandling'] = dict(policy=policy, direction=direction, time=s['now'])
                d.audit(s, 'SupervisionAgent', label + '买家总价不变，请承运方提供不加价的替代方案。', o['id'])
            return {'handledByPolicy': True,'policy':policy,'direction':direction}
        existing = next((x for x in s['exceptions'] if x['orderId'] == o['id'] and x['status'] == 'open'), None)
        options = proposal.get('result', {}).get('escalation', {}).get('options', [])
        if existing:
            existing.setdefault('graphThread', thread_id)
            if options and not existing.get('options'):
                existing['options'] = options
            return existing
        ex = dict(id=d.uid('EX'), orderId=o['id'], status='open', title='承运方成本与固定总价冲突',
                  a='LogisticsAgent：承运方要求增加 $25。', b='PricingAgent：已接受总价不可增加。',
                  evidence='模拟新报价与原固定报价', gap='额外成本分配无适用政策。', created=s['now'], graphThread=thread_id,
                  options=options)
        s['exceptions'].append(ex)
        return ex
    if operation == 'policy':
        return d.policy_decision(s, p['caseId'], p['reason'], p.get('direction') or 'pricing')
    raise d.BusinessError('未知操作。')


@app.post('/api/actions')
def action(command: Action, request: Request):
    # Clients that accept NDJSON get live step progress; everyone else gets the usual JSON.
    if 'application/x-ndjson' in request.headers.get('accept', ''):
        return stream_action(command, request)
    return execute_action(command, request)


def stream_action(command, request, execute=None):
    events = queue.Queue()
    pid = command.requestId
    progress.register(pid, events)

    def work():
        try:
            events.put({'type': 'result', **(execute(pid) if execute else execute_action(command, request, progress_id=pid))})
        except AgentUnavailable as exc:
            try:
                record_agent_failure(command.model_dump(), exc)
            except Exception:
                logging.exception('Recording AI failure trace failed')
            events.put({'type': 'error', 'status': 503, 'detail': str(exc), 'retryable': True})
        except d.BusinessError as exc:
            if getattr(exc,'steps',None):
                record_agent_failure(command.model_dump(),exc)
            events.put({'type': 'error', 'status': 409, 'detail': str(exc)})
        except HTTPException as exc:
            events.put({'type': 'error', 'status': exc.status_code, 'detail': exc.detail})
        except Exception:
            logging.exception('Streaming action failed')
            events.put({'type': 'error', 'status': 500, 'detail': '服务暂时不可用，请稍后重试。'})
        finally:
            progress.unregister(pid)
            events.put(None)

    # The action keeps running to completion even if the client disconnects (cancel only stops
    # the client waiting); commits stay atomic and request receipts prevent duplicates.
    threading.Thread(target=work, name='action-' + pid[:12], daemon=True).start()

    def lines():
        while True:
            item = events.get()
            if item is None:
                return
            yield json.dumps(item, ensure_ascii=False, default=str) + '\n'

    return StreamingResponse(lines(), media_type='application/x-ndjson',
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


def execute_action(command, request, progress_id=None):
    actor = role(request)
    op, p = command.operation, command.payload
    permissions(actor, op, p)
    validate_payload(op, p)
    if op == 'property' and p.get('token') != request.headers.get('X-Property-Token'):
        raise HTTPException(403, 'Property token mismatch')
    # Reject payment details BEFORE creating graph checkpoints or audit records.
    if op == 'purchase' and set(p) - {'quoteId', 'method'}:
        raise HTTPException(422, 'Payment form fields must not be transmitted.')
    if op in ['listing','pricing','review']:
        ensure_media(p.get('form', {}))
    fingerprint = sha256(json.dumps([actor, op, p], sort_keys=True).encode()).hexdigest()
    with db.connect() as conn:
        receipt = conn.execute('SELECT * FROM command_receipts WHERE id=%s', (command.requestId,)).fetchone()
    if receipt:
        if receipt['request_hash'] != fingerprint:
            raise HTTPException(409, 'Request identifier already used for different input')
        return {'result': result_view(receipt['result'], actor), 'state': visible(db.snapshot(), actor, p.get('token', ''))}
    direct_delivery_event = op=='advance' and p.get('action') in ('pickup','deliver')
    # A carrier fact must not queue behind slow model work or require a graph checkpoint.
    snapshot = None if direct_delivery_event else db.snapshot()
    thread_id = command.requestId + ':' + fingerprint[:16]
    proposal = {}
    if direct_delivery_event:
        proposal={'decisions':[dict(agent='System',mode='delivery_event',modelCall='not_called',
                                    summary='校验并记录'+('取货' if p['action']=='pickup' else '送达')+'模拟事件。')], 'result':{}}
    elif op in ['listing', 'review', 'pricing', 'recommend', 'quote', 'purchase', 'property', 'advance', 'conflict']:
        # Serializing graph use avoids sharing the PostgresSaver connection concurrently.
        with graph_lock:
            proposal = app.state.graph.invoke({'operation': op, 'payload': p, 'context': graph_context(snapshot, op, p, progress_id), 'queue': route_for(op,p), 'cursor': 0, 'decisions': [], 'result': {}, 'human': {}, 'needs_human': False,'conflictProcessed':False}, {'configurable': {'thread_id': thread_id}})
    elif op == 'policy':
        ex = d.find(snapshot['exceptions'], p['caseId'])
        if ex['status'] != 'open' or not str(p.get('reason', '')).strip():
            raise d.BusinessError('该案件已处理或处理理由为空。')
        if p.get('direction') not in (None, *d.POLICY_DIRECTIONS):
            raise d.BusinessError('请选择支持哪一方的处理方向。')
        thread_id = ex.get('graphThread') or 'case-' + ex['id']
        options = {'configurable': {'thread_id': thread_id}}
        with graph_lock:
            current = app.state.graph.get_state(options)
            if not (current.values and 'HumanReview' in (current.next or ())):
                # No review is paused on this thread (sample case, reset data or a finished thread):
                # run the conflict review again on a fresh thread so it can pause for the founder.
                if current.values:
                    thread_id = 'case-' + ex['id'] + '-' + d.uid('R')
                    options = {'configurable': {'thread_id': thread_id}}
                app.state.graph.invoke({'operation': 'conflict', 'payload': {'orderId': ex['orderId']}, 'context': graph_context(snapshot,'conflict',p,progress_id), 'cursor': 0, 'decisions': []}, options)
                if 'HumanReview' not in (app.state.graph.get_state(options).next or ()):
                    raise d.BusinessError('该冲突现在可按现行政策处理，请刷新页面后重试。')
            # Resume the paused review with the founder's reason. update_state is not used here: it
            # re-runs the last node's routing and fails when that route no longer matches.
            proposal = app.state.graph.invoke(Command(resume={'reason': p['reason']}), options)
            if not proposal.get('human'):
                raise d.BusinessError('人工决策尚未完成。')
            # A human may reply days later: the commit checks below use a fresh request budget.
            proposal['context'] = graph_context(snapshot, 'conflict', p, progress_id)
    if op in ('quote','purchase','property','advance') and not direct_delivery_event and proposal.get('result',{}).get('preparedCommand') != command_key(op,p):
        raise AgentUnavailable(proposal.get('decisions',[]))
    if time.monotonic() >= proposal.get('context',{}).get('deadline',float('inf')):
        raise AgentUnavailable(proposal.get('decisions',[]))
    save_key = progress.new_key('commit')
    progress.emit(progress_id, save_key, '保存结果与账本（提交后生效）', 'running')
    try:
        with db.transaction() as (conn, s):
            # Recheck after graph computation: a competing buyer may have purchased meanwhile.
            if time.monotonic() >= proposal.get('context',{}).get('deadline',float('inf')):
                raise AgentUnavailable(proposal.get('decisions',[]))
            existing = conn.execute('SELECT * FROM command_receipts WHERE id=%s', (command.requestId,)).fetchone()
            if existing:
                if existing['request_hash'] != fingerprint:
                    raise HTTPException(409, 'Request identifier conflict')
                result = existing['result']
            else:
                event_counts = {o['id']: len(o['events']) for o in s['orders']}
                audit_start = len(s['audit'])
                before_status = {o['id']: o['status'] for o in s['orders']}
                with progress.request_scope(progress_id):
                    try:
                        result = dispatch(conn, s, op, p, proposal, thread_id)
                    except d.BusinessError as exc:
                        if direct_delivery_event:
                            exc.steps=[dict(agent='System',mode='delivery_event_rejected',modelCall='not_called',
                                            summary='模拟配送事件未通过既有条件校验，状态未更新。')]
                        raise
                if op in SUPERVISED_OPS:
                    # Mandatory application checks run on every result; SupervisionAgent handles conflicts only.
                    check_key = progress.new_key('check')
                    progress.emit(progress_id, check_key, '业务规则校验', 'running')
                    check, result = supervision.check_outcome(op, p, result, s, before_status)
                    check['agent']='BusinessRules'
                    proposal.setdefault('decisions', []).append(check)
                    progress.emit(progress_id, check_key, '业务规则校验', 'done', check['durationMs'])
                execution = {'requestId': command.requestId, 'operation': op, 'action': p.get('action'), 'steps': proposal.get('decisions', [])}
                if op != 'reset':
                    for record in s['audit'][audit_start:]:
                        if direct_delivery_event:
                            record['agent']='System'
                        record['execution'] = execution
                for order in (s['orders'] if op != 'reset' else []):
                    for event in order['events'][event_counts.get(order['id'], 0):]:
                        if direct_delivery_event:
                            event['agent']='System'
                        event['execution'] = execution
                for decision in proposal.get('decisions', []):
                    d.audit(s, decision['agent'], decision['summary'] + ' [' + decision['mode'] + ']', p.get('orderId') or (result.get('id', '') if isinstance(result, dict) else ''))
                    s['audit'][-1]['execution'] = execution
                if op in SUPERVISED_OPS:
                    object_id=p.get('orderId') or (result.get('id','') if isinstance(result,dict) else '')
                    audit_worker.enqueue(conn,command.requestId,op,object_id,execution)
                conn.execute('INSERT INTO command_receipts VALUES (%s,%s,%s)', (command.requestId, fingerprint, Jsonb(result)))
            response = {'result': result, 'state': visible(s, actor, p.get('token', ''))}
    except supervision.Violation as exc:
        record_supervision_block(command, op, str(exc))
        raise
    progress.emit(progress_id, save_key, '保存结果与账本（提交后生效）', 'done')
    # Do not leak internal agent identifiers through returned order results either.
    response['result'] = result_view(response['result'], actor)
    if op in SUPERVISED_OPS:
        audit_worker.notify()
    return response


@app.get('/api/reports')
def reports(request: Request, start: str, end: str):
    if role(request) != 'manager':
        raise HTTPException(403)
    from datetime import date
    try:
        if date.fromisoformat(start) > date.fromisoformat(end):
            raise ValueError()
    except ValueError:
        raise HTTPException(422, 'Invalid date range')
    if 'application/x-ndjson' in request.headers.get('accept', ''):
        command = Action(operation='report', payload={}, requestId=d.uid('REPORT'))
        return stream_action(command, request, execute=lambda pid: {'result': generate_report(start, end, pid)})
    return generate_report(start, end)


def report_totals(s, start, end):
    """Database-derived totals for one date window (Sydney dates, inclusive). Read-only."""
    rows = [o for o in s['orders'] if start <= d.day(o['created']) <= end]
    settled = [o for o in s['orders'] if o.get('settledAt') and start <= d.day(o['settledAt']) <= end]
    income = sum(d.cents(Decimal(str(o['item']['price'])) * Decimal('.02')) + d.cents(Decimal(str(o['deliveryFee'])) * Decimal('.1')) for o in settled)
    return dict(count=len(rows), sales=sum(d.cents(o['item']['price']) for o in rows) / 100, income=income / 100,
                held=sum(d.cents(o['total']) for o in rows if o['held']) / 100, completed=len(settled),
                conflicts=sum(1 for e in s['exceptions'] if e.get('created') and start <= d.day(e['created']) <= end),
                stages={k: sum(o['status'] == k for o in rows) for k in ['pending', 'transit', 'received', 'settled']})


def generate_report(start, end, progress_id=None):
    with progress.step('审计：读取数据库订单与结算记录', progress_id):
        s = db.snapshot()
    with progress.step('审计：按查询日期汇总订单、收入与留置资金', progress_id):
        result = report_totals(s, start, end)
        # The equal-length window just before the query, for "vs previous period" comparisons.
        from datetime import date, timedelta
        first, last = date.fromisoformat(start), date.fromisoformat(end)
        span = (last - first).days + 1
        result['previous'] = report_totals(s, (first - timedelta(days=span)).isoformat(), (first - timedelta(days=1)).isoformat())
        result['heldNow'] = sum(d.cents(o['total']) for o in s['orders'] if o['held']) / 100
        result['openConflicts'] = sum(e.get('status') == 'open' for e in s['exceptions'])
    report_id=d.uid('REPORT')
    result['reportId'] = report_id
    with progress.step('审计：整理经营汇总', progress_id):
        with graph_lock:
            proposal=app.state.graph.invoke({'operation': 'report', 'context': {**graph_context(s,'report',{},progress_id),'report':result}, 'cursor': 0, 'decisions': [],'result':{}}, {'configurable': {'thread_id':report_id}})
    with progress.step('审计：保存报告查询记录', progress_id):
        with db.transaction() as (report_conn, current):
            d.audit(current,'AuditReportingAgent','经营报表查询完成。')
            current['audit'][-1]['execution']={'requestId':report_id,'operation':'report','steps':proposal.get('decisions',[])}
            audit_worker.enqueue(report_conn,report_id,'report','',current['audit'][-1]['execution'])
    audit_worker.notify()
    return result


@app.post('/api/media')
def upload(request: Request, file: UploadFile = File(...)):
    if role(request) != 'seller':
        raise HTTPException(403)
    extension = Path(file.filename or '').suffix.lower()
    if extension not in ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']:
        raise HTTPException(422, '支持 JPEG、PNG、WebP、HEIC 格式')
    data = file.file.read(15 * 1024 * 1024 + 1)
    if not data or len(data) > 15 * 1024 * 1024:
        raise HTTPException(422, '单张照片不能超过 15 MB，且不能为空')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                image.thumbnail((1600, 1600))
                preview = io.BytesIO()
                image.convert('RGB').save(preview, 'JPEG', quality=85)
    except Exception:
        raise HTTPException(422, '图片无法读取，请选择有效照片。')
    identifier = d.uid('IMG')
    (config.UPLOAD_DIR / (identifier + extension + '.original')).write_bytes(data)
    (config.UPLOAD_DIR / (identifier + '.jpg')).write_bytes(preview.getvalue())
    result = {'ref': '/api/media/' + identifier + '.jpg', 'name': file.filename, 'size': len(data)}
    with db.connect() as conn:
        conn.execute('INSERT INTO media VALUES (%s,%s)', (identifier, Jsonb(result)))
    return result


@app.get('/api/media/{filename}')
def media(filename: str):
    if not filename.startswith('IMG-') or not filename.endswith('.jpg') or Path(filename).name != filename:
        raise HTTPException(404)
    path = config.UPLOAD_DIR / filename
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type='image/jpeg')


@app.post('/api/delivery-options')
def delivery_options(request: Request, payload: dict):
    if role(request)!='buyer':raise HTTPException(403,'Buyer only')
    address=payload.get('address')
    if not isinstance(address,str) or not 5<=len(address.strip())<=250:raise HTTPException(422,'Please enter a delivery address')
    state=db.snapshot();item=d.find(state['items'],payload.get('itemId'))
    if not item or item['status']!='published':raise HTTPException(409,'Item unavailable')
    return [{'id':key,'name':value[0],**d.delivery_price(item['pickup'],address,key)} for key,value in d.PROVIDERS.items()]
