"""Request-scoped toolsets. All business effects here are proposals on a private snapshot."""
from copy import deepcopy
from hashlib import sha256
import json
import time
from . import domain as d
from .agent_tools import Tool, run_tools


def command_key(operation, payload):
    return sha256(json.dumps([operation, payload], sort_keys=True).encode()).hexdigest()


def order_for(snapshot, operation, payload):
    if operation == 'property':
        return next((o for o in snapshot['orders'] if any(r['token'] == payload['token'] for r in o['requests'])), None)
    if operation == 'purchase':
        quote = d.find(snapshot['quotes'], payload['quoteId'])
        return next((o for o in snapshot['orders'] if o.get('quoteId') == quote['id']), None)
    return d.find(snapshot['orders'], payload['orderId']) if payload.get('orderId') else None


def order_facts(order):
    if not order:
        return {'orderExists': False}
    return {**{k: order.get(k) for k in ('id', 'status', 'held', 'providerAccepted', 'delivered', 'buyerAccepted')},
            'hasIssue': bool(order.get('issue')), 'propertyReplies': [dict(end=r['end'], status=r['status']) for r in order.get('requests', [])]}



def coordination_plan(order, trigger):
    """Handoff metadata only. Never reinterpret free text as new business permissions."""
    replies=[{k:r.get(k,'') for k in ('end','status','timeWindow','lift','loading','reason')} for r in order.get('requests',[])]
    pending=any(r['status']=='pending' for r in replies)
    rejected=any(r['status']=='rejected' for r in replies)
    phase='carrier_accepted' if order.get('providerAccepted') else 'property_refused' if rejected else 'waiting_property' if pending else 'ready_for_carrier'
    return dict(phase=phase,trigger=trigger,simulated=True,realMessageSent=False,
                provider=order.get('provider'),plannedDate=order.get('expected'),
                movers=order.get('access',{}).get('movers'),propertyConditions=replies,
                carrierHandoff=dict(provider=order.get('provider'),plannedDate=order.get('expected'),
                                    propertyConditions=replies,accepted=bool(order.get('providerAccepted'))),
                note='沿用既有预计日期，传递物业原始条件；实际联系和承运回复使用模拟事件。')


