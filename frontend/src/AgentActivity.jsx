import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage, useLanguageCode } from './Language';
import { useStore } from './store';
import { day, money } from './domain-v2.mjs';

// Agent console. Live states come from /api/agent-activity; today's counts are derived from the
// persisted audit records (s.audit, each carrying its request's execution steps). Nothing is simulated.
// Line icons (24px grid, drawn with currentColor) and one accent colour per Agent.
const ICONS = {
  ListingAgent: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  PricingAgent: <><path d="M3 12V4h8l9 9-8 8z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  MatchingAgent: <><path d="M11 3l1.8 4.7L17.5 9.5l-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z" /><path d="M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>,
  LogisticsAgent: <><path d="M3 6h11v10H3z" /><path d="M14 9h4l3 3v4h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  PaymentAgent: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M15.5 14.5h2.5" /></>,
  AuditReportingAgent: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 3.5h6v3H9zM9 13l2 2 4-4" /></>
};
export const Icon = ({ id }) => <svg className="agent-icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[id]}</svg>;
export const WORKERS = [
  { id: 'ListingAgent', name: '审核 Agent', duty: '照片与资料审核', color: '#4fd1a5' },
  { id: 'PricingAgent', name: '估价 Agent', duty: '建议售价与固定总价', color: '#f2b84b' },
  { id: 'MatchingAgent', name: '推荐 Agent', duty: '解析偏好并筛选家具', color: '#b49cff' },
  { id: 'LogisticsAgent', name: '物流 Agent', duty: '配送报价与配送状态', color: '#5fb3ff' },
  { id: 'PaymentAgent', name: '收款 Agent', duty: '模拟留置、付款与结算', color: '#f472b6' },
  { id: 'AuditReportingAgent', name: '审计 Agent', duty: '增量审计与经营汇总', color: '#6fe0e8' }
];
const WORKER_IDS = WORKERS.map(w => w.id);
// Agents named in an open conflict (see the 异常与冲突 page: logistics vs pricing).
const CONFLICT_AGENTS = ['LogisticsAgent', 'PricingAgent'];
const strip = label => String(label || '').replace(/^[^：]*：/, '');

// A BusinessRules record whose execution contains only BusinessRules steps is a blocked request
// (record_supervision_block); otherwise it is a passed check appended to the request's decisions.
const isBlock = a => (a.execution?.steps || []).every(step => step.agent === 'BusinessRules');

export function agentStats(s) {
  const today = day(s.now);
  const records = (s.audit || []).filter(a => day(a.time) === today);
  const done = {}, failed = {}, model = {};
  for (const id of WORKER_IDS) { done[id] = new Set(); failed[id] = new Set(); model[id] = { ok: 0, failed: 0 }; }
  const executions = new Map();
  let checks = new Set(), blocks = 0, interventions = 0, audited = 0, findings = 0;
  for (const a of records) {
    const ex = a.execution;
    if (ex?.requestId) executions.set(ex.requestId, ex);
    if (WORKER_IDS.includes(a.agent) && ex?.requestId) done[a.agent].add(ex.requestId);
    if (a.agent === 'System' && ex?.steps?.length) {
      const last = [...ex.steps].reverse().find(step => WORKER_IDS.includes(step.agent));
      if (last) failed[last.agent].add(ex.requestId);
    }
    if (a.agent === 'BusinessRules') isBlock(a) ? blocks++ : ex?.requestId && checks.add(ex.requestId);
    if (a.agent === 'SupervisionAgent') interventions++;
    if (a.agent === 'AuditReportingAgent' && Array.isArray(a.auditFindings)) {
      audited++;
      if (a.auditFindings.length) findings++;
    }
  }
  for (const ex of executions.values()) for (const step of ex.steps || []) {
    if (!model[step.agent]) continue;
    if (step.modelCall === 'succeeded') model[step.agent].ok++;
    if (step.modelCall === 'failed') model[step.agent].failed++;
  }
  const orders = s.orders || [];
  const openConflicts = (s.exceptions || []).filter(e => e.status === 'open');
  return {
    done: Object.fromEntries(WORKER_IDS.map(id => [id, done[id].size])),
    failed: Object.fromEntries(WORKER_IDS.map(id => [id, failed[id].size])),
    model, checks: checks.size, blocks, interventions, audited, findings, openConflicts,
    escalatedToday: (s.exceptions || []).filter(e => day(e.created) === today).length,
    activePolicies: (s.policies || []).filter(p => p.active).length,
    rejectedItems: (s.items || []).filter(i => i.status === 'rejected').length,
    publishedItems: (s.items || []).filter(i => i.status === 'published').length,
    transit: orders.filter(o => o.status === 'transit').length,
    propertyPending: orders.filter(o => o.requests?.some(r => r.status === 'pending')).length,
    carrierPending: orders.filter(o => o.status === 'pending' && !o.providerAccepted).length,
    held: orders.reduce((sum, o) => sum + (o.held ? o.total : 0), 0),
    settledToday: orders.filter(o => o.settledAt && day(o.settledAt) === today).length
  };
}

