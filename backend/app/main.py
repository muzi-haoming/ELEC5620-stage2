from contextlib import asynccontextmanager
from copy import deepcopy
from decimal import Decimal
from hashlib import sha256
import io
import json
import math
import time
from pathlib import Path
from threading import Lock
import warnings
from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field, ConfigDict
from PIL import Image
from pillow_heif import register_heif_opener
from psycopg.types.json import Jsonb
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.types import Command
from . import config, database as db, domain as d, demo_clock
from .agents import build_graph, ROUTES
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
            yield
    finally:
        db.close_pool()



app = FastAPI(title='Second Space API', version='0.2.0', lifespan=lifespan)


@app.exception_handler(AgentUnavailable)
async def agent_unavailable(request, exc):
    # No business transaction has committed. Persist only the sanitized failure trace.
    try:
        command=await request.json()
    except Exception:
        command={}
    with db.transaction() as (_, s):
        d.audit(s, 'SupervisionAgent', 'AI 请求未完成，业务未提交，请重试。',command.get('payload',{}).get('orderId',''))
        s['audit'][-1]['execution'] = {'requestId':command.get('requestId') or d.uid('FAILED'), 'operation':command.get('operation','report'), 'steps':exc.steps}
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
    for key,text in list(errors.items()):
        if key=='category' and str(text).startswith('照片'):
            errors[key]=CATEGORY_MESSAGE
        elif key in {'front','top','side','details'}:
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
        for i in view['items']:
            public_photo_errors(i)
            i.pop('assessment', None)
    view.pop('policyArchive', None)
    view.pop('legacyArchive', None)
    return view


@app.get('/api/health')
def health():
    with db.connect() as conn:
        conn.execute('SELECT 1')
    return {'status': 'ok', 'database': 'postgresql', 'model': config.MODEL_NAME, 'modelMode': config.MODEL_MODE, 'modelConnectivity': 'not checked by health endpoint'}


@app.get('/api/state')
def state(request: Request):
    return visible(db.snapshot(), role(request), request.headers.get('X-Property-Token', ''))


def permissions(actor, operation, payload):
    allowed = {'listing': ['seller'], 'pricing': ['seller'], 'recommend': ['buyer'],
               'quote': ['buyer'], 'purchase': ['buyer'], 'property': ['property'],
               'policy': ['manager'], 'report': ['manager'], 'discard_quotes': ['buyer'],
               'advance': ['buyer', 'seller', 'manager'], 'tick': ['buyer', 'seller', 'manager'],
               'reset': ['buyer', 'seller', 'manager'], 'conflict': ['buyer', 'seller', 'manager']}
    if actor not in allowed.get(operation, []):
        raise HTTPException(403, 'Action not allowed for this demo role')
    if operation == 'advance' and payload.get('action') in ['confirm', 'issue'] and actor != 'buyer':
        raise HTTPException(403, 'Buyer acceptance requires the buyer demo role')


