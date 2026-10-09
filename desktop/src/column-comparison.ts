import type { Change, Column, SyncPlan, Table } from './types';

export type ComparisonRow = { name: string; source: unknown; target: unknown; changed: boolean };
const properties: [keyof Column, string][] = [
  ['name', '字段名'],
  ['type', '数据类型'],
  ['nullable', '允许空'],
  ['defaultValue', '默认值'],
  ['extra', '额外属性'],
  ['comment', '注释'],
  ['generation', '生成表达式'],
  ['collation', '排序规则'],
];
function columnRows(sourceTable?: Table, targetTable?: Table, label?: string): ComparisonRow[] {
  const source = sourceTable?.columns.find((column) => column.name === label);
  const target = targetTable?.columns.find((column) => column.name === label);
  const value = (column: Column | undefined, key: keyof Column) =>
    !column
      ? '不存在该字段'
      : key === 'nullable'
        ? column.nullable
          ? 'YES'
          : 'NO'
        : key === 'defaultValue'
          ? (column.defaultValue ?? null)
          : (column[key] ?? '');
  const rows = properties
    .filter(([key]) => !['generation', 'collation'].includes(key) || source?.[key] || target?.[key])
    .map(([key, name]) => {
      const a = value(source, key),
        b = value(target, key);
      return { name, source: a, target: b, changed: a !== b };
    });
  const position = (table: Table | undefined, column: Column | undefined) => {
    if (!column) return '不存在该字段';
    const index = table!.columns.findIndex((item) => item.name === column.name);
    return index === 0 ? '首列' : `位于 ${table!.columns[index - 1].name} 之后`;
  };
  const a = position(sourceTable, source),
    b = position(targetTable, target);
  rows.push({ name: '字段位置', source: a, target: b, changed: a !== b });
  return rows;
}

export function plannedColumnTables(plan: SyncPlan, change: Change) {
  const target = plan.targets.find(
    (item) => `${item.ref.connectionId}/${item.ref.database}` === change.targetKey,
  );
  if (!target) return {};
  let sourceTable = plan.sourceSnapshot[change.table];
  const targetTable = target.before[change.table];
  if (sourceTable && change.after.column) {
    const planned = change.after.column as unknown as Column;
    const base = targetTable?.exists ? targetTable : sourceTable;
    const columns = base.columns.filter((column) => column.name !== change.label);
    let position = base.columns.findIndex((column) => column.name === change.label);
    if (change.after.first) position = 0;
    else if (change.after.previous)
      position = columns.findIndex((column) => column.name === change.after.previous) + 1;
    else if (position < 0) position = columns.length;
    columns.splice(position, 0, planned);
    sourceTable = { ...base, columns };
  }
  return { sourceTable, targetTable };
}

export function columnComparison(plan: SyncPlan, change: Change): ComparisonRow[] {
  const { sourceTable, targetTable } = plannedColumnTables(plan, change);
  if (!sourceTable && !targetTable) return [];
  return columnRows(sourceTable, targetTable, change.label);
}
export function columnChangeSummary(plan: SyncPlan, change: Change): string {
  return change.kind === 'MODIFY_COLUMN'
    ? columnComparison(plan, change)
        .filter((row) => row.changed)
        .map((row) => row.name)
        .join('、') || '—'
    : '—';
}