function useActivity() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const offset = useRef(0);
  useEffect(() => {
    let active = true, timer;
    const load = async () => {
      let delay = 1500;
      if (document.visibilityState === 'visible') {
        try {
          const response = await fetch('/api/agent-activity', { headers: { 'X-Demo-Role': 'manager' } });
          if (!response.ok) throw Error('activity');
          const next = await response.json();
          if (!active) return;
          offset.current = next.now * 1000 - Date.now();
          setData(next);
          setFailed(false);
        } catch {
          if (active) setFailed(true);
          delay = 5000;
        }
      }
      if (active) timer = setTimeout(load, delay);
    };
    load();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  return { data, failed, serverNow: () => (Date.now() + offset.current) / 1000 };
}

function useTicker(on) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [on]);
}

export function AgentConsole() {
  const _tr = useLanguage();
  const { s } = useStore();
  const activity = useActivity();
  return <><div className="page-head agent-console-head"><h1>{_tr('Agent 运转台')}</h1>
    <span className={'agent-live' + (activity.failed ? ' offline' : '')}><i />{activity.failed ? _tr('暂时无法获取 Agent 状态，正在重试') : _tr('实时 · 每 1.5 秒更新')}</span>
  </div><AgentActivity s={s} activity={activity} /></>;
}

export function AgentActivity({ s, activity }) {
  const _tr = useLanguage();
  const en = useLanguageCode() === 'en';
  // Short words are chosen by language code; adding them to the phrase table would corrupt longer phrases.
  const L = (zh, english) => en ? english : zh;
  const { data, serverNow } = activity;
  const agents = data?.agents || {};
  const working = WORKERS.filter(w => agents[w.id]?.status === 'working');
  const supervisorBusy = agents.SupervisionAgent?.status === 'working';
  const rulesBusy = agents.BusinessRules?.status === 'working';
  useTicker(working.length > 0 || supervisorBusy || rulesBusy);

  const st = agentStats(s);
  const stalls = s.attention || [];
  const waiting = st.openConflicts.length + stalls.length;
  const queue = data?.auditQueue;
  const now = data ? serverNow() : 0;
  const ago = at => {
    const sec = Math.max(0, Math.round(now - at));
    if (sec < 5) return L('刚刚', 'just now');
    if (sec < 60) return L(`${sec} 秒前`, `${sec}s ago`);
    if (sec < 3600) return L(`${Math.floor(sec / 60)} 分钟前`, `${Math.floor(sec / 60)} min ago`);
    return L(`${Math.floor(sec / 3600)} 小时前`, `${Math.floor(sec / 3600)} h ago`);
  };
  const elapsed = since => `${Math.max(0, now - since).toFixed(1)}s`;
  const supState = supervisorBusy ? 'working' : st.openConflicts.length ? 'alert' : 'watching';
  const supText = supervisorBusy
    ? _tr('正在介入冲突') + '：' + _tr(strip(agents.SupervisionAgent.step))
    : st.openConflicts.length
      ? L(`已升级 ${st.openConflicts.length} 个冲突，等待经营者决策`, `${st.openConflicts.length} conflict(s) escalated — awaiting your decision`)
      : _tr('监控中 · 普通任务由调度直接分派，出现冲突时介入');
  const modelLine = id => {
    const m = st.model[id];
    return m.ok || m.failed ? L(`模型调用 ${m.ok + m.failed} 次${m.failed ? ` · 失败 ${m.failed}` : ''}`, `${m.ok + m.failed} model call(s)${m.failed ? ` · ${m.failed} failed` : ''}`) : L('今日未调用模型', 'No model calls today');
  };
  const metric = {
    ListingAgent: [st.done.ListingAgent, L('今日审核', 'reviewed today'), L(`未通过审核的家具 ${st.rejectedItems} 件`, `${st.rejectedItems} listing(s) not approved`)],
    PricingAgent: [st.done.PricingAgent, L('今日估价', 'priced today'), modelLine('PricingAgent')],
    MatchingAgent: [st.done.MatchingAgent, L('今日推荐', 'recommendations today'), L(`可推荐在售家具 ${st.publishedItems} 件`, `${st.publishedItems} listing(s) available`)],
    LogisticsAgent: [st.transit, L('单配送中', 'in transit'), L(`待物业回复 ${st.propertyPending} · 待承运接受 ${st.carrierPending}`, `${st.propertyPending} awaiting property · ${st.carrierPending} awaiting carrier`)],
    PaymentAgent: [money(st.held), L('留置资金', 'held funds'), L(`今日结算 ${st.settledToday} 笔`, `${st.settledToday} settled today`), '/manager/overview'],
    AuditReportingAgent: [st.audited, L('今日审计', 'audits today'), L(`发现需关注 ${st.findings} 次`, `${st.findings} with findings`)]
  };
  const recent = (data?.recent || []).slice(0, 3);

  return <section className="agent-board" aria-label={_tr('Agent 工作状态')}>
    <div className="agent-operator">
      <span className="agent-avatar" aria-hidden="true">{L('你', 'You')}</span>
      <div><b>{L('经营者', 'Operator')}</b><small>{_tr('制定政策 · 处理升级冲突')}</small></div>
      <Link to="/manager/exceptions" className={'agent-waiting' + (waiting ? ' on' : '')}>{waiting ? L(`等你 ${waiting} 件 →`, `${waiting} waiting for you →`) : L('暂无待办', 'Nothing waiting')}</Link>
    </div>
    <div className="agent-relay">
      <span className="down">↓ {L('政策决策', 'Policy decisions')}<small>{L(`生效政策 ${st.activePolicies} 条`, `${st.activePolicies} active polic${st.activePolicies === 1 ? 'y' : 'ies'}`)}</small></span>
      <svg className={'agent-relay-arcs' + (st.openConflicts.length ? ' escalating' : '')} viewBox="0 0 90 96" aria-hidden="true">
        <defs>
          <linearGradient id="arc-down" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff9a4d" /><stop offset="1" stopColor="#ff9a4d" stopOpacity=".15" /></linearGradient>
          <linearGradient id="arc-up" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#5fb3ff" /><stop offset="1" stopColor="#5fb3ff" stopOpacity=".15" /></linearGradient>
        </defs>
        <path className="arc down" d="M36 2 C14 30 14 66 36 94" stroke="url(#arc-down)" />
        <path className="arc up" d="M54 94 C76 66 76 30 54 2" stroke="url(#arc-up)" />
        <path className="arc-flow up" d="M54 94 C76 66 76 30 54 2" />
      </svg>
      <span className={'up' + (st.openConflicts.length ? ' warn' : '')}>↑ {L('升级冲突', 'Escalations')}<small>{L(`今日 ${st.escalatedToday} · 待决策 ${st.openConflicts.length}`, `${st.escalatedToday} today · ${st.openConflicts.length} open`)}</small></span>
    </div>

    <div className={'agent-supervisor ' + supState}>
      <div className="agent-radar" aria-hidden="true"><span /></div>
      <div className="agent-supervisor-text">
        <b>{_tr('监督 Agent')}</b>
        <p>{supText}</p>
      </div>
      <div className="agent-watch">
        <span className={rulesBusy ? 'busy' : ''}>{rulesBusy ? _tr('规则校验中') : L('今日规则校验', 'Rule checks today')}<b>{st.checks}</b></span>
        <span className={st.blocks ? 'warn' : ''}>{L('今日拦截', 'Blocked today')}<b>{st.blocks}</b></span>
        <span className={st.interventions ? 'warn' : ''}>{L('介入冲突', 'Interventions')}<b>{st.interventions}</b></span>
        <span className={stalls.length ? 'warn' : ''}>{_tr('停滞订单')}<b>{stalls.length}</b></span>
      </div>
    </div>

    <svg className={'agent-link-v ' + supState + (working.length ? ' routing' : '')} viewBox="0 0 10 34" preserveAspectRatio="none" aria-hidden="true">
      <path className="base" d="M5 0V34" vectorEffect="non-scaling-stroke" /><path className="flow" d="M5 0V34" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="agent-dispatch">
      <span className="agent-dispatch-pill"><i className={working.length ? 'busy' : ''} />{_tr('调度 Dispatch')} · {working.length ? L(`正在分派给 ${working.length} 个 Agent`, `routing to ${working.length} agent(s)`) : _tr('等待新任务')}</span>
    </div>
    <svg className="agent-links" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden="true">
      {WORKERS.map((w, i) => {
        const on = agents[w.id]?.status === 'working';
        const d = `M300 0 C300 34 ${i * 100 + 50} 26 ${i * 100 + 50} 60`;
        // Idle: a faint line in the Agent's colour. Working: glowing line with particles flowing to the Agent.
        return <g key={w.id} className={on ? 'on' : ''} style={{ '--c': w.color }}>
          <path className="base" d={d} vectorEffect="non-scaling-stroke" />
          {on && <path className="flow" d={d} vectorEffect="non-scaling-stroke" />}
        </g>;
      })}
    </svg>

    <div className="agent-workers">
      {WORKERS.map(w => {
        const a = agents[w.id] || {};
        const on = a.status === 'working';
        const conflict = st.openConflicts.length > 0 && CONFLICT_AGENTS.includes(w.id);
        const [big, unit, , to] = metric[w.id];
        const sent = st.done[w.id] + st.failed[w.id];
        const value = <><strong>{big}</strong><span>{unit}</span></>;
        return <div key={w.id} className="agent-column" style={{ '--c': w.color }}>
          <div className={'agent-edge' + (on ? ' on' : '')}>
            <span>↓ {L(`派活 ${sent}`, `${sent} sent`)}</span>
            <span className={st.failed[w.id] ? 'bad' : ''}>↑ {L(`完成 ${st.done[w.id]}`, `${st.done[w.id]} done`)}{st.failed[w.id] ? L(` · 失败 ${st.failed[w.id]}`, ` · ${st.failed[w.id]} failed`) : ''}</span>
          </div>
          <article className={'agent-card' + (on ? ' working' : '') + (conflict ? ' conflict' : '')} aria-live="polite">
            <div className="agent-card-head"><b><Icon id={w.id} />{_tr(w.name)}</b>{conflict
              ? <Link to="/manager/exceptions" className="agent-alert-link"><svg className="agent-icon agent-alert" viewBox="0 0 24 24" role="img" aria-label={L('有冲突待经营者决策', 'Conflict awaiting your decision')}><title>{L('有冲突待经营者决策', 'Conflict awaiting your decision')}</title><path d="M12 3.5L21.5 20h-19z" /><path d="M12 10v4.5M12 17.3v.2" /></svg></Link>
              : null}</div>
            {to ? <Link to={to} className="agent-metric">{value}</Link> : <div className="agent-metric">{value}</div>}
            <p className="agent-state"><i />{on ? <>{L('工作中', 'Working')} · {elapsed(a.since)}{a.requests > 1 && <> · {L(`${a.requests} 个请求`, `${a.requests} requests`)}</>}</> : L('空闲', 'Idle')}</p>
            <p className="agent-step">{on
              ? _tr(strip(a.step))
              : a.last
                ? <>{L('最近：', 'Last: ')}{_tr(strip(a.last.label))}</>
                : <span className="muted">{_tr(w.duty)}</span>}</p>
            {w.id === 'AuditReportingAgent' && queue && (queue.pending || queue.running || queue.failed) ? <small className="agent-queue">{_tr('审计队列')}{L('：', ': ')}{queue.pending || 0} {L('待处理', 'pending')}{queue.failed ? ` · ${queue.failed} ${L('待重试', 'to retry')}` : ''}</small> : null}
          </article>
        </div>;
      })}
    </div>

    <div className="agent-recent">
      <span>{_tr('最近活动')}</span>
      {recent.length ? <ol>{recent.map((e, i) => <li key={e.at + '-' + i} className={e.status}>
        <time>{ago(e.at)}</time><b>{_tr(e.agent === 'BusinessRules' ? '业务规则' : (WORKERS.find(w => w.id === e.agent)?.name || '监督 Agent'))}</b>
        <span>{_tr(strip(e.label))}</span><small>{e.status === 'failed' ? L('未完成', 'not completed') : L('完成', 'done')}{e.ms != null && ` · ${(e.ms / 1000).toFixed(1)}s`}</small>
      </li>)}</ol> : <p className="muted">{_tr('后端启动以来暂无 Agent 活动。在买家或卖家端发起操作后，这里会实时显示。')}</p>}
    </div>
  </section>;
}
