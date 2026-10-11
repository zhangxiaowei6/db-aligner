import type { ConnectionInfo, DbRef, SyncPlan } from '../types';
import SqlView from './SqlView';
import { executionScript } from '../sync-scripts';
import { useMemo, useState } from 'react';
import { Select } from 'antd';

export function SyncExecutionConfirmation({
  plan,
  selectedIds,
  connections,
  saveOnly = false,
}: {
  plan: SyncPlan;
  selectedIds: string[];
  connections: ConnectionInfo[];
  saveOnly?: boolean;
}) {
  const [targetKey, setTargetKey] = useState('');
  const targets = useMemo(() => {
    const selected = new Set(selectedIds);
    return plan.targets
      .map((target) => {
        const changes = target.changes.filter(
          (change) => selected.has(change.id) && !change.blocked,
        );
        return {
          ...target,
          count: changes.length,
          changes,
        };
      })
      .filter((target) => target.count > 0);
  }, [plan, selectedIds]);
  const target =
    targets.find((item) => item.ref.connectionId + '/' + item.ref.database === targetKey) ||
    targets[0];
  const script = useMemo(() => executionScript(target?.changes || []), [target]);
  function database(ref: DbRef) {
    const connection = connections.find((item) => item.id === ref.connectionId);
    return (
      <div className="sync-confirm-database">
        <strong>{ref.database}</strong>
        <span>{connection?.name || ref.connectionId}</span>
        {connection && (
          <small>
            {connection.host}:{connection.port}
          </small>
        )}
      </div>
    );
  }
  return (
    <div className="sync-execution-confirmation">
      <section aria-label="来源数据库">
        <h3>来源数据库</h3>
        <div className="sync-confirm-source">{database(plan.source)}</div>
      </section>
      <section aria-label="目标数据库">
        <h3>
          {saveOnly ? '脚本对应以下' : '同步到以下'} {targets.length} 个目标数据库
        </h3>
        <ul className="sync-confirm-targets">
          {targets.map((target) => (
            <li key={target.ref.connectionId + '/' + target.ref.database}>
              {database(target.ref)}
              <span className="sync-confirm-count">{target.count} 项变更</span>
            </li>
          ))}
        </ul>
      </section>
      {targets.length < plan.targets.length && (
        <p className="hint">
          其余 {plan.targets.length - targets.length} 个目标库没有已选变更，本次不执行。
        </p>
      )}
      <p className="hint">
        {saveOnly ? '将保存' : '共执行'}{' '}
        {targets.reduce((count, target) => count + target.count, 0)} 项变更
        {saveOnly ? '的脚本与同步记录，本次不会执行数据库操作。' : '，并保存同步记录与恢复资料。'}
      </p>
      <section aria-label="本次执行脚本" className="sync-confirm-scripts">
        <h3>本次执行脚本</h3>
        <p className="hint">切换目标库查看全部已选变更的 SQL，可分页查看并复制完整内容。</p>
        <Select
          aria-label="执行脚本目标库"
          className="script-target-select"
          value={target ? target.ref.connectionId + '/' + target.ref.database : undefined}
          onChange={setTargetKey}
          options={targets.map((item) => ({
            value: item.ref.connectionId + '/' + item.ref.database,
            label: `${connections.find((connection) => connection.id === item.ref.connectionId)?.name || item.ref.connectionId} / ${item.ref.database} · ${item.count} 项变更`,
          }))}
        />
        {target && (
          <section
            key={target.ref.connectionId + '/' + target.ref.database}
            aria-label={`${target.ref.database} 执行脚本`}
          >
            <h4>
              {target.ref.database} · {target.count} 项变更
            </h4>
            <SqlView sql={script} />
          </section>
        )}
      </section>
    </div>
  );
}
