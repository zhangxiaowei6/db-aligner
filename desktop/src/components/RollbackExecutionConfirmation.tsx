import { useMemo } from 'react';
import type { ConnectionInfo, DbRef, RollbackItem, RollbackPlan } from '../types';
import { fromKey } from '../model';
import { ExecutionConfirmation } from './ExecutionConfirmation';

export function RollbackExecutionConfirmation({
  rollback,
  selectedIds,
  source,
  connections,
}: {
  rollback: RollbackPlan;
  selectedIds: string[];
  source?: DbRef;
  connections: ConnectionInfo[];
}) {
  const targets = useMemo(() => {
    const selected = new Set(selectedIds);
    const groups = new Map<string, RollbackItem[]>();
    for (const item of rollback.items) {
      if (!item.eligible || !selected.has(item.id)) continue;
      const items = groups.get(item.targetKey) || [];
      items.push(item);
      groups.set(item.targetKey, items);
    }
    return [...groups].map(([key, items]) => ({
      ref: fromKey(key),
      count: items.length,
      script: () =>
        items
          .map((item, index) => {
            const label = `${item.table} / ${item.label}`.replace(/[\r\n]/g, ' ');
            const sql = item.sql
              .map((statement) => {
                const trimmed = statement.trim();
                return trimmed.endsWith(';') ? trimmed : trimmed + ';';
              })
              .join('\n');
            return `-- ${index + 1}. ${label}\n${sql}`;
          })
          .join('\n\n'),
    }));
  }, [rollback, selectedIds]);
  return (
    <ExecutionConfirmation
      source={source}
      sourceLabel="原同步来源数据库"
      connections={connections}
      targets={targets}
      targetTitle="回滚以下"
      summary={
        <>
          <p className="hint">
            原同步记录：{rollback.recordId}。仅恢复上述目标库，来源库不执行回滚。
          </p>
          <p className="hint">
            共恢复 {targets.reduce((count, target) => count + target.count, 0)} 项已选变更，
            执行前会再次核验目标状态与恢复资料，并保存关联回滚记录。未选或被阻止的项不执行。
          </p>
        </>
      }
    />
  );
}
