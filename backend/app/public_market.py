"""Anonymous, bounded public product-page discovery. No login or challenge bypass."""
import json
import re
import hashlib
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation
import httpx

HOSTS={'www.zirkly.com.au','www.melbourneusedsofas.com.au','www.cashconverters.com.au'}
class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]; self.json=[]; self.text=[]; self.kind=None; self.buffer=[]; self.hidden=0
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='a' and attrs.get('href'): self.links.append(attrs['href'])
        if tag in ('script','style'):
            self.hidden+=1
            if tag=='script' and attrs.get('type')=='application/ld+json': self.kind='json';self.buffer=[]
    def handle_data(self,data):
        if self.kind=='json':self.buffer.append(data)
        elif not self.hidden:self.text.append(data.strip())
    def handle_endtag(self,tag):
        if tag=='script' and self.kind=='json':
            try:self.json.append(json.loads(''.join(self.buffer)))
            except ValueError:pass
            self.kind=None
        if tag in ('script','style'):self.hidden=max(0,self.hidden-1)

def allowed(url):
    p=urlsplit(url)
    return p.scheme=='https' and p.hostname in HOSTS and p.port in (None,443)

def read(client,url):
    if not allowed(url):raise ValueError('Unapproved public source')
    # Do not follow arbitrary redirects or retry access challenges.
    with client.stream('GET',url) as r:
        r.raise_for_status()
        raw=bytearray()
        for chunk in r.iter_bytes():
            raw.extend(chunk)
            if len(raw)>2_000_000:raise ValueError('Oversized page')
    page=Page();page.feed(raw.decode('utf-8',errors='replace'));return page

def nodes(value):
    if isinstance(value,list):
        for v in value:yield from nodes(v)
    elif isinstance(value,dict):
        yield value
        yield from nodes(value.get('@graph',[]))

def product(page,url):
    for row in nodes(page.json):
        if row.get('@type')!='Product':continue
        offers=row.get('offers',{})
        if not isinstance(offers,dict):continue
        if offers.get('priceCurrency')!='AUD' or not str(offers.get('availability','')).endswith('/InStock'):continue
        if not str(offers.get('itemCondition',row.get('itemCondition',''))).endswith('/UsedCondition'):continue
        try:price=Decimal(str(offers.get('price',0)))
        except InvalidOperation:continue
        if not price.is_finite() or price<=0:continue
        return {'id':hashlib.sha256(url.encode()).hexdigest()[:16],'url':url,'title':str(row.get('name',''))[:300],'price':float(price),'currency':'AUD',
            'description':str(row.get('description',''))[:4000],
            'source':urlsplit(url).hostname,
            'condition':'Used','location':offers.get('availableAtOrFrom',{}).get('name','Melbourne' if 'melbourneusedsofas' in url else 'Australia')}
    return None

def public_candidates(category, query="", subcategory="tables"):
    section={'沙发':'sofas','床':'beds-and-bedroom','其他':subcategory}.get(category,'')
    base='https://www.zirkly.com.au/second-hand-furniture'
    indexes=[base+('/'+section if section else '')]
    if category=='沙发':indexes.append('https://www.melbourneusedsofas.com.au/')
    rows=[]; failures=[]
    with httpx.Client(timeout=10,headers={'User-Agent':'SecondSpaceResearch/1.0 (public furniture comparison)'}) as client:
        urls=[]
        # Anonymous JSON endpoint used by the public storefront; verify each product page.
        cash='https://www.cashconverters.com.au'
        search_term=next((term for term in ['gaming chair','office chair','bed frame','sofa','chair','table','cabinet'] if query.lower().startswith(term)),query)
        try:
            response=client.get(cash+'/c3api/search/results',params={'query':search_term,'NumberOfResults':12})
            response.raise_for_status()
            if len(response.content)>2_000_000:raise ValueError('Oversized response')
            payload=response.json()
            if not payload.get('WasSuccessful'):raise ValueError('Search unavailable')
            for item in payload.get('Value',{}).get('ProductList',{}).get('ProductListItems',[])[:12]:
                url=urljoin(cash,item.get('Url',''))
                if allowed(url) and url.startswith(cash+'/shop/'):urls.append(url)
        except (httpx.HTTPError,ValueError,TypeError):failures.append(cash)
        for index in indexes:
            try:
                page=read(client,index)
                links=[urljoin(index,x) for x in page.links]
                links=[x for x in links if allowed(x) and (('/second-hand-furniture/' in x and '?id=' in x) or '/sofas/MUS-' in x)]
                terms=set(re.findall(r'[a-z]{3,}',query.lower()))
                links=sorted(dict.fromkeys(links),key=lambda u:sum(t in urlsplit(u).path.lower() for t in terms),reverse=True)
                urls.extend(links[:18])
            except (httpx.HTTPError,ValueError):failures.append(index)
        def fetch(url):
            try:return product(read(client,url),url)
            except (httpx.HTTPError,ValueError,TypeError):failures.append(url);return None
        with ThreadPoolExecutor(max_workers=3) as pool:
            rows=[r for r in pool.map(fetch,list(dict.fromkeys(urls))[:24]) if r]
    return rows,failures
