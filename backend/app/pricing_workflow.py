"""Agent-selected historical/market evidence with a shared 20 second retrieval budget."""
import queue
import threading
import time
from . import config, market_pricing as pricing
from .agent_tools import Tool, run_tools, AgentUnavailable

QUERY_BUDGET_SECONDS = 20


def bounded_read(call, seconds):
    """Deadline the read-only retrieval. Late responses are discarded and never persisted."""
    if seconds <= 0:
        return pricing.unavailable('query_timeout')
    output = queue.Queue(maxsize=1)
    def work():
        try:
            output.put((True, call()))
        except Exception:
            output.put((False, None))
    threading.Thread(target=work, name='price-reference-read', daemon=True).start()
    try:
        ok, value = output.get(timeout=seconds)
        return value if ok else pricing.unavailable('provider_unavailable')
    except queue.Empty:
        return pricing.unavailable('query_timeout')


def estimate(form, context):
    subject = {k:form.get(k) for k in pricing.FIELDS}
    errors = pricing.ai_input_errors(subject)
    if errors:
        return dict(pricing.unavailable('input_invalid', errors=errors), source=pricing.AI_SOURCE), []
    query_deadline = min(time.monotonic()+QUERY_BUDGET_SECONDS, context.get('deadline', float('inf')))
    refs, result, ai_call = {}, {}, []
    searchable = not pricing.input_errors(subject)
    def remaining():
        return max(0, query_deadline-time.monotonic())
    def history():
        def read():
            rows=pricing.reference_rows(subject['category'])
            return pricing.market_price(form, candidates=(rows,[]), persist=False, keep_observed=True) if rows else pricing.unavailable('insufficient')
        value=bounded_read(read,remaining()) if searchable else pricing.unavailable('search_unsupported')
        dates=sorted(str(r.get('observedAt',''))[:10] for r in value.get('evidence',[]) if r.get('observedAt'))
        refs['history']=dict(value,pricingMethod='history',source='Stored public used-furniture listings (last 30 days)',collectedFrom=dates[0] if dates else None,collectedTo=dates[-1] if dates else None)
        return observation(refs['history'])
    def market():
        def read():
            _,query,section=pricing.subtype(subject)
            rows=pricing.public_candidates(subject['category'],query+' '+subject['material']+' '+subject['name'],section,budget=remaining())
            return pricing.market_price(form,candidates=rows,persist=False)
        if config.MODEL_MODE=='fixture':
            value=pricing.unavailable('offline_fixture')
        else:
            value=bounded_read(read,remaining()) if searchable else pricing.unavailable('search_unsupported')
        refs['live']=dict(value,pricingMethod='live')
        return observation(refs['live'])
    def observation(value):
        return dict(status=value.get('status'), method=value.get('pricingMethod'),
                    suggested=value.get('suggested'), sampleLimited=value.get('sampleLimited'),
                    evidence=[{k:r.get(k) for k in ('id','price','matchScore','observedAt')} for r in value.get('evidence',[])])
    def ready(method):
        return refs.get(method,{}).get('status')=='ready'
    def finish(method):
        result.update(refs[method])
        return observation(result)
    def fallback_available(done):
        return not any(ready(k) for k in refs) and (remaining()<=.05 or {'query_history','query_market'} <= done)
    def ai():
        started=time.perf_counter()
        try:
            value=pricing.ai_price(form)
            result.update(value,pricingMethod='ai',fallbackReasons=[v.get('status') for v in refs.values()] or ['query_timeout'])
            ai_call.append(dict(agent='PricingAgent',mode='ai_estimate',modelCall='succeeded' if config.MODEL_MODE=='live' else 'not_called',
                                model=config.MODEL_NAME if config.MODEL_MODE=='live' else None, endpoint='/v1/chat/completions' if config.MODEL_MODE=='live' else None,
                                modelDurationMs=round((time.perf_counter()-started)*1000),summary='AI 估算新品价，代码按固定成色与年限折算。'))
        except Exception as exc:
            result.update(pricing.unavailable('no_estimate'),pricingMethod='ai')
            ai_call.append(dict(agent='PricingAgent',mode='ai_estimate_failed',errorClass=type(exc).__name__,modelCall='failed' if config.MODEL_MODE=='live' else 'not_called',
                                model=config.MODEL_NAME if config.MODEL_MODE=='live' else None, endpoint='/v1/chat/completions' if config.MODEL_MODE=='live' else None,
                                modelDurationMs=round((time.perf_counter()-started)*1000),summary='AI 估价未完成，可由卖家自行定价。'))
        return observation(result)
    tools=[Tool('use_history_price','采用历史参考价格',lambda:finish('history'),{'query_history'},True,lambda done:ready('history')),
           Tool('use_market_price','采用市场参考价格',lambda:finish('live'),{'query_market'},True,lambda done:ready('live')),
           Tool('query_history','查询历史家具知识库',history,available=lambda done:remaining()>.05),
           Tool('query_market','查询当前公开市场',market,available=lambda done:remaining()>.05),
           Tool('estimate_with_ai','无可用参考，调用 AI 估价',ai,terminal=True,available=fallback_available)]
    traces=run_tools('PricingAgent',context,tools,task='Choose historical knowledge or current market first from furniture inputs. '
                     'Assess reference suitability, age and sample count; query the other source if needed. '
                     'Use a suitable existing reference when available. AI is only a fallback when no usable references exist and both sources '
                     'were attempted or the shared 20 second query budget expired. Seller keeps final pricing authority.',facts=subject,max_steps=5)
    # Store only accepted on-time public references, never a detached late query response.
    if result.get('pricingMethod')=='live' and result.get('status')=='ready':
        try:
            pricing.store(subject['category'],result.get('evidence',[]))
            result['stored']=True
        except Exception:
            result['stored']=False
    return result,[*traces,*ai_call]
