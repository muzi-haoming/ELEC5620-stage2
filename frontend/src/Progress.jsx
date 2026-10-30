import React, {useEffect, useState} from 'react';
import {useLanguage, useLanguageCode} from './Language';
import {useStore} from './store';

// Server step labels look like "家具审核助手：审核照片与资料"; translate each half separately.
export function useStepLabel() {
  const t = useLanguage(), lang = useLanguageCode();
  return label => lang === 'en' ? String(label).split('：').map(t).join(': ') : label;
}

// Live, server-reported agent steps for the request in flight, with an optional cancel.
export function ProgressSteps({title, onCancel, cancelNote, steps, status='running'}) {
  const t = useLanguage(), stepLabel = useStepLabel();
  const {progress: liveProgress} = useStore();
  const progress = steps || liveProgress;
  const [started, setStarted] = useState(() => performance.now());
  const [now, setNow] = useState(started);
  const running = status === 'running';
  useEffect(() => {if (!running) return; const begin=performance.now();setStarted(begin);setNow(begin);const timer = setInterval(() => setNow(performance.now()), 500); return () => clearInterval(timer);}, [running]);
  const seconds = ms => (ms / 1000).toFixed(1) + 's';
  return <div className={"agent-progress activity-"+status} role="status" aria-live="polite">
    <div className="agent-progress-head"><span className={running ? "loading-spinner" : "step-icon"} aria-hidden="true">{running ? null : status === "done" ? "✓" : "!"}</span><b>{t(title)}</b>{running && <small>{seconds(now - started)}</small>}
      {running && onCancel && <button type="button" className="button secondary agent-cancel" onClick={onCancel}>{t('取消')}</button>}</div>
    <ol>{progress.length ? progress.map(step => <li key={step.key} className={'step-' + step.status}>
      <span className="step-icon" aria-hidden="true">{step.status === 'done' ? '✓' : step.status === 'failed' ? '✕' : <span className="loading-spinner"/>}</span>
      <span>{stepLabel(step.label)}</span>{step.ms !== undefined && <small>{seconds(step.ms)}</small>}
    </li>) : running && <li className="step-running"><span className="step-icon" aria-hidden="true"><span className="loading-spinner"/></span><span>{t('正在连接服务…')}</span></li>}</ol>
    {!running && <small className="agent-progress-note">{t(status === 'done' ? '处理已完成，结果已保存。' : status === 'stopped' ? '已停止等待，服务端可能仍在处理，请以最新订单状态为准。' : '本次处理未完成，请重试。已通过的检查不代表结果已保存。')}</small>}
    {onCancel && cancelNote && <small className="agent-progress-note">{t(cancelNote)}</small>}
  </div>;
}

// Retain the latest real server steps after completion, scoped to this action and item/order.
export function ActionProgress({operation, subject, title}) {
  const {activity} = useStore();
  if (!activity || activity.operation !== operation || activity.subject !== subject) return null;
  return <ProgressSteps title={title} steps={activity.steps} status={activity.status}/>;
}

export function DeliveryChecks({order}) {
  const t = useLanguage();
  const requests = order.requests || [];
  const blocked = requests.some(r => r.status === 'rejected');
  const waiting = requests.some(r => r.status === 'pending');
  const steps = [
    [requests.length ? '两端物业确认' : '物业确认', blocked ? '存在拒绝回复' : waiting ? '等待物业回复' : requests.length ? (requests.some(r=>r.status==='conditional') ? '已收到附条件回复，请查看具体条件' : '必要物业回复已批准') : '无需物业确认', !blocked && !waiting],
    ['承运安排', order.providerAccepted ? '已确认' : '等待最终检查与承运确认', !!order.providerAccepted],
    ['取货', ['transit','received','settled'].includes(order.status) ? '已取货' : '等待取货', ['transit','received','settled'].includes(order.status)],
    ['送达', order.delivered ? '已记录送达' : '等待送达', !!order.delivered],
  ];
  return <div className="delivery-checks"><h3>{t('配送检查')}</h3><ul>{steps.map(([label, result, done]) => <li key={label}><span className={done ? 'check-done' : ''} aria-hidden="true">{done ? '✓' : '○'}</span><b>{t(label)}</b><span className={"delivery-result "+(done ? "is-complete" : "is-pending")}>{t(result)}</span></li>)}</ul><small>{t(order.delivered ? '家具已送达，物流 Agent 已更新配送状态。' : '物流 Agent 为您同步配送进度。')}</small></div>;
}