def business(agent, state):
    op, p, context = state['operation'], state.get('payload', {}), state.get('context', {})
    if agent=='LogisticsAgent' and op=='advance' and p.get('action') in ('pickup','deliver'):
        raise d.BusinessError('取货与送达事件由后端直接校验保存，不进入模型协调流程。')
    snapshot = context['snapshot']
    result = dict(state.get('result', {}))
    order = order_for(snapshot, op, p)
    tools = []

    def read_order():
        return order_facts(order)

    def read_event():
        return dict(operation=op, action=p.get('action'),
                    propertyReply=(p.get('reply') or {}).get('status'), source='validated_user_or_demo_event')

    def prepare():
        s = deepcopy(snapshot)
        from . import progress
        with progress.request_scope(context.get('progressId')):
            if op == 'quote':
                value = d.create_quote(s, p['itemId'], p['delivery'])
            elif op == 'purchase':
                value = d.purchase(s, p['quoteId'], p['method'])
            elif op == 'property':
                value = d.property_reply(s, p['token'], p['reply'])
            else:
                value = d.advance(s, p['orderId'], p['action'], p.get('data'))
        result['preparedCommand'] = command_key(op, p)
        if op=='property' or op=='advance' and p.get('action')=='book':
            result['coordination']=coordination_plan(value,op if op=='property' else 'book')
        return dict(prepared=True, persisted=False, operation=op, action=p.get('action'),
                    proposedStatus=value.get('status'), held=value.get('held'),coordination=result.get('coordination'),
                    note='仅在副本上校验；生产状态在最终事务中重新核对并提交。')

    if agent == 'LogisticsAgent':
        if op == 'quote':
            def item():
                value = d.find(snapshot['items'], p['itemId'])
                return {k: value[k] for k in ('id', 'status', 'category', 'width', 'depth', 'height')}
            def access():
                return {k: p['delivery'].get(k) for k in ('door', 'doorHeight', 'floor', 'access', 'movers', 'loading', 'pickupAccess', 'pickupProperty', 'deliveryProperty', 'provider')}
            tools = [Tool('read_item', '读取家具与可售状态', item),
                     Tool('read_access', '读取两端通行与配送要求', access),
                     Tool('prepare_quote', '检查通行条件并准备固定报价', prepare, {'read_item', 'read_access'}, True)]
        elif op=='property' or op=='advance' and p.get('action')=='book':
            def coordination_context():
                # Read current replies and the incoming reply; final preparation validates them.
                reply={k:p.get('reply',{}).get(k,'') for k in ('status','timeWindow','lift','loading','reason')}
                return dict(order=read_order(),event=read_event(),provider=order.get('provider') if order else None,
                            plannedDate=order.get('expected') if order else None,
                            propertyConditions=[{k:r.get(k,'') for k in ('end','status','timeWindow','lift','loading','reason')} for r in (order or {}).get('requests',[])],
                            incomingReply=reply if op=='property' else None,simulated=True)
            name='prepare_property_followup' if op=='property' else 'prepare_carrier_arrangement'
            label='核对物业回复并准备后续协调' if op=='property' else '准备模拟承运工作单并确认安排'
            tools=[Tool('read_coordination_context','读取物业条件与承运安排信息',coordination_context),
                   Tool(name,label,prepare,{'read_coordination_context'},True)]
        else:
            tools = [Tool('read_order', '读取订单与配送阶段', read_order),
                     Tool('read_event', '读取本次物业回复或模拟配送事件', read_event),
                     Tool('read_property', '核对必要物业回复', lambda: {'replies': read_order().get('propertyReplies', [])}, {'read_order'}),
                     Tool('prepare_delivery_update', '校验事件并准备对应状态更新', prepare, {'read_order', 'read_event', 'read_property'}, True)]
    elif agent == 'PaymentAgent':
        payment_state={}
        def payment_result():
            # Existing simulator: valid BPAY/card requests succeed; no real gateway is called.
            # Exact current rules are executed on a copy; never derive success from model text.
            try:
                value = d.purchase(deepcopy(snapshot), p['quoteId'], p['method'])
            except d.BusinessError as exc:
                payment_state['failure']=exc
                return dict(simulated=True,paymentResult='failed',reason=str(exc),persisted=False)
            return dict(simulated=True, paymentResult='already_processed' if order else 'success',
                        persisted=bool(order), amount=value['total'], receiptExists=bool(order and order.get('receipt')))
        def report_failure():
            raise payment_state['failure']
        if op == 'purchase':
            tools = [Tool('query_simulated_payment', '查询模拟付款结果与重复付款记录', payment_result),
                     Tool('prepare_payment', '按模拟结果准备订单、留置与收据', prepare, {'query_simulated_payment'}, True, lambda done:'failure' not in payment_state),
                     Tool('report_payment_failure','返回模拟付款失败原因',report_failure,{'query_simulated_payment'},True,lambda done:'failure' in payment_state)]
        else:
            tools = [Tool('read_order', '读取送达、验收及交付问题', read_order),
                     Tool('read_funds', '查询留置资金与已有结算记录', lambda: dict(held=bool(order.get('held')), settled=order['status']=='settled'), {'read_order'}),
                     Tool('prepare_acceptance_settlement', '校验并准备买家验收与自动结算', prepare, {'read_order', 'read_funds'}, True)]
    traces = run_tools(agent, context, tools, task='Process only this requested operation. Never advance a different stage. '
                       'All updates are proposals, not committed results. Keep payment and delivery prerequisites intact. '
                       'For property/carrier coordination, preserve supplied access conditions and the existing planned date. '
                       'Never invent an appointment time or claim a real message was sent; contact and carrier acceptance are simulated.',
                       facts=dict(operation=op, action=p.get('action')))
    return {'result': result, 'decisions': [*state.get('decisions', []), *traces], 'cursor': state.get('cursor', 0)+1}


