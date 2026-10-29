from contextlib import contextmanager
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from psycopg.types.json import Jsonb
from . import config
from .domain import cents
from . import demo_clock

COLLECTIONS = {'items': 'listings', 'quotes': 'quotes', 'orders': 'orders', 'policies': 'policies', 'exceptions': 'cases', 'audit': 'audit_events'}


_pool = None


def open_pool():
    global _pool
    _pool = ConnectionPool(config.DATABASE_URL, min_size=2, max_size=6,
                           kwargs={'row_factory': dict_row, 'connect_timeout': 10},
                           timeout=20, open=False)
    _pool.open(wait=True, timeout=30)


def close_pool():
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connect():
    if _pool is not None:
        with _pool.connection() as conn:
            yield conn
    else:
        with psycopg.connect(config.DATABASE_URL, row_factory=dict_row, connect_timeout=10) as conn:
            yield conn


def seed():
    state=json.loads(Path(__file__).with_name('seed.json').read_text(encoding='utf-8'))
    demo_clock.start(state)
    return state


def setup():
    with connect() as conn:
        # One startup migration/seed writer even with multiple API processes.
        conn.execute('SELECT pg_advisory_xact_lock(5620001)')
        conn.execute((config.ROOT / 'migrations/001_initial.sql').read_text(encoding='utf-8'))
        conn.execute((config.ROOT / 'migrations/002_market.sql').read_text(encoding='utf-8'))
        if not conn.execute('SELECT 1 FROM app_meta WHERE id=1').fetchone():
            conn.execute('INSERT INTO app_meta VALUES (1,%s)', (Jsonb({}),))
            save(conn, seed())
        else:
            row=conn.execute('SELECT payload FROM app_meta WHERE id=1').fetchone()['payload']
            if not row.get('demoClock'):
                demo_clock.start(row)
                conn.execute('UPDATE app_meta SET payload=%s WHERE id=1',(Jsonb(row),))


def read(conn, lock=False):
    row = conn.execute('SELECT payload FROM app_meta WHERE id=1' + (' FOR UPDATE' if lock else '')).fetchone()
    s = deepcopy(row['payload'])
    ordering = s.pop('_ordering', {})
    query = ' UNION ALL '.join(f"SELECT '{key}' AS collection,id,payload FROM {table}" for key, table in COLLECTIONS.items())
    grouped = {key: {} for key in COLLECTIONS}
    for record in conn.execute(query).fetchall():
        grouped[record['collection']][record['id']] = record['payload']
    for key, values in grouped.items():
        s[key] = [values[k] for k in ordering.get(key, values.keys()) if k in values]
    demo_clock.advance(s)
    return s


def snapshot():
    with connect() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        return read(conn)


def save(conn, s):
    # Batch independent writes into one network round trip, preserving the transaction.
    with conn.pipeline():
        _save(conn, s)


def _save(conn, s):
    meta = {k: v for k, v in s.items() if k not in COLLECTIONS}
    meta['_ordering'] = {}
    for key, table in COLLECTIONS.items():
        rows = s[key]
        identifiers = [f"{r['id']}:{r['version']}" if key == 'policies' else r['id'] for r in rows]
        meta['_ordering'][key] = identifiers
        if identifiers:
            conn.execute(f'DELETE FROM {table} WHERE NOT (id = ANY(%s))', (identifiers,))
        else:
            conn.execute(f'DELETE FROM {table}')
        for identifier, row in zip(identifiers, rows):
            conn.execute(f'INSERT INTO {table}(id,payload) VALUES (%s,%s) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload', (identifier, Jsonb(row)))
    conn.execute('UPDATE app_meta SET payload=%s WHERE id=1', (Jsonb(meta),))
    for order in s['orders']:
        conn.execute('INSERT INTO payments VALUES (%s,%s,%s,%s) ON CONFLICT(order_id) DO NOTHING',
                     (order['paymentKey'], order['id'], cents(order['total']), order.get('method', 'Demo seed')))
        if order['status'] == 'settled':
            seller = cents(order['item']['price']) - cents(Decimal(str(order['item']['price'])) * Decimal('.02'))
            carrier = cents(order['deliveryFee']) - cents(Decimal(str(order['deliveryFee'])) * Decimal('.1'))
            conn.execute('INSERT INTO settlements VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT(order_id) DO NOTHING',
                         (order['payoutKey'], order['id'], seller, carrier, cents(order['total']) - seller - carrier, order['settledAt']))


@contextmanager
def transaction():
    with connect() as conn:
        state = read(conn, lock=True)
        yield conn, state
        save(conn, state)
