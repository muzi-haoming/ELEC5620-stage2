from app import demo_clock as clock
from app.delivery_pricing import delivery_price

def test_independent_runs_and_jumps():
    a={'now':1000};b={'now':1000}
    clock.start(a,100);clock.start(b,200)
    assert clock.advance(a,600)==1500
    assert clock.advance(b,600)==1400
    assert a['demoClock']['runId']!=b['demoClock']['runId']
    clock.jump(a,5000,600)
    assert clock.advance(a,1600)==7500
    assert clock.advance(b,1600)==2400
    restored={**a,'demoClock':dict(a['demoClock'])}
    assert clock.advance(restored,2600)==8500

def test_address_tariff_is_stable_and_uses_both_ends():
    central='Fisher Library USYD NSW 2006';far='Penrith NSW 2750';other='Chatswood NSW 2067'
    assert delivery_price(central,far,'economy')['price']==delivery_price(far,central,'economy')['price']
    assert delivery_price(central,far,'economy')['price']!=delivery_price(other,far,'economy')['price']
    assert delivery_price(central,central,'economy')['price']<delivery_price(central,far,'economy')['price']
