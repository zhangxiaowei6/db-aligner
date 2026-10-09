import { Alert, Empty, Space, Tag } from 'antd';
import { DataTable } from './shared';
import SqlView from './SqlView';
import { displayValue, kindLabels, type ReviewNode } from '../model';
import type { Change, Column, SyncPlan, Table } from '../types';

type ComparisonRow = { name: string; source: unknown; target: unknown; changed: boolean };
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
function Comparison({
  rows,
  sourceTitle = '源库定义',
  targetTitle = '目标库现状',
}: {
  rows: ComparisonRow[];
  sourceTitle?: string;
  targetTitle?: string;
}) {
  return (
    <DataTable<ComparisonRow>
      size="small"
      rowKey="name"
      pagination={false}
      dataSource={rows}
      rowClassName={(row) => (row.changed ? 'difference-row' : '')}
      columns={[
        { title: '属性', dataIndex: 'name', width: 100 },
        { title: sourceTitle, dataIndex: 'source', width: 120, render: displayValue },
        { title: targetTitle, dataIndex: 'target', width: 120, render: displayValue },
        {
          title: '差异',
          width: 64,
          align: 'left',
          render: (_, row) =>
            row.changed ? (
              <Tag color="warning" className="difference-status">
                不同
              </Tag>
            ) : (
              <span className="hint">相同</span>
            ),
        },
      ]}
    />
  );
}
export function DiffInspector({
  plan,
  node,
  selectedIds,
  onInspect,
}: {
  plan: SyncPlan;
  node?: ReviewNode;
  selectedIds: string[];
  onInspect: (change: Change) => void;
}) {
  if (!node) return <Empty description="选择数据库、表或变更项查看详情" />;
  const change = node.change;
  const target = plan.targets.find(
    (item) =>
      `${item.ref.connectionId}/${item.ref.database}` === (change?.targetKey || node.targetKey),
  );
  if (!target) return <Empty description="没有可查看的差异" />;
  const changes = target.changes.filter(
    (item) => node.type !== 'table' || item.table === node.label,
  );
  if (!change) {
    const tables = [...new Set(changes.map((item) => item.table))];
    return (
      <>
        <h2>
          {target.ref.database}
          {node.type === 'table' ? ` / ${node.label}` : ''} · 全部差异
        </h2>
        <Space wrap size={8} className="bottom-gap">
          <Tag>{tables.length} 张表</Tag>
          <Tag>{changes.length} 项变更</Tag>
          <Tag color="processing">
            已选 {changes.filter((item) => selectedIds.includes(item.id) && !item.blocked).length}{' '}
            项
          </Tag>
        </Space>
        {node.type === 'table' && !target.before[node.label]?.exists && (
          <Alert
            className="bottom-gap"
            showIcon
            type="info"
            title="目标库没有这张表"
            description={
              changes.some((item) => item.kind === 'CREATE_TABLE')
                ? '已生成创建表操作；同步数据时必须同时选中创建表，执行时先建表再写入数据。'
                : '仅同步数据无法写入不存在的表，请返回同步范围启用结构同步，或先创建目标表后重新比较。'
            }
          />
        )}
        <p className="hint bottom-gap">
          包含此{node.type === 'table' ? '表' : '库'}
          的结构和数据变更。点击任一变更查看源库与目标库的具体差异。
        </p>
        <DataTable<Change>
          size="small"
          rowKey="id"
          dataSource={changes}
          onRow={(item) => ({
            onClick: () => onInspect(item),
            tabIndex: 0,
            onKeyDown: (event) => {
              if (event.key === 'Enter') onInspect(item);
            },
          })}
          columns={[
            { title: '表', dataIndex: 'table', width: 160, ellipsis: true },
            { title: '变更对象', dataIndex: 'label', width: 180, ellipsis: true },
            {
              title: '变更类型',
              dataIndex: 'kind',
              width: 125,
              render: (kind: string) => kindLabels[kind] || kind,
            },
            {
              title: '执行状态',
              width: 100,
              render: (_, item) => (
                <Tag
                  color={
                    item.blocked
                      ? 'error'
                      : selectedIds.includes(item.id)
                        ? 'processing'
                        : 'default'
                  }
                >
                  {item.blocked ? '无法执行' : selectedIds.includes(item.id) ? '已选' : '未选'}
                </Tag>
              ),
            },
          ]}
        />
      </>
    );
  }
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
  const isColumn = ['ADD_COLUMN', 'MODIFY_COLUMN', 'DROP_COLUMN'].includes(change.kind);
  const rows = isColumn ? columnRows(sourceTable, targetTable, change.label) : [];
  const changed = rows.filter((row) => row.changed).map((row) => row.name);
  const dataRows = change.kind.endsWith('_ROW')
    ? [...new Set([...Object.keys(change.after), ...Object.keys(change.before)])].map((name) => {
        const sourceExists = change.kind !== 'DELETE_ROW' && Object.hasOwn(change.after, name);
        const targetExists = change.kind !== 'ADD_ROW' && Object.hasOwn(change.before, name);
        return {
          name,
          source:
            change.kind === 'DELETE_ROW'
              ? '不存在该行'
              : sourceExists
                ? change.after[name]
                : '未提供该字段',
          target:
            change.kind === 'ADD_ROW'
              ? '不存在该行'
              : targetExists
                ? change.before[name]
                : '未提供该字段',
          changed:
            sourceExists !== targetExists ||
            JSON.stringify(change.after[name]) !== JSON.stringify(change.before[name]),
        };
      })
    : [];
  const tableRows = ['CREATE_TABLE', 'TABLE_COMMENT', 'TABLE_COLLATION'].includes(change.kind)
    ? (['exists', 'comment', 'engine', 'charset', 'collation'] as const).map((key, index) => {
        const planned =
          (change.kind === 'TABLE_COMMENT' && key !== 'comment' && key !== 'exists') ||
          (change.kind === 'TABLE_COLLATION' && !['charset', 'collation', 'exists'].includes(key))
            ? targetTable
            : sourceTable;
        const a = key === 'exists' ? (planned?.exists ? '存在' : '不存在') : planned?.[key];
        const b =
          key === 'exists'
            ? targetTable?.exists
              ? '存在'
              : '不存在'
            : targetTable?.exists
              ? targetTable[key]
              : '不存在该表';
        return {
          name: ['表状态', '表说明', '存储引擎', '字符集', '排序规则'][index],
          source: a,
          target: b,
          changed: a !== b,
        };
      })
    : [];
  const isIndex = change.kind.includes('INDEX');
  const isForeignKey = change.kind.endsWith('_FK');
  const objectRows =
    isIndex || isForeignKey
      ? [
          {
            name: isIndex ? '索引定义' : '外键定义',
            source:
              (isIndex ? sourceTable?.indexes : sourceTable?.foreignKeys)?.find(
                (item) => item.name === change.label,
              )?.definition || '不存在',
            target:
              (isIndex ? targetTable?.indexes : targetTable?.foreignKeys)?.find(
                (item) => item.name === change.label,
              )?.definition || '不存在',
            changed: true,
          },
        ]
      : [];
  return (
    <>
      <h2>
        {target.ref.database} / {change.table} / {change.label}
      </h2>
      <dl className="metadata">
        <dt>源库</dt>
        <dd>{plan.source.database}</dd>
        <dt>目标库</dt>
        <dd>{target.ref.database}</dd>
        <dt>变更类型</dt>
        <dd>{kindLabels[change.kind] || change.kind}</dd>
      </dl>
      {change.blocked && (
        <Alert
          className="bottom-gap"
          type="error"
          showIcon
          title={change.label}
          description={change.reason}
        />
      )}
      {isColumn && (
        <>
          <h3>字段定义对比</h3>
          {changed.length > 0 && (
            <p className="difference-summary">
              {change.kind === 'MODIFY_COLUMN' ? '修改了' : '差异属性'}：{changed.join('、')}
            </p>
          )}
          <Comparison rows={rows} sourceTitle={change.after.column ? '本次计划定义' : '源库定义'} />
        </>
      )}
      {!!dataRows.length && (
        <>
          <h3>字段值对比</h3>
          <p className="hint bottom-gap">
            左侧为按源库生成的同步值，右侧为目标库现状；业务键匹配时保留目标主键。
          </p>
          <Comparison rows={dataRows} sourceTitle="源库同步值" />
        </>
      )}
      {!!tableRows.length && (
        <>
          <h3>表定义对比</h3>
          <Comparison
            rows={tableRows}
            sourceTitle={change.kind === 'CREATE_TABLE' ? '源库定义' : '本次计划定义'}
          />
        </>
      )}
      {!!objectRows.length && (
        <>
          <h3>{isIndex ? '索引' : '外键'}定义对比</h3>
          <Comparison rows={objectRows} />
        </>
      )}
      {change.kind === 'CREATE_TABLE' && (
        <Alert
          className="top-gap"
          showIcon
          type="info"
          title="目标表不存在，将先创建表"
          description="执行此项后建立目标表；如果同时同步数据，请同时选中创建表和需要写入的数据变更。"
        />
      )}
      <h3>SQL 预览</h3>
      <SqlView sql={change.sql || '-- 此项不可执行'} />
    </>
  );
}