def report(state):
    context = state.get('context', {})
    result = dict(state.get('result', {}))
    def totals():
        return deepcopy(context.get('report', {}))
    def finish():
        result['report'] = totals()
        return {'summary': '经营汇总已核对，金额来自数据库计算。', 'totals': totals()}
    tools = [Tool('read_report_totals', '读取数据库计算的经营金额', totals),
             Tool('read_report_stages', '检查订单阶段分布', lambda: {'stages': totals().get('stages', {})}),
             Tool('prepare_report', '整理有依据的经营汇总', finish, {'read_report_totals', 'read_report_stages'}, True)]
    traces = run_tools('AuditReportingAgent', context, tools, task='Read and summarise supplied authoritative totals. Never invent financial numbers.')
    return {'result': result, 'decisions': [*state.get('decisions', []), *traces], 'cursor': state.get('cursor', 0)+1}


def conflict(state):
    from . import supervision
    context, p = state.get('context', {}), state.get('payload', {})
    snapshot = context['snapshot']
    order = d.find(snapshot['orders'], p['orderId'])
    if order['status']!='pending':
        raise d.BusinessError('当前阶段不能变更配送方案。')
    result = dict(state.get('result', {}))
    policies = [v for v in snapshot['policies'] if v['id']=='P-EXTRA' and v['active']]
    covered = len(policies)==1
    extra_calls=[]
    def evidence():
        return dict(order=order_facts(order), conflict='承运方要求增加25澳元，已接受买家固定总价不能增加。')
    def read_policy():
        return {'policies': [{k: v.get(k) for k in ('id','version','rule','direction')} for v in policies],
                'applicable': covered, 'missingOrConflicting': not covered}
    def apply():
        result['conflictResolution']='policy'
        result['policyEvidence']={k:policies[0][k] for k in ('id','version')}
        result['policyDirection']=policies[0].get('direction','pricing')
        return dict(direction='platform_absorbs_extra_cost' if result['policyDirection']=='logistics' else 'request_fixed_total_alternative',
                    policy=result['policyEvidence'],
                    buyerTotalUnchanged=True, deliveryStillRequiresConfirmation=True)
    def escalate():
        started=time.perf_counter()
        options, mode = supervision.escalation_options(evidence())
        called=mode in ('campus-qwen','model_unavailable')
        from . import config
        extra_calls.append(dict(agent='SupervisionAgent',mode='escalation_options',
                                modelCall='succeeded' if mode=='campus-qwen' else 'failed' if called else 'not_called',
                                model=config.MODEL_NAME if called else None,endpoint='/v1/chat/completions' if called else None,
                                modelDurationMs=round((time.perf_counter()-started)*1000),
                                summary='整理创始人备选方案，仅作建议，不自动执行。'))
        result.update(conflictResolution='founder', escalation={'options':options,'mode':mode})
        return {'founderRequired': True, 'reason': '无适用政策或存在政策冲突', 'options': options}
    tools=[Tool('read_conflict', '读取冲突、订单及证据', evidence),
           Tool('read_founder_policies', '查询创始人政策与版本', read_policy),
           Tool('apply_founder_policy', '按适用政策准备处理方向', apply, {'read_conflict','read_founder_policies'}, True, lambda done: covered),
           Tool('request_founder', '保持暂停并整理创始人处理材料', escalate, {'read_conflict','read_founder_policies'}, True, lambda done: not covered)]
    traces=run_tools('SupervisionAgent', context, tools, task='Resolve this conflict ONLY using the supplied applicable founder policy. '
                     'Missing/contradictory policy requires founder review. Never change price or skip protected steps.')
    return {'result':result,'decisions':[*state.get('decisions',[]),*traces,*extra_calls],
            'conflictProcessed':True,'needs_human':not covered,'next':'HumanReview' if not covered else 'Dispatch'}
