import type { ConnectionInfo, SyncPlan } from '../types';
import { executionScript } from '../sync-scripts';
import { useMemo } from 'react';
import { ExecutionConfirmation } from './ExecutionConfirmation';

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
  const targets = useMemo(() => {
    const selected = new Set(selectedIds);
    return plan.targets
      .map((target) => {
        const changes = target.changes.filter(
          (change) => selected.has(change.id) && !change.blocked,
        );
        return { ref: target.ref, count: changes.length, script: () => executionScript(changes) };
      })
      .filter((target) => target.count > 0);
  }, [plan, selectedIds]);
  return (
    <ExecutionConfirmation
      source={plan.source}
      connections={connections}
      targets={targets}
      targetTitle={saveOnly ? '脚本对应以下' : '同步到以下'}
      summary={
        <>
          {targets.length < plan.targets.length && (
            <p className="hint">
              其余 {plan.targets.length - targets.length} 个目标库没有已选变更，本次不执行。
            </p>
          )}
          <p className="hint">
            {saveOnly ? '将保存' : '共执行'}{' '}
            {targets.reduce((count, target) => count + target.count, 0)} 项变更
            {saveOnly
              ? '的脚本与同步记录，本次不会执行数据库操作。'
              : '，并保存同步记录与恢复资料。'}
          </p>
        </>
      }
    />
  );
}
