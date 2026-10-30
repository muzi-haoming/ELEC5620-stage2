"""List database sessions that may be blocking writes; optionally end stuck ones.

Usage (from the repo root, with the venv active):
  python scripts/db-sessions.py          # list only
  python scripts/db-sessions.py --kill   # also end sessions idle in a transaction for > 30 s
"""
import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
kill = '--kill' in sys.argv
with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, connect_timeout=10) as conn:
    rows = conn.execute("""
        SELECT pid, state, now() - xact_start AS in_transaction, wait_event_type, left(query, 70) AS query
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        ORDER BY xact_start NULLS LAST""").fetchall()
    blocked = conn.execute("""
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'""").fetchone()[0]
    print(f'{len(rows)} other sessions, {blocked} waiting on a lock')
    for pid, state, age, wait, query in rows:
        print(f'pid={pid:<7} state={state or "-":<22} in_tx={age or "-"} wait={wait or "-"} | {query}')
    if kill:
        stuck = conn.execute("""
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND state LIKE 'idle in transaction%%' AND now() - xact_start > interval '30 seconds'""").fetchall()
        for (pid,) in stuck:
            ended = conn.execute('SELECT pg_terminate_backend(%s)', (pid,)).fetchone()[0]
            print(f'ended stuck session {pid}: {ended}')
        if not stuck:
            print('no stuck idle-in-transaction sessions found')
