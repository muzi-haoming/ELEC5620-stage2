import os
from pathlib import Path
import sys
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from urllib.parse import urlsplit, urlunsplit
url = os.getenv('TEST_DATABASE_URL') or dotenv_values(ROOT / '.runtime/test.env').get('TEST_DATABASE_URL')
if not url:
    source = dotenv_values(ROOT / '.env').get('DATABASE_URL', '')
    parsed = urlsplit(source)
    if parsed.hostname not in {'localhost', '127.0.0.1'}:
        raise RuntimeError('Set TEST_DATABASE_URL to an isolated test database; never derive it from cloud credentials.')
    url = urlunsplit(parsed._replace(path='/secondspace_test'))
if urlsplit(url).path != '/secondspace_test':
    raise RuntimeError('Tests must use the isolated secondspace_test database.')
os.environ['DATABASE_URL'] = url
os.environ['MODEL_MODE'] = 'fixture'
os.environ['DEMO_MODE'] = 'true'
os.environ['UPLOAD_DIR'] = str(ROOT / '.runtime/test-uploads')

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import database as db


@pytest.fixture
def client():
    with TestClient(app) as client:
        with db.transaction() as (conn, s):
            conn.execute('DELETE FROM settlements')
            conn.execute('DELETE FROM payments')
            conn.execute('DELETE FROM command_receipts')
            s.clear()
            s.update(db.seed())
        yield client
