import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage, useLanguageCode } from './Language';
import { useStore, readStream } from './store';
import { day, money, metrics, round, DAY, statuses } from './domain-v2.mjs';
import { ProgressSteps } from './Progress';
import { Panel, Badge, Empty, Demo } from './ui';

// 经营数据: a daily report produced by AuditReportingAgent (database totals, generated once per
// date and on request), a trend chart, and the order list. Reports are kept for this browser tab.
const reportCache = new Map();
const orderSignature = (s, date) => JSON.stringify(s.orders.filter(o => day(o.created) === date || (o.settledAt && day(o.settledAt) === date)).map(o => [o.id, o.status, o.held]));

function useDailyReport(s, date) {
  const [entry, setEntry] = useState(() => reportCache.get(date) || null);
  const [steps, setSteps] = useState([]);
  const [status, setStatus] = useState(reportCache.has(date) ? 'done' : 'running');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const cached = reportCache.get(date);
    if (cached && version === 0) { setEntry(cached); setStatus('done'); setSteps([]); return; }
    let active = true; const controller = new AbortController();
    setEntry(cached || null); setSteps([]); setStatus('running');
    const onEvent = event => { if (active) setSteps(list => { const i = list.findIndex(x => x.key === event.key); return i < 0 ? [...list, event] : list.map((x, j) => j === i ? event : x); }); };
    (async () => {
      try {
        const response = await fetch('/api/reports?' + new URLSearchParams({ start: date, end: date }), { headers: { 'X-Demo-Role': 'manager', Accept: 'application/x-ndjson' }, signal: controller.signal });
        if (!response.ok) throw Error('report');
        const data = (response.headers.get('content-type') || '').includes('ndjson') ? (await readStream(response, onEvent)).result : await response.json();
        const next = { report: data, time: new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit' }), signature: orderSignature(s, date) };
        reportCache.set(date, next);
        if (active) { setEntry(next); setStatus('done'); }
      } catch (error) {
        if (active && error.name !== 'AbortError') { setStatus('failed'); setSteps(list => list.map(x => x.status === 'running' ? { ...x, status: 'failed' } : x)); }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [date, version]);
  return { entry, steps, status, regenerate: () => { reportCache.delete(date); setVersion(v => v + 1); } };
}

export function Overview() {
  const _tr = useLanguage();
  const en = useLanguageCode() === 'en';
  const L = (zh, english) => en ? english : zh;
  const { s } = useStore();
  const today = day(s.now);
  const [offset, setOffset] = useState(0);
  const date = day(s.now - offset * DAY);
  const { entry, steps, status, regenerate } = useDailyReport(s, date);
  const r = entry?.report;
  const stale = entry && entry.signature !== orderSignature(s, date);

  const change = (now, before, isMoney) => {
    if (before == null) return '';
    if (now === before) return L('与昨日持平', 'Same as yesterday');
    if (!isMoney) return L(`较昨日 ${now > before ? '+' : '−'}${Math.abs(now - before)}`, `${now > before ? '+' : '−'}${Math.abs(now - before)} vs yesterday`);
    if (!before) return L('昨日为 0', 'Yesterday was 0');
    const pct = Math.abs((now - before) / before * 100).toFixed(1);
    return L(`较昨日 ${now > before ? '↑' : '↓'} ${pct}%`, `${now > before ? '↑' : '↓'} ${pct}% vs yesterday`);
  };
  const audit = r?.reportId && (s.audit || []).find(a => a.sourceRequestId === r.reportId);

  const tiles = [
    { label: L('销售额', 'Sales'), value: r && money(r.sales), sub: r && L(`新订单 ${r.count} 单`, `${r.count} new order(s)`), delta: r && change(r.sales, r.previous?.sales, true) },
    { label: L('完成订单', 'Completed orders'), value: r?.completed, sub: L('当日结算完成', 'Settled on this day'), delta: r && change(r.completed, r.previous?.completed) },
    { label: L('平台收入', 'Platform income'), value: r && money(r.income), sub: L('商品 2% ＋ 物流 10%', 'Item 2% + delivery 10%'), delta: r && change(r.income, r.previous?.income, true) },
    { label: L('冲突', 'Conflicts'), value: r?.conflicts, sub: r && L(`目前待决策 ${r.openConflicts}`, `${r.openConflicts} awaiting decision`), delta: r && change(r.conflicts, r.previous?.conflicts), to: r?.openConflicts ? '/manager/exceptions' : null, warn: r?.openConflicts > 0 },
    { label: L('留置资金', 'Held funds'), value: r && money(r.heldNow), sub: L('当前余额，不随日期变化', 'Current balance'), delta: '' }
  ];

  return <>
    <div className="page-head biz-head"><h1>{_tr('经营数据')}</h1><Demo /></div>

    <section className="biz-report">
      <header>
        <div><h2>{L('当日经营报告', 'Daily report')}</h2><small>{L('由审计 Agent 汇总数据库中的订单与结算记录', 'Compiled by the Audit Reporting Agent from database orders and settlements')}</small></div>
        <div className="biz-date">
          <button aria-label={L('前一天', 'Previous day')} onClick={() => setOffset(o => o + 1)}>←</button>
          <b>{date}</b>{offset === 0 && <span>{L('今天', 'Today')}</span>}
          <button aria-label={L('后一天', 'Next day')} disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - 1))}>→</button>
          <button className="biz-regen" disabled={status === 'running'} onClick={regenerate}>{status === 'running' ? L('生成中…', 'Generating…') : L('重新生成', 'Regenerate')}</button>
        </div>
      </header>
      <div className="biz-tiles">
        {tiles.map(t => {
          const body = <><span>{t.label}</span><strong>{t.value ?? '—'}</strong><small>{t.sub}</small>{t.delta && <em>{t.delta}</em>}</>;
          return t.to ? <Link key={t.label} to={t.to} className={'biz-tile' + (t.warn ? ' warn' : '')}>{body}</Link> : <div key={t.label} className={'biz-tile' + (t.warn ? ' warn' : '')}>{body}</div>;
        })}
      </div>
      {status === 'running' && <ProgressSteps title={L('审计 Agent 正在生成报告', 'Audit Reporting Agent is preparing the report')} steps={steps} status="running" />}
      {status === 'failed' && <p className="notice warning">{L('报告生成失败，请点击“重新生成”。', 'The report could not be generated. Please regenerate.')}</p>}
      {status === 'done' && <div className="biz-audit">
        <span className={'biz-audit-mark' + (audit?.auditFindings?.length ? ' warn' : audit ? ' ok' : '')} />
        <p>{audit
          ? <><b>{L('审计结论：', 'Audit conclusion: ')}</b>{_tr(audit.text)}{audit.auditFindings?.length > 0 && <span className="biz-findings">{audit.auditFindings.map(f => _tr(f)).join('；')}</span>}</>
          : <><b>{L('审计结论：', 'Audit conclusion: ')}</b>{L('审计 Agent 正在复核本次报告的执行记录…', 'The Audit Reporting Agent is reviewing this report…')}</>}</p>
        <small>{L(`生成于 ${entry.time}`, `Generated ${entry.time}`)}{stale && <> · <button className="text-button" onClick={regenerate}>{L('当日订单有更新，重新生成 →', 'Orders changed — regenerate →')}</button></>}</small>
      </div>}
    </section>

    <Trend s={s} today={today} selected={date} onSelect={d => setOffset(Math.round((new Date(today) - new Date(d)) / DAY))} L={L} />
    <Orders s={s} today={today} L={L} />
  </>;
}

