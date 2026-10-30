"""Print the most recent listing review results with their full reasons (read-only).

Usage (repo root, venv active):  python scripts/last-reviews.py [count]
Sellers only see a generic photo message; the full reason is kept in the audit log.
"""
import os
import sys
from datetime import datetime
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
count = int(sys.argv[1]) if len(sys.argv) > 1 else 5
with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, connect_timeout=10) as conn:
    rows = conn.execute("""
        SELECT payload->>'time', payload->>'text'
        FROM audit_events
        WHERE payload->>'agent' = 'ListingAgent' AND (payload->>'text' LIKE '审核%%' OR payload->>'text' LIKE '资料与图片审核%%' OR payload->>'text' LIKE '拒绝上架%%')
        ORDER BY (payload->>'time')::bigint DESC
        LIMIT %s""", (count,)).fetchall()
if not rows:
    print('No listing review records found.')
for time, text in rows:
    print(datetime.fromtimestamp(int(time) / 1000).strftime('%Y-%m-%d %H:%M'), '|', text)
