"""Persistent external reference data, independent from the demo reset."""
from psycopg.types.json import Jsonb
from . import database as db

def store(category, rows):
    with db.connect() as conn:
        for row in rows:
            conn.execute('INSERT INTO market_reference(id,category,payload) VALUES (%s,%s,%s) ON CONFLICT(id) DO UPDATE SET category=EXCLUDED.category,payload=EXCLUDED.payload,observed_at=now()',
                         (row['id'],category,Jsonb(row)))
    return len(rows)

def reference_rows(category):
    with db.connect() as conn:
        rows=conn.execute("SELECT payload,observed_at FROM market_reference WHERE category=%s AND observed_at >= now()-interval '30 days' ORDER BY observed_at DESC,id LIMIT 150",(category,)).fetchall()
    return [dict(r['payload'],observedAt=r['observed_at'].isoformat()) for r in rows]
