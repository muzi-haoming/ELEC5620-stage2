"""On-demand public market lookup, traceable attribute adjustment and field feedback."""
from datetime import datetime, timezone
import math
import re
from .market_store import store
from .public_market import public_candidates

FIELDS=('name','category','material','condition','age','width','depth','height')
MATERIALS={'fabric':['fabric','cloth','linen','velvet','polyester','cotton','chenille','microfibre','upholster','布','绒','麻'],
 'leather':['leather','皮'], 'wood':['wood','timber','oak','pine','mahogany','木'],
 'metal':['metal','steel','iron','金属','铁','钢'], 'glass':['glass','玻璃'], 'plastic':['plastic','塑料']}

TYPES={'gaming_chair':(['gaming chair','电竞椅','電競椅'],'gaming chair','seating'),
 'office_chair':(['office chair','办公椅'],'office chair','seating'),
 'chair':(['chair','stool','椅','凳'],'chair','seating'),
 'table':(['table','desk','桌'],'table','tables'),
 'storage':(['cabinet','wardrobe','drawer','shelf','柜','架'],'cabinet','storage-and-cabinets')}

def subtype(subject):
    if subject.get('category')=='沙发':return 'sofa','sofa','sofas'
    if subject.get('category')=='床':return 'bed','bed frame','beds-and-bedroom'
    name=str(subject.get('name','')).lower()
    for key,(words,query,section) in TYPES.items():
        if any(w in name for w in words):return key,query,section
    return None,None,None

def input_errors(form):
    errors={}
    for k in ('name','material'):
        if not isinstance(form.get(k),str) or not 2<=len(form[k].strip())<=80:errors[k]='请填写有效内容（2–80 字符）'
    if form.get('category') not in ('沙发','床','其他'):errors['category']='请选择沙发、床或其他。'
    if form.get('condition') not in ('一般','良好','优秀'):errors['condition']='请选择有效成色。'
    for k in ('width','depth','height','age'):
        try:
            n=float(form.get(k));valid=math.isfinite(n) and (0<=n<=100 if k=='age' else 0<n<=1000)
        except (TypeError,ValueError):valid=False
        if not valid:errors[k]='年限须为 0–100 年。' if k=='age' else '尺寸须为大于 0 且不超过 1000 的厘米数。'
    if 'material' not in errors and not material(form['material']) and not re.search(r'mixed|混合|复合',form['material'],re.I):
        errors['material']='无法识别该材质，请填写具体材质，例如布艺、皮革、木材、金属或混合材质；若指亚麻，请填写 linen。'
    if form.get('category')=='其他' and not subtype(form)[0] and 'name' not in errors:
        errors['name']='请在名称中注明具体家具类型，例如电竞椅、办公椅、桌子或柜子，以便查询同类商品。'
    return errors

def material(text):
    text=text.lower()
    # Upholstery material takes precedence over frame material.
    for group in ['leather','fabric','wood','metal','glass','plastic']:
        if any(x in text for x in MATERIALS[group]):return group
    return None

def attributes(row):
    text=(row.get('title','')+' '+row.get('description','')).lower()
    condition_text=re.sub(r'no (?:major )?(?:damage|tears?|scratches?|wear)', '',text)
    grade=3 if re.search(r'near.new|excellent|like.new|pristine',text) else 1 if re.search(r'poor condition|heavy wear|(?:is |heavily )worn|damaged',condition_text) else 2 if re.search(r'good|minor wear|light cosmetic wear|minor.*scratch|used condition',condition_text) else None
    age=re.search(r'(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s*old',text)
    dims={}
    for key,word in [('width','wide'),('depth','deep'),('height','high')]:
        found=re.search(r'(\d+(?:\.\d+)?)\s*cm\s*(?:'+word+r')',text) or re.search(r'(?:'+key+r')\s*[:=]?\s*(\d+(?:\.\d+)?)\s*cm',text)
        if found:dims[key]=float(found[1])
    return {'material':material(text),'condition':grade,'age':float(age[1]) if age else None,**dims}

def unavailable(status, **extra):
    return dict(suggested=None,evidence=[],status=status,source='Stored public used-furniture references',**extra)

