"""Per-request progress events for the streaming actions endpoint.

Events carry only step labels, status and durations: never prompts, model output, form
contents or credentials. Delivery to a client is a no-op unless a streaming request registered a
listener, so non-streaming calls and tests behave exactly as before.

Every step is also recorded in a small in-memory, read-only activity board (which Agent is
working on which step, and recent finished steps) for the manager's live "Agent 工作状态" panel.
The board never affects routing or business state and holds the same label-only fields.
"""
import itertools
import threading
import time
from collections import deque
from contextlib import contextmanager
from contextvars import ContextVar

_current = ContextVar('progress_request', default=None)


@contextmanager
def request_scope(pid):
    token = _current.set(pid)
    try:
        yield
    finally:
        _current.reset(token)


@contextmanager
def step(label, pid=None):
    """Observe actual work; done means this step returned, not that a transaction committed."""
    pid = pid or _current.get()
    key, started = new_key('work'), time.perf_counter()
    emit(pid, key, label, 'running')
    try:
        yield
    except Exception:
        emit(pid, key, label, 'failed', round((time.perf_counter() - started) * 1000))
        raise
    else:
        emit(pid, key, label, 'done', round((time.perf_counter() - started) * 1000))

# Names follow the Stage 1 report (Figure 5.2).
AGENT_LABELS = {
    'SupervisionAgent': '监督 Agent', 'ListingAgent': '审核 Agent', 'PricingAgent': '估价 Agent',
    'MatchingAgent': '推荐 Agent', 'LogisticsAgent': '物流 Agent', 'PaymentAgent': '收款 Agent',
    'AuditReportingAgent': '审计 Agent',
}
TASK_LABELS = {
    'ListingAgent': '审核照片与资料', 'PricingAgent': '估算建议售价', 'MatchingAgent': '解析偏好并筛选家具',
    'LogisticsAgent': '准备配送处理', 'PaymentAgent': '准备模拟付款与结算处理', 'AuditReportingAgent': '汇总经营数据',
}

_listeners = {}
_lock = threading.Lock()
_counter = itertools.count(1)


def register(progress_id, sink):
    with _lock:
        _listeners[progress_id] = sink


def unregister(progress_id):
    with _lock:
        _listeners.pop(progress_id, None)


def progress_id(state):
    return ((state or {}).get('context') or {}).get('progressId')


def new_key(prefix):
    return f'{prefix}-{next(_counter)}'


def emit(pid, key, label, status, ms=None):
    _record(pid, key, label, status, ms)
    if not pid:
        return
    with _lock:
        sink = _listeners.get(pid)
    if sink is None:
        return
    event = {'type': 'progress', 'key': key, 'label': label, 'status': status}
    if ms is not None:
        event['ms'] = ms
    sink.put(event)


def agent_label(name):
    return AGENT_LABELS.get(name, name)


def task_label(agent, operation=None):
    if agent == 'PricingAgent' and operation == 'quote':
        return agent_label(agent) + '：核对固定总价'
    return agent_label(agent) + '：' + TASK_LABELS.get(agent, '处理中')


# ---- Read-only activity board (manager panel) -------------------------------------------
# Label prefixes written by agents.py, agent_tools.run_tools and domain.py steps.
_PREFIX_AGENT = [('监督', 'SupervisionAgent'), ('审核', 'ListingAgent'), ('估价', 'PricingAgent'),
                 ('推荐', 'MatchingAgent'), ('物流', 'LogisticsAgent'), ('收款', 'PaymentAgent'),
                 ('付款', 'PaymentAgent'), ('结算', 'PaymentAgent'), ('审计', 'AuditReportingAgent')]
_RUNNING_TTL = 600  # a step still "running" after 10 minutes is treated as abandoned
_running = {}
_recent = deque(maxlen=40)
_last = {}


def agent_of(label):
    label = str(label or '')
    if label.startswith('业务规则校验'):
        return 'BusinessRules'
    head = label.split('：', 1)[0] if '：' in label else ''
    return next((agent for prefix, agent in _PREFIX_AGENT if head.startswith(prefix)), None)


def _record(pid, key, label, status, ms):
    agent = agent_of(label)
    if not agent:
        return
    now = time.time()
    with _lock:
        if status == 'running':
            _running[key] = dict(agent=agent, label=label, since=now, request=(pid or '')[-6:])
            return
        _running.pop(key, None)
        event = dict(agent=agent, label=label, status=status, at=now)
        if ms is not None:
            event['ms'] = ms
        _recent.append(event)
        _last[agent] = event


def activity():
    """Snapshot of the board: per-Agent current step, last finished step, and recent steps."""
    now = time.time()
    with _lock:
        for key in [k for k, v in _running.items() if now - v['since'] > _RUNNING_TTL]:
            _running.pop(key)
        running = list(_running.values())
        recent = list(_recent)[-20:][::-1]
        last = dict(_last)
    agents = {}
    for name in [*AGENT_LABELS, 'BusinessRules']:
        mine = sorted((r for r in running if r['agent'] == name), key=lambda r: r['since'])
        agents[name] = dict(status='working' if mine else 'idle', last=last.get(name),
                            task=mine[0]['label'] if mine else None, step=mine[-1]['label'] if mine else None,
                            since=mine[0]['since'] if mine else None,
                            requests=len({r['request'] for r in mine}))
    return dict(now=now, agents=agents, recent=recent)


def reset_activity():
    with _lock:
        _running.clear()
        _recent.clear()
        _last.clear()
