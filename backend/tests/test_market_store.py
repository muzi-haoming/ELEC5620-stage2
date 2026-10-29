from app import database as db
from app.market_store import store, reference_rows


def test_references_survive_demo_reset_and_expire(client):
    category='test-reference-category'
    store(category,[{'id':'test-source-record','price':400,'title':'Used sofa'}])
    first=reference_rows(category)
    assert first[0]['price']==400 and first[0]['observedAt']
    with db.transaction() as (conn,state):
        state.clear()
        state.update(db.seed())
    assert reference_rows(category)[0]['price']==400
    with db.connect() as conn:
        conn.execute("UPDATE market_reference SET observed_at=now()-interval '31 days' WHERE id='test-source-record'")
    assert reference_rows(category)==[]
    store(category,[{'id':'test-source-record','price':450,'title':'Updated sofa'}])
    assert reference_rows(category)[0]['price']==450
    with db.connect() as conn:
        conn.execute("DELETE FROM market_reference WHERE id='test-source-record'")