const RANGES = [[7, '近 7 天', '7 days'], [30, '近 30 天', '30 days'], [0, '全部', 'All']];
const MEASURES = [['sales', '销售额', 'Sales'], ['income', '平台收入', 'Income'], ['count', '订单数', 'Orders']];

function Trend({ s, today, selected, onSelect, L }) {
  const [range, setRange] = useState(7);
  const [measure, setMeasure] = useState('sales');
  const days = useMemo(() => {
    const first = range ? s.now - (range - 1) * DAY : Math.min(s.now, ...s.orders.map(o => o.created));
    const n = Math.max(1, Math.round((new Date(today) - new Date(day(first))) / DAY) + 1);
    return Array.from({ length: n }, (_, i) => { const d = day(new Date(today).getTime() - (n - 1 - i) * DAY); return { d, ...metrics(s, d, d) }; });
  }, [s, today, range]);
  const value = x => x[measure];
  const max = Math.max(...days.map(value), 0);
  const total = round(days.reduce((a, x) => a + value(x), 0));
  const fmt = v => measure === 'count' ? v : money(v);
  const step = Math.ceil(days.length / 10);
  return <Panel className="biz-trend">
    <header>
      <div><h2>{L('趋势', 'Trend')}</h2><small>{L(`合计 ${fmt(total)} · 点击柱子查看当日报告`, `Total ${fmt(total)} · click a bar to open that day's report`)}</small></div>
      <div className="biz-seg">{MEASURES.map(([k, zh, en]) => <button key={k} aria-pressed={measure === k} onClick={() => setMeasure(k)}>{L(zh, en)}</button>)}</div>
      <div className="biz-seg">{RANGES.map(([k, zh, en]) => <button key={k} aria-pressed={range === k} onClick={() => setRange(k)}>{L(zh, en)}</button>)}</div>
    </header>
    <div className="biz-chart" role="img" aria-label={L('每日趋势', 'Daily trend')}>
      <span className="biz-max">{fmt(max)}</span>
      {!max && <p className="biz-empty">{L('这段时间还没有数据，可切换到“全部”查看。', 'No data in this period. Try “All”.')}</p>}
      {days.map((x, i) => <button key={x.d} className={'biz-bar' + (x.d === selected ? ' selected' : '')} title={`${x.d} · ${fmt(value(x))}`} onClick={() => onSelect(x.d)}>
        <i style={{ height: max ? Math.max(value(x) / max * 100, value(x) ? 3 : 0) + '%' : 0 }} />
        <small>{(i % step === 0 || i === days.length - 1) ? x.d.slice(5) : ''}</small>
      </button>)}
    </div>
  </Panel>;
}

