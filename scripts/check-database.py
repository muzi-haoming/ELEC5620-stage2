"""Read-only connection check; never prints credentials or raw exception text."""
import argparse
import json
from pathlib import Path
from dotenv import dotenv_values
import psycopg

parser = argparse.ArgumentParser()
parser.add_argument('--env-file', default='.env')
args = parser.parse_args()
try:
    url = dotenv_values(Path(args.env_file))['DATABASE_URL']
    with psycopg.connect(url, connect_timeout=10) as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        database, version = conn.execute("SELECT current_database(), current_setting('server_version')").fetchone()
        tls = conn.execute('SELECT ssl, version FROM pg_stat_ssl WHERE pid=pg_backend_pid()').fetchone()
        count = conn.execute('SELECT count(*) FROM orders').fetchone()[0]
        print(json.dumps({'status': 'ok', 'database': database, 'version': version, 'tls': tls, 'orders': count}))
except Exception as exc:
    print(json.dumps({'status': 'failed', 'error': type(exc).__name__, 'sqlstate': getattr(exc, 'sqlstate', None)}))
    raise SystemExit(1)