def validate_payload(op, p):
    required = {'listing': {'form': dict}, 'pricing': {'form': dict}, 'recommend': {'profile': dict},
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
        for event in result.get('events', []):
            event['agent'] = '系统消息'
            event.pop('execution', None)
            event.pop('facts', None)
    return result


def graph_context(s, operation, payload):
    snapshot={k:deepcopy(s[k]) for k in ('now','items','orders','quotes','policies','exceptions')}
    snapshot['audit']=[]
    for order in snapshot['orders']:
        order['events']=[]
    return {'now': s['now'], 'snapshot': snapshot, 'deadline':time.monotonic()+150,
            'hasPolicy': any(p['id'] == 'P-EXTRA' and p['active'] for p in s['policies'])}


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
    if config.MODEL_MODE == 'live' and operation in {'quote','purchase','advance','property','conflict'}:
        prepared=proposal.get('result',{}).get('prepared',{})
        if prepared != {'operation':operation,'action':p.get('action')}:
            raise AgentUnavailable(proposal.get('decisions',[]))
    if operation == 'listing':
        ensure_media(p['form'])
        assessment = proposal.get('result', {}).get('assessment')
        if assessment is None:
            raise d.BusinessError('图片审核暂时无法完成，请稍后重新提交。')
        return d.save_listing(s, p['form'], p.get('id'), assessment)
    if operation == 'pricing':
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
        return d.advance(s, p['orderId'], p['action'], p.get('data'))
    if operation == 'property':
        return d.property_reply(s, p['token'], p['reply'])
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
        if any(x['id'] == 'P-EXTRA' and x['active'] for x in s['policies']):
            d.audit(s, 'SupervisionAgent', '现行政策已自动处理，不升级经营者。', o['id'])
            return {'handledByPolicy': True}
        existing = next((x for x in s['exceptions'] if x['orderId'] == o['id'] and x['status'] == 'open'), None)
        if existing:
            existing.setdefault('graphThread', thread_id)
            return existing
        ex = dict(id=d.uid('EX'), orderId=o['id'], status='open', title='承运方成本与固定总价冲突',
                  a='LogisticsAgent：承运方要求增加 $25。', b='PricingAgent：已接受总价不可增加。',
                  evidence='模拟新报价与原固定报价', gap='额外成本分配无适用政策。', created=s['now'], graphThread=thread_id)
        s['exceptions'].append(ex)
        return ex
    if operation == 'policy':
        return d.policy_decision(s, p['caseId'], p['reason'])
    raise d.BusinessError('未知操作。')


@app.post('/api/actions')
def action(command: Action, request: Request):
    actor = role(request)
    op, p = command.operation, command.payload
    permissions(actor, op, p)
    validate_payload(op, p)
    if op == 'property' and p.get('token') != request.headers.get('X-Property-Token'):
        raise HTTPException(403, 'Property token mismatch')
    # Reject payment details BEFORE creating graph checkpoints or audit records.
    if op == 'purchase' and set(p) - {'quoteId', 'method'}:
        raise HTTPException(422, 'Payment form fields must not be transmitted.')
    if op in ['listing','pricing']:
        ensure_media(p.get('form', {}))
    fingerprint = sha256(json.dumps([actor, op, p], sort_keys=True).encode()).hexdigest()
    with db.connect() as conn:
        receipt = conn.execute('SELECT * FROM command_receipts WHERE id=%s', (command.requestId,)).fetchone()
    if receipt:
        if receipt['request_hash'] != fingerprint:
            raise HTTPException(409, 'Request identifier already used for different input')
        return {'result': result_view(receipt['result'], actor), 'state': visible(db.snapshot(), actor, p.get('token', ''))}
    snapshot = db.snapshot()
    thread_id = command.requestId + ':' + fingerprint[:16]
    proposal = {}
    if op in ['listing', 'pricing', 'recommend', 'quote', 'purchase', 'property', 'advance', 'conflict']:
        # Serializing graph use avoids sharing the PostgresSaver connection concurrently.
        with graph_lock:
            proposal = app.state.graph.invoke({'operation': op, 'payload': p, 'context': graph_context(snapshot, op, p), 'queue': ROUTES[op], 'cursor': 0, 'decisions': [], 'result': {}, 'human': {}, 'needs_human': False}, {'configurable': {'thread_id': thread_id}})
    elif op == 'policy':
        ex = d.find(snapshot['exceptions'], p['caseId'])
        if ex['status'] != 'open' or not str(p.get('reason', '')).strip():
            raise d.BusinessError('该案件已处理或处理理由为空。')
        thread_id = ex.get('graphThread') or 'case-' + ex['id']
        options = {'configurable': {'thread_id': thread_id}}
        with graph_lock:
            current = app.state.graph.get_state(options)
            if not current.values:
                app.state.graph.invoke({'operation': 'conflict', 'payload': {'orderId': ex['orderId']}, 'context': graph_context(snapshot,'conflict',p), 'cursor': 0, 'decisions': []}, options)
            else:
                # A human may reply days later; refresh snapshot and request budget.
                app.state.graph.update_state(options, {'context':graph_context(snapshot,'conflict',p)})
            proposal = app.state.graph.invoke(Command(resume={'reason': p['reason']}), options)
            if not proposal.get('human'):
                raise d.BusinessError('人工决策尚未完成。')
    with db.transaction() as (conn, s):
        # Recheck after graph computation: a competing buyer may have purchased meanwhile.
        existing = conn.execute('SELECT * FROM command_receipts WHERE id=%s', (command.requestId,)).fetchone()
        if existing:
            if existing['request_hash'] != fingerprint:
                raise HTTPException(409, 'Request identifier conflict')
            result = existing['result']
        else:
            event_counts = {o['id']: len(o['events']) for o in s['orders']}
            audit_start = len(s['audit'])
            result = dispatch(conn, s, op, p, proposal, thread_id)
            execution = {'requestId': command.requestId, 'operation': op, 'action': p.get('action'), 'steps': proposal.get('decisions', [])}
            if op != 'reset':
                for record in s['audit'][audit_start:]:
                    record['execution'] = execution
            for order in (s['orders'] if op != 'reset' else []):
                for event in order['events'][event_counts.get(order['id'], 0):]:
                    event['execution'] = execution
            for decision in proposal.get('decisions', []):
                d.audit(s, decision['agent'], decision['summary'] + ' [' + decision['mode'] + ']', p.get('orderId') or (result.get('id', '') if isinstance(result, dict) else ''))
                s['audit'][-1]['execution'] = execution
            conn.execute('INSERT INTO command_receipts VALUES (%s,%s,%s)', (command.requestId, fingerprint, Jsonb(result)))
        response = {'result': result, 'state': visible(s, actor, p.get('token', ''))}
    # Do not leak internal agent identifiers through returned order results either.
    response['result'] = result_view(response['result'], actor)
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
    s = db.snapshot()
    rows = [o for o in s['orders'] if start <= d.day(o['created']) <= end]
    income = sum(d.cents(Decimal(str(o['item']['price'])) * Decimal('.02')) + d.cents(Decimal(str(o['deliveryFee'])) * Decimal('.1')) for o in s['orders'] if o.get('settledAt') and start <= d.day(o['settledAt']) <= end)
    result = dict(count=len(rows), sales=sum(d.cents(o['item']['price']) for o in rows) / 100, income=income / 100,
                  held=sum(d.cents(o['total']) for o in rows if o['held']) / 100,
                  stages={k: sum(o['status'] == k for o in rows) for k in ['pending', 'transit', 'received', 'settled']})
    report_id=d.uid('REPORT')
    with graph_lock:
        proposal=app.state.graph.invoke({'operation': 'report', 'context': {**graph_context(s,'report',{}),'report':result}, 'cursor': 0, 'decisions': [],'result':{}}, {'configurable': {'thread_id':report_id}})
    with db.transaction() as (_, current):
        d.audit(current,'AuditReportingAgent','经营报表查询完成。')
        current['audit'][-1]['execution']={'requestId':report_id,'operation':'report','steps':proposal.get('decisions',[])}
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