const fee = o => round(o.item.price * .02) + round(o.deliveryFee * .1);

function Orders({ s, today, L }) {
  const [tab, setTab] = useState('active');
  const conflictIds = new Set((s.exceptions || []).filter(e => e.status === 'open').map(e => e.orderId));
  const groups = {
    active: s.orders.filter(o => o.status !== 'settled'),
    done: s.orders.filter(o => o.status === 'settled'),
    conflict: s.orders.filter(o => conflictIds.has(o.id))
  };
  const touchedToday = o => [o.created, o.settledAt, o.delivered, ...(o.events || []).map(e => e.time)].some(t => t && day(t) === today);
  const list = [...groups[tab]].sort((a, b) => b.created - a.created);
  const tabs = [['active', '进行中', 'In progress'], ['done', '已完成', 'Completed'], ['conflict', '有冲突', 'Conflicts']];
  const _tr = useLanguage();
  return <Panel className="biz-orders">
    <header>
      <h2>{L('订单明细', 'Orders')}</h2>
      <div className="tabs">{tabs.map(([k, zh, en]) => <button key={k} className={tab === k ? 'selected' : ''} onClick={() => setTab(k)}>{L(zh, en)} {groups[k].length}</button>)}</div>
      <small className="biz-legend"><i />{L('今日有变化', 'Changed today')}</small>
    </header>
    <div className="table-wrap"><table>
      <thead><tr><th>{L('订单 / 家具', 'Order / item')}</th><th>{L('下单日期', 'Ordered')}</th><th>{L('阶段', 'Stage')}</th><th>{L('商品金额', 'Item')}</th><th>{L('配送费', 'Delivery')}</th><th>{L('当前留置', 'Held')}</th><th>{L('结算日期', 'Settled')}</th><th>{L('平台服务费', 'Platform fee')}</th></tr></thead>
      <tbody>{list.map(o => <tr key={o.id}>
        <td><Link to={'/manager/records/' + o.id}>{touchedToday(o) && <i className="biz-dot" />}{_tr(o.item.name)}</Link><small>{o.id}{conflictIds.has(o.id) && <Badge tone="danger">{L('冲突', 'Conflict')}</Badge>}</small></td>
        <td>{day(o.created)}</td><td><Badge>{_tr(statuses[o.status])}</Badge></td>
        <td>{money(o.item.price)}</td><td>{money(o.deliveryFee)}</td><td>{o.held ? money(o.total) : '—'}</td>
        <td>{o.settledAt ? day(o.settledAt) : '—'}</td><td>{o.settledAt ? money(fee(o)) : '—'}</td>
      </tr>)}</tbody>
    </table>{!list.length && <Empty text={L('没有符合条件的订单', 'No matching orders')} />}</div>
  </Panel>;
}
