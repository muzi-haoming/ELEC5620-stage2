"""Short-lived cache of passed photo reviews, so a reviewed listing is not re-sent to the
vision model when the seller then asks for pricing or submits it unchanged.

Keyed by the fields the visual review actually looks at. Any change to those fields (or a
price-only change, which is ignored) produces a new key / reuses the old one respectively.
Server-side only; clients cannot inject a review result. Process-local, which suits the demo.
"""
import hashlib
import json
import threading
import time
from . import config

REVIEW_FIELDS = ('name', 'category', 'material', 'condition', 'age', 'width', 'depth', 'height', 'photos')
TTL_SECONDS = 30 * 60
MAX_ENTRIES = 200
REUSABLE_MODES = {'campus-qwen', 'explicit_demo_photos', 'test_fixture'}

_entries = {}
_lock = threading.Lock()


def key(form):
    subject = {k: (form or {}).get(k) for k in REVIEW_FIELDS}
    subject['_mode'] = config.MODEL_MODE  # a fixture review is never reused for a live request
    return hashlib.sha256(json.dumps(subject, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def put(form, assessment):
    if not assessment or assessment.get('errors') or assessment.get('mode') not in REUSABLE_MODES:
        return
    entry = {'mode': assessment.get('mode'), 'checks': assessment.get('checks'),
             'warnings': list(assessment.get('warnings') or []), 'stored': time.time()}
    with _lock:
        _entries[key(form)] = entry
        if len(_entries) > MAX_ENTRIES:
            for stale in sorted(_entries, key=lambda k: _entries[k]['stored'])[:len(_entries) - MAX_ENTRIES]:
                _entries.pop(stale, None)


def get(form):
    with _lock:
        entry = _entries.get(key(form))
        if entry and time.time() - entry['stored'] > TTL_SECONDS:
            _entries.pop(key(form), None)
            entry = None
    return dict(entry) if entry else None


def clear():
    with _lock:
        _entries.clear()
