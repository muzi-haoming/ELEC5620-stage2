"""Refresh anonymous public references. No marketplace credentials or model required."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app import database as db
from app.public_market import public_candidates
from app.market_store import store

def main():
    db.setup()
    total=0
    for category,query,section in [('沙发','fabric sofa','sofas'),('床','bed frame','beds-and-bedroom'),('其他','wood dining table','tables'),('其他','chair','seating'),('其他','cabinet','storage-and-cabinets')]:
        rows,failures=public_candidates(category,query,section)
        count=store(category,rows);total+=count
        print(section,count,'stored; unavailable sources:',len(failures),flush=True)
    with db.connect() as conn:
        print(conn.execute('SELECT category,count(*) AS count FROM market_reference GROUP BY category').fetchall())
    if not total:raise SystemExit('No public records were imported; previous records were preserved.')
if __name__=='__main__':main()
