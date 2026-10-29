"""Free local address-zone estimate. These are demo tariff zones, not map distances."""
import re

ZONES=[
 ('central',0,['sydney','glebe','camperdown','usyd','fisher library','newtown','redfern','surry hills','ultimo','darlington','悉尼','悉尼大学']),
 ('inner_west',15,['burwood','ashfield','marrickville','strathfield','leichhardt']),
 ('east',20,['bondi','coogee','randwick','bronte']),
 ('north',30,['chatswood','manly','mosman','north sydney','hornsby']),
 ('west',40,['parramatta','auburn','ryde','epping']),
 ('far_west',70,['penrith','blacktown','mount druitt']),
 ('south',35,['hurstville','kogarah','sutherland','campsie'])]

def zone(address):
    text=' '.join(str(address).lower().split())
    # Specific suburb names precede generic Sydney; postcode is a secondary cue.
    for key,radial,names in ZONES[1:]:
        if any(re.search(r'(?<![a-z])'+re.escape(name)+r'(?![a-z])',text) for name in names):return key,radial,'suburb'
    match=re.search(r'\b(\d{4})\s*(?:australia|澳大利亚)?$',text)
    if match:
        code=int(match[1])
        if 2745<=code<=2770:return 'far_west',70,'postcode'
        if 2127<=code<=2159:return 'west',40,'postcode'
        if 2160<=code<=2199:return 'inner_west',15,'postcode'
        if 2200<=code<=2234:return 'south',35,'postcode'
        if 2060<=code<=2126:return 'north',30,'postcode'
        if 2021<=code<=2036:return 'east',20,'postcode'
        if 2000<=code<=2020 or 2037<=code<=2050:return 'central',0,'postcode'
    if any(name in text for name in ZONES[0][2]):return 'central',0,'suburb'
    return 'other',50,'fallback'

def delivery_price(pickup,delivery,provider):
    a,ar,am=zone(pickup);b,br,bm=zone(delivery)
    route=0 if a==b else max(ar,br)+min(ar,br)/2
    base=75 if provider=='economy' else 110
    surcharge=round(route*(1 if provider=='economy' else 1.2),2)
    return {'price':round(base+surcharge,2),'base':base,'routeSurcharge':surcharge,
            'pickupZone':a,'deliveryZone':b,'method':'address_zone_demo_v1','fallback':am=='fallback' or bm=='fallback'}
