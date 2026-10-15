import { namespaceLabel } from '../model';
import { AsyncButton as Button } from './AsyncButton';
import { useEffect, useState } from 'react';
import { Alert, Collapse, Progress, Space, Tooltip } from 'antd';
import { useController } from '../controller';
import { fromKey, refKey } from '../model';
import type { DbRef } from '../types';

export function CompareProgressPanel() {
  const c = useController();
  const { m } = c;
  const task = m.compareTask;
  const [now, setNow] = useState(Date.now());
  const running = !!task && ['RUNNING', 'CANCELLING'].includes(task.status);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!task || !['scope', 'diff'].includes(m.page)) return null;
  const progress = task.progress;
  const plan = m.plan;
  const scope = m.compareScope;
  const source = scope?.sourceKey ? fromKey(scope.sourceKey) : plan?.source;
  const targets = scope?.targetKeys.map(fromKey) || plan?.targets.map((target) => target.ref) || [];
  const tableCount =
    scope?.tables.filter((table) => table.structure || table.data).length ??
    plan?.tables.length ??
    0;
  const name = (ref?: DbRef) =>
    ref
      ? `${m.state.connections.find((connection) => connection.id === ref.connectionId)?.name || ref.connectionId} / ${namespaceLabel(ref)}`
      : '—';
  const role =
    progress.ref && source && refKey(progress.ref) === refKey(source) ? '源库' : '目标库';
  const elapsed = Math.max(
    0,
    Math.floor(((running ? now : m.compareFinishedAt) - m.compareStartedAt) / 1000),
  );
  const completed = task.status === 'COMPLETED' && !!plan;
  const failedTargets = completed ? plan.targets.filter((target) => target.error).length : 0;
  const changes = completed ? plan.targets.flatMap((target) => target.changes) : [];
  const blocked = changes.filter((change) => change.blocked).length;
  const heading =
    task.status === 'CANCELLING'
      ? '正在停止比较…'
      : task.status === 'CANCELLED'
        ? '比较已停止'
        : task.status === 'FAILED'
          ? '比较失败'
          : completed
            ? failedTargets === targets.length && failedTargets > 0
              ? '比较结束，目标库均失败'
              : failedTargets
                ? '比较结束，部分目标库失败'
                : '比较完成'
            : '正在比较';
  return (
    <section className="compare-progress-panel" aria-label="比较进度">
      <Space wrap className="compare-progress-heading">
        <strong>{heading}</strong>
        <span>耗时 {elapsed} 秒</span>
        {running ? (
          <Button
            danger
            size="small"
            disabled={task.status === 'CANCELLING'}
            onClick={() => c.stopCompare()}
          >
            停止比较
          </Button>
        ) : (
          <Button size="small" onClick={() => c.set('compareTask', undefined)}>
            收起
          </Button>
        )}
      </Space>
      <Progress
        percent={
          completed
            ? 100
            : progress.total
              ? Math.min(100, Math.floor((progress.completed / progress.total) * 100))
              : 0
        }
        status={
          task.status === 'FAILED' || failedTargets
            ? 'exception'
            : task.status === 'RUNNING'
              ? 'active'
              : completed
                ? 'success'
                : 'normal'
        }
        size="small"
      />
      <div className="compare-range">
        源库：{name(source)} →{' '}
        {targets.length === 1 ? `目标库：${name(targets[0])}` : `${targets.length} 个目标库`}
      </div>
      {completed ? (
        <>
          <div className={failedTargets ? 'warning-text' : ''}>
            {failedTargets
              ? `比较范围 ${tableCount} 张表 · ${targets.length - failedTargets} 个目标库成功，${failedTargets} 个失败`
              : `已比较 ${tableCount} 张表 · ${targets.length} 个目标库`}
            {' · '}
            {changes.length
              ? `发现 ${changes.length} 项差异${blocked ? `，其中 ${blocked} 项无法执行` : ''}`
              : failedTargets
                ? '成功目标库未发现差异'
                : '未发现差异'}
          </div>
          {(targets.length > 1 || failedTargets > 0) && (
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: 'targets',
                  label: '查看各目标库结果',
                  children: plan.targets.map((target) => (
                    <div key={refKey(target.ref)} className={target.error ? 'warning-text' : ''}>
                      {name(target.ref)} ·{' '}
                      {target.error
                        ? `比较失败：${target.error}`
                        : `比较完成 · ${target.changes.length} 项差异 · ${target.changes.filter((change) => change.blocked).length} 项无法执行`}
                    </div>
                  )),
                },
              ]}
            />
          )}
        </>
      ) : (
        <>
          <div>
            <span>所选 {tableCount} 张表 · </span>
            <Tooltip title="处理总次数 = 所选表数 ×（源库 1 个 + 目标库数量）；包含源库读取和目标库比较，不代表不同表的数量。">
              <span>
                处理进度 {progress.completed} / {progress.total} 次
              </span>
            </Tooltip>
          </div>
          <div>
            {running ? '当前处理' : task.status === 'FAILED' ? '失败位置' : '停止位置'}：
            {progress.ref
              ? `${role} ${name(progress.ref)}${progress.table ? ` / ${progress.table}` : ''} · `
              : ''}
            {progress.phase}
            {running &&
              ['读取数据', '读取匹配键'].includes(progress.phase) &&
              ` · 当前阶段已读取 ${progress.rows} 行`}
          </div>
        </>
      )}
      {m.compareTransportError && <Alert type="warning" title={m.compareTransportError} showIcon />}
      {task.error && <Alert type="error" title={task.error} showIcon />}
    </section>
  );
}
