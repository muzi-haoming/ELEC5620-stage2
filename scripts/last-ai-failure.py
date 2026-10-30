"""Show the step-by-step trace of the most recent failed AI request (read-only).

Usage (repo root, venv active):  python scripts/last-ai-failure.py
Prints each agent step: which tool was chosen, whether the model call worked, the error class
and durations. No prompts, credentials or form contents are stored, so none are printed.
"""
import os
from datetime import datetime
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, connect_timeout=10) as conn:
    row = conn.execute("""
        SELECT payload FROM audit_events
        WHERE payload->>'text' LIKE 'AI 请求未完成%%'
        ORDER BY (payload->>'time')::bigint DESC LIMIT 1""", ()).fetchone()
if not row:
    print('No failed AI request recorded.')
    raise SystemExit
event = row[0]
execution = event.get('execution') or {}
print('Time:', datetime.fromtimestamp(int(event['time']) / 1000).strftime('%Y-%m-%d %H:%M:%S'))
print('Operation:', execution.get('operation'), '| request', execution.get('requestId'))
for n, step in enumerate(execution.get('steps') or [], 1):
    tools = ', '.join(f"{t.get('name')}={t.get('status')}" for t in step.get('tools') or [])
    print(f"{n:>2}. {step.get('agent')} | {step.get('mode')} | selected={step.get('selection', '-')} | "
          f"model={step.get('modelCall')} | error={step.get('errorClass', '-')} | "
          f"{step.get('modelDurationMs', step.get('durationMs', '-'))} ms | tools: {tools or '-'}")