def score_row(subject,row,diagnostics=None):
    def reject(reason):
        if diagnostics is not None:diagnostics[reason]=diagnostics.get(reason,0)+1
        return None
    title=row.get('title','').lower()
    kind,_,_=subtype(subject)
    if kind=='gaming_chair' and not re.search(r'gaming|racing|电竞',title):return reject('subtype')
    if kind=='office_chair' and not re.search(r'office|desk chair|task chair|办公',title):return reject('subtype')
    if re.search(r'\b(bundle|sofa set|lounge set|sofa.*(?:and|,)\s*(?:matching\s*)?(?:armchair|chair|ottoman)|\d[ -]piece|bed.*and.*bedside|cover|cushion only)\b',title):return reject('type')
    if subject['category']=='沙发' and not re.search(r'sofa|couch|lounge',title):return reject('type')
    if subject['category']=='沙发':
        seats=re.search(r'(\d+)[ -]?seater',title)
        if seats and int(seats[1])*40>float(subject['width']):return reject('type')
    if subject['category']=='床' and (not re.search(r'\bbed\b|bedframe',title) or re.search(r'sofa|sofabed',title)):return reject('type')
    if subject['category']=='其他':
        types={'table':['table','desk','桌'],'chair':['chair','stool','椅','凳'],'storage':['cabinet','wardrobe','drawer','shelf','柜','架']}
        intended=next((k for k,v in types.items() if any(x in subject['name'].lower() for x in v)),None)
        if not intended or not any(x in title for x in types[intended] if x.isascii()):return reject('type')
    a=attributes(row); unknown=[];score=20;facts=[]
    target=material(subject['material'])
    if target and a['material']:
        if target!=a['material']:return reject('material')
        score+=25;facts.append('材质匹配')
    else:score+=10;unknown.append('材质')
    grade={'一般':1,'良好':2,'优秀':3}.get(subject['condition'],2)
    if a['condition'] is not None:score+=max(4,20-8*abs(grade-a['condition']));facts.append('已比较成色')
    else:score+=8;unknown.append('成色')
    if a['age'] is not None:score+=15*max(0,1-abs(float(subject['age'])-a['age'])/10);facts.append('已比较年限')
    else:score+=5;unknown.append('年限')
    size=[]
    for key,label in [('width','宽度'),('depth','深度'),('height','高度')]:
        if key in a:
            ratio=abs(float(subject[key])-a[key])/max(float(subject[key]),a[key])
            if ratio>.5:return reject('dimensions')
            size.append(max(0,1-2*ratio))
        else:unknown.append(label)
    score+=15*(sum(size)+(3-len(size))*.33)/3
    tokens=set(re.findall(r'[a-z]{3,}',subject['name'].lower()))
    score+=5*(sum(t in title for t in tokens)/len(tokens) if tokens else .5)
    # Adjust only disclosed condition/age; never invent missing parameters.
    condition_factor=1.0;age_factor=1.0
    factor=1.0
    if a['condition'] is not None:condition_factor={1:.65,2:.85,3:1}[grade]/{1:.65,2:.85,3:1}[a['condition']];factor*=condition_factor
    if a['age'] is not None:age_factor=max(.35,1-.06*float(subject['age']))/max(.35,1-.06*a['age']);factor*=age_factor
    factor=max(.7,min(1.3,factor))
    return dict(row,matchScore=round(score),unknowns=unknown,reason='；'.join(facts) or '同类二手家具',attributes=a,conditionFactor=round(condition_factor,4),ageFactor=round(age_factor,4),adjustmentFactor=round(factor,4),adjustedPrice=round(float(row['price'])*factor,2))

def market_price(form, model=None, *, candidates=None):
    subject={k:form.get(k) for k in FIELDS}
    errors=input_errors(subject)
    if errors:return unavailable('input_invalid',errors=errors)
    kind,query,section=subtype(subject)
    query=query+' '+subject['material']+' '+subject['name']
    now=datetime.now(timezone.utc).isoformat()
    try:rows,failures=candidates if candidates is not None else public_candidates(subject['category'],query,section)
    except Exception:return unavailable('provider_unavailable',errors={},searchedAt=now)
    diagnostics={};eligible=[]
    rows=[dict(r,observedAt=now) for r in rows]
    persisted=True
    try:store(subject['category'],rows)
    except Exception:persisted=False
    for row in rows:
        try:valid=row.get('currency')=='AUD' and math.isfinite(float(row.get('price',0))) and float(row['price'])>0
        except (TypeError,ValueError):valid=False
        if not valid:diagnostics['invalid_price']=diagnostics.get('invalid_price',0)+1;continue
        matched=score_row(subject,row,diagnostics)
        if matched and matched['matchScore']>=55:eligible.append(matched)
        elif matched:diagnostics['low_similarity']=diagnostics.get('low_similarity',0)+1
    eligible=sorted(eligible,key=lambda r:(-r['matchScore'],r['id']))[:5]
    warnings={}
    if kind in ('gaming_chair','office_chair','chair'):
        if float(subject['width'])>120:warnings['width']='当前椅子宽度较大，请核对是否误用了默认值或单位；系统按你填写的尺寸匹配，不会自动修改。'
        if float(subject['height'])<80 and kind in ('gaming_chair','office_chair'):warnings['height']='请核对是否填写家具总高度，而不是座面高度；系统不会自动修改。'
    details=dict(errors={},warnings=warnings,query=query,searchedAt=now,retrievedAt=now,
                 diagnostics=dict(fetched=len(rows),matched=len(eligible),excluded=diagnostics,failedSources=len(failures)),stored=persisted)
    if not eligible:return unavailable('provider_unavailable' if not rows and failures else 'insufficient',**details)
    ordered=sorted(eligible,key=lambda r:r['adjustedPrice']);half=sum(r['matchScore'] for r in ordered)/2;cumulative=0
    for row in ordered:
        cumulative+=row['matchScore']
        if cumulative>=half:selected=row;break
    return dict(suggested=selected['adjustedPrice'],status='ready',source='Live public used-furniture listings',subject=subject,evidence=eligible,
                generatedAt=now,method='attribute_weighted_median_v3',sampleLimited=len(eligible)<3,
                calculation=dict(sourceId=selected['id'],marketPrice=selected['price'],conditionFactor=selected['conditionFactor'],ageFactor=selected['ageFactor'],factor=selected['adjustmentFactor'],result=selected['adjustedPrice']),
                range=[min(r['adjustedPrice'] for r in eligible),max(r['adjustedPrice'] for r in eligible)],**details)
