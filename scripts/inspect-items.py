"""List every furniture listing in the shared database and whether its photo exists on THIS
computer (read-only). Helps explain listings left after a reset and photos that do not load.

Usage (repo root, venv active):  python scripts/inspect-items.py
"""
import json
import os
from datetime import datetime
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
uploads = Path(os.getenv('UPLOAD_DIR', '.runtime/uploads'))
uploads = uploads if uploads.is_absolute() else ROOT / uploads
seed_ids = {i['id'] for i in json.loads((ROOT / 'backend/app/seed.json').read_text(encoding='utf-8'))['items']}

with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, connect_timeout=10) as conn:
    rows = [r[0] for r in conn.execute('SELECT payload FROM listings').fetchall()]

def photo_state(ref):
    if not ref:
        return 'no photo'
    if ref.startswith('/images/'):
        return 'demo image (always shows)'
    if ref.startswith('/api/media/'):
        return 'on this computer' if (uploads / Path(ref).name).is_file() else 'MISSING here (uploaded on another computer?)'
    return 'unknown reference'

rows.sort(key=lambda r: r.get('created', 0))
print(f'{len(rows)} listings in the database ({sum(r["id"] in seed_ids for r in rows)} from seed data)\n')
for r in rows:
    created = datetime.fromtimestamp(r['created'] / 1000).strftime('%Y-%m-%d %H:%M') if r.get('created') else '-'
    origin = 'seed' if r['id'] in seed_ids else 'added'
    print(f"{r['id']:<12} {origin:<5} {created}  {r.get('status', ''):<9} {r.get('name', '')[:24]:<24} | {photo_state(r.get('image'))}")
