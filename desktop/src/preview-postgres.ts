import type { Change, Column, DbRef, SyncPlan, Table, TableChoice, TargetPlan } from './types';
import { effectiveOptions } from './structure-options';

export const postgresTables = ['sys_dict', 'sys_menu', 'sys_user', 'audit_identity'];
export const namespaceKey = (ref: DbRef) =>
  ref.schema === undefined
    ? `${ref.connectionId}/${ref.database}`
    : `pg:${JSON.stringify([ref.connectionId, ref.database, ref.schema])}`;
export const quotePg = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const value = (v: unknown) =>
  v === null
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : typeof v === 'boolean'
        ? v
          ? 'TRUE'
          : 'FALSE'
        : "'" + String(v).replaceAll("'", "''") + "'";
const qualified = (ref: DbRef, name: string) => `${quotePg(ref.schema!)}.${quotePg(name)}`;
const definition = (column: Column) =>
  `${quotePg(column.name)} ${column.type}${column.defaultValue === null ? '' : ' DEFAULT ' + column.defaultValue}${column.nullable ? '' : ' NOT NULL'}`;
export function postgresCreate(ref: DbRef, table: Table) {
  return `CREATE TABLE ${qualified(ref, table.name)} (\n  ${[
    ...table.columns.map(definition),
    `PRIMARY KEY (${(table.primaryKeyColumns || []).map(quotePg).join(',')})`,
  ].join(',\n  ')}\n)`;
}
function column(
  name: string,
  type: string,
  nullable: boolean,
  comment: string,
  ordinal: number,
  defaultValue: string | null = null,
): Column {
  const result: Column = {
    name,
    type,
    nullable,
    comment,
    ordinal,
    defaultValue,
    extra: '',
    generation: '',
    collation: type.includes('character') ? 'default' : '',
    definition: '',
  };
  result.definition = definition(result);
  return result;
}
export function postgresSnapshot(ref: DbRef, name: string): Table {
  const source = ref.connectionId === 'pg-source';
  const compatible = ref.schema === 'reference';
  const table: Table = {
    databaseType: 'postgresql',
    name,
    exists: true,
    createSql: '',
    engine: 'PostgreSQL',
    charset: 'UTF8',
    collation: '',
    comment:
      name === 'sys_dict'
        ? '系统字典'
        : name === 'sys_menu'
          ? '菜单表'
          : name === 'sys_user'
            ? '用户表'
            : '身份列受限示例',
    columns: [
      column('id', 'bigint', false, '主键', 1),
      column('code', 'character varying(64)', false, '业务编码', 2),
      column(
        'dict_name',
        source || compatible ? 'character varying(100)' : 'character varying(64)',
        false,
        source ? '字典名称' : '旧字段说明',
        3,
      ),
      column('sort', 'integer', false, '排序号', 4, '0'),
      column('remark', 'character varying(255)', true, '备注', 5),
    ],
    primaryKeyColumns: ['id'],
    attributes: { schema: ref.schema },
    indexes: [
      {
        name: 'uk_code',
        unique: true,
        type: 'btree',
        columns: ['code'],
        definition: ' USING btree ("code")',
      },
    ],
    foreignKeys: [],
    rows: [],
    supported: name !== 'audit_identity',
    issues: name === 'audit_identity' ? ['首版不支持 identity、serial 或序列默认值'] : [],
  };
  if (!source && !compatible) {
    table.columns = table.columns.filter((c) => c.name !== 'remark');
    table.columns.push(column('legacy_code', 'character varying(32)', true, '待移除的旧字段', 5));
    table.comment += '（旧）';
  }
  if (source && name === 'sys_menu') {
    table.indexes.push({
      name: 'idx_sort',
      unique: false,
      type: 'btree',
      columns: ['sort'],
      definition: ' USING btree ("sort")',
    });
    table.foreignKeys.push({
      name: 'fk_menu_dict',
      definition: `CONSTRAINT "fk_menu_dict" FOREIGN KEY ("id") REFERENCES ${quotePg(ref.schema!)}."sys_dict" ("id")`,
      referencedTable: 'sys_dict',
    });
  }
  if (name === 'sys_dict')
    table.rows = source
      ? [
          { id: 1, code: 'ORDER_STATUS', dict_name: '订单状态', sort: 20, remark: null },
          { id: 2, code: 'PAYMENT_TYPE', dict_name: '支付方式', sort: 30, remark: null },
        ]
      : [
          { id: 8007, code: 'ORDER_STATUS', dict_name: '订单状态（旧）', sort: 10, remark: null },
          { id: 9001, code: 'LEGACY_FLAG', dict_name: '旧标记', sort: 0, remark: null },
        ];
  if (!source && compatible && name === 'sys_user') {
    table.exists = false;
    table.columns = [];
    table.indexes = [];
    table.rows = [];
  }
  table.createSql = table.exists ? postgresCreate(ref, table) : '';
  return table;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function postgresPlan(
  source: DbRef,
  targets: DbRef[],
  choices: TableChoice[],
  workspaceId: string,
  snapshot: (ref: DbRef, table: string) => Table,
): SyncPlan {
  if (!source.schema || targets.some((ref) => !ref.schema))
    throw new Error('请选择 PostgreSQL 数据库和 schema');
  const plan: SyncPlan = {
    id: 'PREVIEW-PG-' + crypto.randomUUID(),
    workspaceId,
    createdAt: new Date().toISOString(),
    source,
    tables: choices,
    sourceSnapshot: Object.fromEntries(
      choices.map((choice) => [choice.name, snapshot(source, choice.name)]),
    ),
    targets: [],
  };
  for (const ref of targets) {
    const target: TargetPlan = {
      ref,
      label: `${ref.database} / ${ref.schema}`,
      error: '',
      serverVersion: '17.x · 虚构预览',
      before: {},
      changes: [],
      skippedTables: [],
    };
    plan.targets.push(target);
    const add = (
      name: string,
      kind: string,
      label: string,
      lines: string[],
      inverse: string[],
      risk = false,
    ): Change => {
      const change: Change = {
        id: crypto.randomUUID(),
        targetKey: namespaceKey(ref),
        table: name,
        kind,
        label,
        sql: lines.join(';\n'),
        statements: lines,
        rollbackSql: inverse,
        before: {},
        after: {},
        blocked: false,
        reason: '',
        risk,
        selected: !risk,
      };
      target.changes.push(change);
      return change;
    };
    const block = (name: string, reason: string) => {
      const change = add(name, 'BLOCKED', '同步受限', [], [], true);
      change.blocked = true;
      change.reason = reason;
    };
    for (const choice of choices) {
      const src = plan.sourceSnapshot[choice.name],
        before = snapshot(ref, choice.name),
        q = qualified(ref, choice.name),
        options = effectiveOptions(choice.structureOptions);
      target.before[choice.name] = before;
      if (choice.data && !before.exists) {
        target.skippedTables!.push(choice.name);
        continue;
      }
      if (!src.supported || !before.supported) {
        block(choice.name, [...src.issues, ...before.issues].join('；'));
        continue;
      }
      if (choice.structure) {
        if (!before.exists) {
          if (
            ![
              options.columns,
              options.tableComment,
              options.columnComments,
              options.indexes,
              options.foreignKeys,
            ].every(Boolean)
          ) {
            block(choice.name, '部分结构细项不能创建完整表，请启用全部受支持细项');
            continue;
          }
          add(
            choice.name,
            'CREATE_TABLE',
            '创建表',
            [
              postgresCreate(ref, src),
              `COMMENT ON TABLE ${q} IS ${value(src.comment)}`,
              ...src.columns.map(
                (col) => `COMMENT ON COLUMN ${q}.${quotePg(col.name)} IS ${value(col.comment)}`,
              ),
            ],
            ['DROP TABLE ' + q],
          );
          for (const index of src.indexes)
            add(
              choice.name,
              'ADD_INDEX',
              index.name,
              [
                `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quotePg(index.name)} ON ${q}${index.definition}`,
              ],
              [`DROP INDEX ${quotePg(ref.schema!)}.${quotePg(index.name)}`],
            );
          continue;
        }
        for (const col of src.columns) {
          const old = before.columns.find((c) => c.name === col.name);
          if (!old && options.columns) {
            const after = { ...col, comment: options.columnComments ? col.comment : '' };
            const x = add(
              choice.name,
              'ADD_COLUMN',
              col.name,
              [
                `ALTER TABLE ${q} ADD COLUMN ${definition(after)}`,
                `COMMENT ON COLUMN ${q}.${quotePg(col.name)} IS ${value(after.comment)}`,
              ],
              [`ALTER TABLE ${q} DROP COLUMN ${quotePg(col.name)}`],
            );
            x.after.column = after;
          } else if (old) {
            const after = {
              ...(options.columns ? col : old),
              ordinal: old.ordinal,
              comment: options.columnComments ? col.comment : old.comment,
            };
            const lines: string[] = [],
              inverse: string[] = [];
            if (options.columns && col.type !== old.type) {
              lines.push(
                `ALTER TABLE ${q} ALTER COLUMN ${quotePg(col.name)} TYPE ${col.type} USING ${quotePg(col.name)}::${col.type}`,
              );
              inverse.push(
                `ALTER TABLE ${q} ALTER COLUMN ${quotePg(col.name)} TYPE ${old.type} USING ${quotePg(col.name)}::${old.type}`,
              );
            }
            if (options.columnComments && col.comment !== old.comment) {
              lines.push(`COMMENT ON COLUMN ${q}.${quotePg(col.name)} IS ${value(col.comment)}`);
              inverse.push(`COMMENT ON COLUMN ${q}.${quotePg(col.name)} IS ${value(old.comment)}`);
            }
            if (lines.length) {
              const x = add(
                choice.name,
                'MODIFY_COLUMN',
                col.name,
                lines,
                inverse,
                col.type !== old.type,
              );
              x.before.column = old;
              x.after.column = after;
              x.changedParts = col.type !== old.type ? ['columns'] : ['columnComments'];
            }
          }
        }
        if (options.columns)
          for (const old of before.columns.filter(
            (c) => !src.columns.some((col) => col.name === c.name),
          )) {
            const x = add(
              choice.name,
              'DROP_COLUMN',
              old.name,
              [`ALTER TABLE ${q} DROP COLUMN ${quotePg(old.name)}`],
              [`ALTER TABLE ${q} ADD COLUMN ${definition(old)}`],
              true,
            );
            x.before.column = old;
          }
        if (options.indexes) {
          for (const index of src.indexes.filter(
            (idx) => !before.indexes.some((old) => old.name === idx.name),
          ))
            add(
              choice.name,
              'ADD_INDEX',
              index.name,
              [
                `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quotePg(index.name)} ON ${q}${index.definition}`,
              ],
              [`DROP INDEX ${quotePg(ref.schema!)}.${quotePg(index.name)}`],
            );
        }
        if (options.foreignKeys) {
          for (const key of src.foreignKeys.filter(
            (fk) => !before.foreignKeys.some((old) => old.name === fk.name),
          ))
            add(
              choice.name,
              'ADD_FK',
              key.name,
              [
                `ALTER TABLE ${q} ADD ${key.definition.replace(quotePg(source.schema!) + '.', quotePg(ref.schema!) + '.')}`,
              ],
              [`ALTER TABLE ${q} DROP CONSTRAINT ${quotePg(key.name)}`],
            );
        }
        if (options.tableComment && src.comment !== before.comment)
          add(
            choice.name,
            'TABLE_COMMENT',
            '表注释',
            [`COMMENT ON TABLE ${q} IS ${value(src.comment)}`],
            [`COMMENT ON TABLE ${q} IS ${value(before.comment)}`],
          );
      } else {
        if (
          !same(
            src.columns.map((c) => [c.name, c.type, c.collation]),
            before.columns.map((c) => [c.name, c.type, c.collation]),
          )
        ) {
          block(choice.name, '字段类型或排序规则不同，请先同步结构');
          continue;
        }
        const keys = choice.keyColumns.length ? choice.keyColumns : src.primaryKeyColumns || [];
        if (!keys.length || keys.some((key) => !src.columns.some((col) => col.name === key))) {
          block(choice.name, '请指定可靠的唯一匹配键');
          continue;
        }
        const keyOf = (row: Record<string, unknown>) => JSON.stringify(keys.map((key) => row[key]));
        const valid = (rows: Record<string, unknown>[]) =>
          rows.every((row) => keys.every((key) => row[key] !== null && row[key] !== undefined)) &&
          new Set(rows.map(keyOf)).size === rows.length;
        if (!valid(src.rows) || !valid(before.rows)) {
          block(choice.name, '匹配键存在空值或重复值');
          continue;
        }
        const where = (row: Record<string, unknown>, fields: string[]) =>
          fields
            .map((field) => `${quotePg(field)} IS NOT DISTINCT FROM ${value(row[field])}`)
            .join(' AND ');
        const insert = (row: Record<string, unknown>) =>
          `INSERT INTO ${q} (${Object.keys(row).map(quotePg).join(',')}) VALUES (${Object.values(row).map(value).join(',')})`;
        for (const row of src.rows) {
          const old = before.rows.find((r) => keyOf(r) === keyOf(row));
          const after = { ...row };
          if (old && !same(keys, src.primaryKeyColumns))
            for (const pk of src.primaryKeyColumns || []) after[pk] = old[pk];
          if (!old) {
            const x = add(
              choice.name,
              'ADD_ROW',
              keys.map((key) => `${key} = ${row[key]}`).join(' / '),
              [insert(after)],
              [`DELETE FROM ${q} WHERE ${where(after, keys)}`],
            );
            x.after = after;
            x.matchColumns = keys;
          } else if (!same(after, old)) {
            const fields = Object.keys(after).filter((field) => after[field] !== old[field]);
            const update = (values: Record<string, unknown>, match: Record<string, unknown>) =>
              `UPDATE ${q} SET ${fields.map((field) => `${quotePg(field)}=${value(values[field])}`).join(',')} WHERE ${where(match, Object.keys(match))}`;
            const x = add(
              choice.name,
              'UPDATE_ROW',
              keys.map((key) => `${key} = ${row[key]}`).join(' / '),
              [update(after, old)],
              [update(old, after)],
            );
            x.before = old;
            x.after = after;
            x.matchColumns = keys;
          }
        }
        for (const row of before.rows.filter(
          (r) => !src.rows.some((entry) => keyOf(entry) === keyOf(r)),
        )) {
          const x = add(
            choice.name,
            'DELETE_ROW',
            keys.map((key) => `${key} = ${row[key]}`).join(' / '),
            [`DELETE FROM ${q} WHERE ${where(row, Object.keys(row))}`],
            [insert(row)],
            true,
          );
          x.before = row;
          x.matchColumns = keys;
        }
      }
    }
  }
  return plan;
}
