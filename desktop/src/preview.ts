import type {
  Appearance,
  CompareTask,
  ConnectionInfo,
  DesktopBridge,
  State,
  Table,
  SyncPlan,
  ThemeMode,
  DbRef,
  TableChoice,
} from './types';
import { connectionTestError } from './connection-validation';
import { executionScript } from './sync-scripts';
import { effectiveOptions, fullStructure } from './structure-options';
import { previewStructureChange } from './preview-structure';
import { connectionGroupName, orderedConnections } from './connection-organization';
const listeners = new Set<(event: Record<string, unknown>) => void>();
let themeMode: ThemeMode = 'system';
const currentAppearance = (): Appearance => ({
  themeMode,
  resolvedTheme:
    themeMode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : themeMode,
});
const notifyAppearance = () =>
  listeners.forEach((fn) => fn({ event: 'appearance-changed', appearance: currentAppearance() }));
let stopThemeListener: (() => void) | undefined;
const time = '2026-10-08T07:20:00Z';
const connections = [
  {
    id: 'test',
    name: '测试服务器',
    host: '192.0.2.10',
    port: 3306,
    user: 'sync_user',
    group: '测试环境',
    databases: ['shop_test'],
    workspaceIds: ['default'],
    ssl: false,
    ca: '',
    clientCert: '',
    hasPassword: true,
  },
  ...Array.from({ length: 3 }, (_, i) => ({
    id: 'target' + i,
    name: '目标服务器 ' + (i + 1),
    host: '192.0.2.' + (20 + i),
    port: 3306,
    user: 'sync_user',
    group: '目标环境',
    databases: ['shop_' + String.fromCharCode(97 + i)],
    workspaceIds: ['default'],
    ssl: false,
    ca: '',
    clientCert: '',
    hasPassword: true,
  })),
];
export const previewTable: Table = {
  name: 'sys_dict',
  exists: true,
  createSql:
    "CREATE TABLE `sys_dict` (\n  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',\n  `code` varchar(64) NOT NULL COMMENT '字典编码',\n  `dict_name` varchar(100) NOT NULL COMMENT '字典名称',\n  `sort` int NOT NULL DEFAULT '0' COMMENT '排序号',\n  `remark` varchar(255) DEFAULT NULL COMMENT '备注',\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `uk_code` (`code`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统字典'",
  engine: 'InnoDB',
  charset: 'utf8mb4',
  collation: 'utf8mb4_general_ci',
  comment: '系统字典',
  columns: [
    {
      name: 'id',
      type: 'bigint',
      nullable: false,
      defaultValue: null,
      extra: 'auto_increment',
      comment: '主键',
      ordinal: 1,
      definition: "`id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键'",
    },
    {
      name: 'code',
      type: 'varchar(64)',
      nullable: false,
      defaultValue: null,
      extra: '',
      comment: '字典编码',
      ordinal: 2,
      definition: "`code` varchar(64) NOT NULL COMMENT '字典编码'",
    },
    {
      name: 'dict_name',
      type: 'varchar(100)',
      nullable: false,
      defaultValue: null,
      extra: '',
      comment: '字典名称',
      ordinal: 3,
      definition: "`dict_name` varchar(100) NOT NULL COMMENT '字典名称'",
    },
    {
      name: 'sort',
      type: 'int',
      nullable: false,
      defaultValue: '0',
      extra: '',
      comment: '排序号',
      ordinal: 4,
      definition: '`sort` int NOT NULL DEFAULT 0',
    },
    {
      name: 'remark',
      type: 'varchar(255)',
      nullable: true,
      defaultValue: null,
      extra: '',
      comment: '备注',
      ordinal: 5,
      definition: "`remark` varchar(255) NULL COMMENT '备注'",
    },
  ],
  indexes: [
    {
      name: 'PRIMARY',
      unique: true,
      type: 'BTREE',
      columns: ['id'],
      definition: 'PRIMARY KEY (`id`)',
    },
    {
      name: 'uk_code',
      unique: true,
      type: 'BTREE',
      columns: ['code'],
      definition: 'UNIQUE KEY `uk_code` (`code`)',
    },
  ],
  foreignKeys: [],
  rows: [],
  supported: true,
  issues: [],
};
const change = (
  id: string,
  table: string,
  kind: string,
  label: string,
  sql: string,
  risk = false,
) => ({
  id,
  targetKey: 'target0/shop_a',
  table,
  kind,
  label,
  sql,
  rollbackSql: [],
  before: {},
  after: {},
  risk,
  selected: !risk,
  blocked: false,
  reason: '',
});
export const previewPlan: SyncPlan = {
  // Historical mixed fixture for archive compatibility and synthetic test scenarios.
  id: 'PREVIEW-PLAN',
  workspaceId: 'default',
  createdAt: time,
  source: { connectionId: 'test', database: 'shop_test' },
  tables: [
    { name: 'sys_dict', structure: true, data: true, keyColumns: ['code'] },
    { name: 'sys_menu', structure: true, data: true, keyColumns: ['code'] },
    { name: 'sys_user', structure: true, data: false, keyColumns: [] },
  ],
  sourceSnapshot: {
    sys_dict: previewTable,
    sys_menu: {
      ...previewTable,
      name: 'sys_menu',
      comment: '菜单表',
      indexes: [
        ...previewTable.indexes,
        {
          name: 'idx_code',
          unique: true,
          type: 'BTREE',
          columns: ['code'],
          definition: 'UNIQUE KEY `idx_code` (`code`)',
        },
      ],
    },
    sys_user: {
      ...previewTable,
      name: 'sys_user',
      comment: '用户表',
      createSql: previewTable.createSql.replace('sys_dict', 'sys_user'),
    },
  },
  targets: connections.slice(1).map((c, i) => ({
    ref: { connectionId: c.id, database: c.databases[0]! },
    label: c.databases[0]!,
    error: '',
    serverVersion: '8.0.40',
    before: {
      sys_dict: {
        ...previewTable,
        columns: previewTable.columns
          .filter((c) => c.name !== 'remark')
          .map((column) =>
            column.name === 'dict_name'
              ? {
                  ...column,
                  type: 'varchar(64)',
                  comment: '旧字典名称',
                  definition: "`dict_name` varchar(64) NOT NULL COMMENT '旧字典名称'",
                }
              : column,
          ),
      },
      sys_menu: {
        ...previewTable,
        name: 'sys_menu',
        columns: [
          ...previewTable.columns,
          {
            name: 'old_code',
            type: 'varchar(32)',
            nullable: true,
            defaultValue: null,
            extra: '',
            comment: '旧编码',
            ordinal: 6,
            definition: '`old_code` varchar(32) DEFAULT NULL',
          },
        ],
      },
      sys_user:
        i === 2
          ? {
              ...previewTable,
              name: 'sys_user',
              exists: false,
              columns: [],
              indexes: [],
              createSql: '',
              comment: '',
              rows: [],
            }
          : { ...previewTable, name: 'sys_user', comment: '旧用户表说明' },
    },
    changes:
      i === 0
        ? [
            change(
              'c1',
              'sys_dict',
              'ADD_COLUMN',
              'remark',
              "ALTER TABLE `shop_a`.`sys_dict`\nADD COLUMN `remark` varchar(255) NULL COMMENT '备注';",
            ),
            change(
              'c2',
              'sys_dict',
              'MODIFY_COLUMN',
              'dict_name',
              "ALTER TABLE `shop_a`.`sys_dict` MODIFY COLUMN `dict_name` varchar(100) NOT NULL COMMENT '字典名称';",
              true,
            ),
            change(
              'c3',
              'sys_menu',
              'ADD_INDEX',
              'idx_code',
              'ALTER TABLE `shop_a`.`sys_menu` ADD UNIQUE KEY `idx_code` (`code`);',
            ),
            change(
              'c4',
              'sys_menu',
              'DROP_COLUMN',
              'old_code',
              'ALTER TABLE `shop_a`.`sys_menu` DROP COLUMN `old_code`;',
              true,
            ),
            {
              ...change(
                'd1',
                'sys_dict',
                'UPDATE_ROW',
                'code = ORDER_STATUS',
                "UPDATE `shop_a`.`sys_dict` SET `dict_name`='订单状态', `sort`=20 WHERE `code`='ORDER_STATUS';",
              ),
              before: { id: 8007, code: 'ORDER_STATUS', dict_name: '订单状态（旧）', sort: 10 },
              after: { id: 8007, code: 'ORDER_STATUS', dict_name: '订单状态', sort: 20 },
            },
            {
              ...change(
                'd2',
                'sys_dict',
                'ADD_ROW',
                'code = PAYMENT_TYPE',
                "INSERT INTO `shop_a`.`sys_dict` (`code`,`dict_name`) VALUES ('PAYMENT_TYPE','支付方式');",
              ),
              after: { code: 'PAYMENT_TYPE', dict_name: '支付方式' },
            },
            {
              ...change(
                'd3',
                'sys_dict',
                'DELETE_ROW',
                'code = LEGACY_FLAG',
                "DELETE FROM `shop_a`.`sys_dict` WHERE `code`='LEGACY_FLAG';",
                true,
              ),
              before: { code: 'LEGACY_FLAG', dict_name: '旧标记' },
            },
          ]
        : [
            change(
              'x' + i,
              'sys_user',
              i === 2 ? 'CREATE_TABLE' : 'TABLE_COMMENT',
              i === 2 ? '创建表' : '表注释',
              i === 2
                ? previewTable.createSql.replace('`sys_dict`', '`shop_c`.`sys_user`')
                : 'ALTER TABLE `shop_' +
                    String.fromCharCode(97 + i) +
                    "`.`sys_user` COMMENT='用户表';",
            ),
          ].map((x) => ({ ...x, targetKey: c.id + '/' + c.databases[0] })),
  })),
};
// Virtual archive samples let reviewers inspect both script tabs without connecting to a database.
const previewRollback: Record<string, string> = {
  c1: 'ALTER TABLE `shop_a`.`sys_dict` DROP COLUMN `remark`;',
  c2: "ALTER TABLE `shop_a`.`sys_dict` MODIFY COLUMN `dict_name` varchar(64) NOT NULL COMMENT '旧字典名称';",
  c3: 'ALTER TABLE `shop_a`.`sys_menu` DROP INDEX `idx_code`;',
  c4: 'ALTER TABLE `shop_a`.`sys_menu` ADD COLUMN `old_code` varchar(32) DEFAULT NULL;',
  d1: "UPDATE `shop_a`.`sys_dict` SET `dict_name`='订单状态（旧）', `sort`=10 WHERE `code`='ORDER_STATUS';",
  d2: "DELETE FROM `shop_a`.`sys_dict` WHERE `code`='PAYMENT_TYPE';",
  d3: "INSERT INTO `shop_a`.`sys_dict` (`code`,`dict_name`) VALUES ('LEGACY_FLAG','旧标记');",
  x1: "ALTER TABLE `shop_b`.`sys_user` COMMENT='旧用户表说明';",
  x2: 'DROP TABLE `shop_c`.`sys_user`;',
};
for (const target of previewPlan.targets) {
  for (const change of target.changes) {
    change.rollbackSql = previewRollback[change.id] ? [previewRollback[change.id]] : [];
  }
}
const previewTables = [
  { name: 'sys_dict', comment: '系统字典' },
  { name: 'sys_menu', comment: '菜单表' },
  { name: 'sys_user', comment: '用户表' },
  { name: 'orders', comment: '订单表' },
  { name: 'order_items', comment: '订单明细表' },
  { name: 'order_refund_schedule_with_a_long_table_name', comment: '长表名截断示例' },
];
function previewSnapshot(ref: DbRef, name: string): Table {
  const target = previewPlan.targets.find(
    (item) => item.ref.connectionId === ref.connectionId && item.ref.database === ref.database,
  );
  const source = previewPlan.sourceSnapshot[name] || previewTable;
  const snapshot = structuredClone(target?.before[name] || source);
  // Current examples share one catalog across browsing, scope selection and comparison.
  if (ref.connectionId === 'target1' && ref.database === 'shop_b') {
    if (name === 'sys_dict') Object.assign(snapshot, structuredClone(source));
    if (['sys_menu', 'orders'].includes(name)) {
      Object.assign(snapshot, {
        exists: false,
        columns: [],
        indexes: [],
        foreignKeys: [],
        rows: [],
      });
    }
  }
  snapshot.name = name;
  if (!target?.before[name])
    snapshot.comment = previewTables.find((t) => t.name === name)?.comment || '';
  snapshot.createSql = snapshot.exists
    ? `CREATE TABLE \`${name}\` (\n  ${[
        ...snapshot.columns.map((column) => column.definition),
        ...snapshot.indexes.map((index) => index.definition),
      ].join(
        ',\n  ',
      )}\n) ENGINE=${snapshot.engine} DEFAULT CHARSET=${snapshot.charset} COLLATE=${snapshot.collation} COMMENT='${snapshot.comment.replaceAll("'", "''")}';`
    : '';
  return snapshot;
}
export function buildPreviewPlan(
  source: DbRef,
  targets: DbRef[],
  tables: TableChoice[],
  workspaceId = 'default',
): SyncPlan {
  tables = structuredClone(tables.filter((table) => table.structure || table.data));
  if (!tables.length) throw new Error('请选择需要同步的表');
  if (tables.some((table) => table.structure) && tables.some((table) => table.data))
    throw new Error('每次只能同步结构或数据，请选择一种同步类型');
  if (
    tables.some(
      (table) =>
        table.structure && !Object.values(effectiveOptions(table.structureOptions)).some(Boolean),
    )
  )
    throw new Error('请至少选择一项结构细项');
  const plan = structuredClone(previewPlan);
  plan.id = 'PREVIEW-PLAN-' + crypto.randomUUID();
  plan.createdAt = new Date().toISOString();
  plan.workspaceId = workspaceId;
  plan.source = structuredClone(source);
  plan.tables = tables;
  plan.sourceSnapshot = Object.fromEntries(
    tables.map((table) => [table.name, previewSnapshot(source, table.name)]),
  );
  plan.targets = targets.map((ref) => {
    const fixture = structuredClone(
      previewPlan.targets.find(
        (target) =>
          target.ref.connectionId === ref.connectionId && target.ref.database === ref.database,
      ) || previewPlan.targets[0],
    );
    const originalDatabase = fixture.ref.database;
    fixture.ref = structuredClone(ref);
    fixture.label = ref.database;
    fixture.before = Object.fromEntries(
      tables.map((table) => [table.name, previewSnapshot(ref, table.name)]),
    );
    // shop_b provides compatible data differences; shop_a demonstrates missing source columns.
    if (ref.connectionId === 'target1' && ref.database === 'shop_b')
      fixture.changes.push(
        ...previewPlan.targets[0].changes
          .filter((item) => item.kind.endsWith('_ROW'))
          .map((item) => ({
            ...structuredClone(item),
            sql: item.sql.replaceAll('`shop_a`', '`shop_b`'),
            rollbackSql: item.rollbackSql.map((sql) => sql.replaceAll('`shop_a`', '`shop_b`')),
          })),
      );
    fixture.changes = fixture.changes
      .flatMap((change) => {
        const choice = tables.find((table) => table.name === change.table);
        if (!choice) return [];
        const result = previewStructureChange(
          change,
          choice,
          plan.sourceSnapshot[choice.name],
          fixture.before[choice.name],
          originalDatabase,
        );
        return result ? [result] : [];
      })
      .filter((change) => {
        const choice = tables.find((table) => table.name === change.table);
        return choice && (change.kind.endsWith('_ROW') ? choice.data : choice.structure);
      })
      .map((change) => ({
        ...change,
        id: `${ref.connectionId}/${ref.database}/${change.id}`,
        targetKey: `${ref.connectionId}/${ref.database}`,
        sql: change.sql.replaceAll('`' + originalDatabase + '`', '`' + ref.database + '`'),
        rollbackSql: change.rollbackSql.map((sql) =>
          sql.replaceAll('`' + originalDatabase + '`', '`' + ref.database + '`'),
        ),
      }));
    fixture.skippedTables = [];
    for (const choice of tables) {
      const sourceTable = plan.sourceSnapshot[choice.name];
      const targetTable = fixture.before[choice.name];
      if (choice.structure && !targetTable.exists && fullStructure(choice.structureOptions)) {
        fixture.changes = fixture.changes.filter((item) => item.table !== choice.name);
        fixture.changes.push({
          ...change(
            `${ref.connectionId}/${ref.database}/${choice.name}/create`,
            choice.name,
            'CREATE_TABLE',
            '创建表',
            sourceTable.createSql.replace(
              `\`${choice.name}\``,
              `\`${ref.database}\`.\`${choice.name}\``,
            ),
          ),
          targetKey: `${ref.connectionId}/${ref.database}`,
          rollbackSql: [`DROP TABLE \`${ref.database}\`.\`${choice.name}\`;`],
        });
      }
      if (choice.data && !fixture.before[choice.name].exists) {
        fixture.changes = fixture.changes.filter((item) => item.table !== choice.name);
        fixture.skippedTables.push(choice.name);
        continue;
      }
      const keys = choice.keyColumns.length
        ? choice.keyColumns
        : sourceTable.indexes.find((index) => index.name === 'PRIMARY')?.columns || [];
      const missingColumn = sourceTable.columns.some(
        (column) => !targetTable.columns.some((item) => item.name === column.name),
      );
      const invalidKey = keys.find(
        (key) => !sourceTable.columns.some((column) => column.name === key),
      );
      const collationKey = keys.find(
        (key) =>
          sourceTable.columns.find((column) => column.name === key)?.collation !==
          targetTable.columns.find((column) => column.name === key)?.collation,
      );
      if (choice.data && (missingColumn || !keys.length || invalidKey || collationKey)) {
        fixture.changes = fixture.changes.filter(
          (item) => item.table !== choice.name || !item.kind.endsWith('_ROW'),
        );
        fixture.changes.push({
          ...change(
            `${ref.connectionId}/${ref.database}/${choice.name}/structure-first`,
            choice.name,
            'BLOCKED',
            '先同步字段结构',
            '',
            true,
          ),
          targetKey: `${ref.connectionId}/${ref.database}`,
          blocked: true,
          selected: false,
          reason: missingColumn
            ? '目标表缺少源字段，请先同步结构'
            : invalidKey
              ? `匹配键包含不存在的字段：${invalidKey}`
              : collationKey
                ? `匹配键排序规则不同，请先同步字段结构：${collationKey}`
                : '表无主键，请指定唯一业务键',
        });
      }
      if (
        (!choice.structure || !fullStructure(choice.structureOptions)) &&
        !fixture.before[choice.name].exists
      ) {
        fixture.changes = fixture.changes.filter((item) => item.table !== choice.name);
        fixture.changes.push({
          ...change(
            `${ref.connectionId}/${ref.database}/${choice.name}/missing`,
            choice.name,
            'BLOCKED',
            '目标表不存在',
            '',
            true,
          ),
          targetKey: `${ref.connectionId}/${ref.database}`,
          blocked: true,
          selected: false,
          reason: choice.structure
            ? '部分结构细项不能创建完整表，请启用全部结构细项或先创建目标表'
            : '请启用表结构同步或先创建目标表',
        });
      }
    }
    return fixture;
  });
  return plan;
}
const state: State = {
  workspaces: [
    { id: 'default', name: '跨境电商项目', description: '管理字典、菜单和各站点数据库' },
  ],
  connections,
  connectionGroups: [
    { id: 'preview-source-group', name: '测试环境', sortOrder: 0 },
    { id: 'preview-target-group', name: '目标环境', sortOrder: 1 },
  ],
  templates: [
    {
      id: 'tpl1',
      workspaceId: 'default',
      name: '基础字典与菜单',
      description: '同步系统字典、菜单与用户表结构',
      source: previewPlan.source,
      targets: previewPlan.targets.map((t) => t.ref),
      tables: previewPlan.tables.map((table) => ({ ...table, structure: true, data: false })),
    },
  ],
  records: [
    {
      id: 'SYNC-1008-008',
      workspaceId: 'default',
      createdAt: time,
      mode: 'SAVE_ONLY',
      status: 'UNEXECUTED',
      remark: '更新基础字典与菜单结构',
      parentId: '',
      archivePath: '',
      plan: previewPlan,
      source: previewPlan.source,
      tables: previewPlan.tables,
      targetCount: 3,
      selectedIds: ['c1', 'c3'],
      results: [],
    },
    {
      id: 'PREVIEW-EXECUTED-007',
      workspaceId: 'default',
      createdAt: time,
      mode: 'EXECUTE_AND_SAVE',
      status: 'SUCCESS',
      remark: '界面示例：基础字典同步完成（虚构数据）',
      parentId: '',
      archivePath: '',
      plan: previewPlan,
      source: previewPlan.source,
      tables: previewPlan.tables,
      targetCount: 3,
      selectedIds: ['c3'],
      results: previewPlan.targets.map((target) => ({
        ref: target.ref,
        status: 'SUCCESS',
        error: '',
        steps: [{ changeId: 'c3', status: 'DONE', error: '', startedAt: time, finishedAt: time }],
        backups: {},
        expected: {},
      })),
    },
  ],
  versions: [],
  versionLinks: {},
  settings: {
    id: 'global',
    concurrency: 4,
    perHost: 1,
    batchSize: 500,
    archivePath: 'D:\\DataSync\\archives',
    retention: 'forever',
  },
  external: [],
};
const comparedPlans = new Map<string, SyncPlan>([[previewPlan.id, structuredClone(previewPlan)]]);
// Only retain the failure switch used by the fictional connection tests, never password text.
const connectionFailures = new Map<string, boolean>();
const compareTasks = new Map<string, CompareTask>();
const previewEvent = (task: CompareTask) =>
  listeners.forEach((fn) =>
    fn({
      event: 'compare-progress',
      compareId: task.compareId,
      status: task.status,
      error: task.error,
      progress: task.progress,
    }),
  );
export const previewBridge: DesktopBridge = {
  async invoke<T>(method: string, p: Record<string, unknown> = {}): Promise<T> {
    let result: unknown;
    switch (method) {
      case 'appearance.get':
        result = currentAppearance();
        break;
      case 'appearance.set': {
        if (!['light', 'dark', 'system'].includes(String(p.themeMode)))
          throw new Error('无效主题选项');
        themeMode = p.themeMode as ThemeMode;
        notifyAppearance();
        result = currentAppearance();
        break;
      }
      case 'imports.parse':
        result = Array.from({ length: 32 }, (_, i) => ({
          ...connections[i % connections.length],
          id: `preview-import-${i}`,
          name: `示例连接 ${String(i + 1).padStart(2, '0')}`,
          host: `192.0.2.${100 + i}`,
          credentialStatus: '密码需要重新填写',
          warning: i === 4 ? 'SSH 隧道连接暂不导入' : undefined,
          password: '',
        }));
        break;
      case 'connections.test': {
        const config = p.config ?? state.connections.find((c) => c.id === p.id);
        const validation = connectionTestError(config);
        if (validation) throw new Error(validation);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const value = config as ConnectionInfo;
        if (
          value.password === 'preview-fail' ||
          (!value.password && connectionFailures.get(value.id))
        )
          throw new Error('密码验证失败（虚构预览数据）');
        result = { serverVersion: '8.4.8 · 虚构预览数据' };
        break;
      }
      case 'ping':
        result = { version: '0.1.0', protocol: 1 };
        break;
      case 'state.load':
        result = structuredClone(state);
        break;
      case 'databases.list': {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const connection = state.connections.find((c) => c.id === p.connectionId);
        if (connectionFailures.get(connection?.id || ''))
          throw new Error('密码验证失败（虚构预览数据）');
        result = connection?.databases || [];
        break;
      }
      case 'tables.list': {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const ref = p.ref as DbRef;
        result = previewTables.flatMap((table) => {
          const snapshot = previewSnapshot(ref, table.name);
          return snapshot.exists ? [{ name: table.name, comment: snapshot.comment }] : [];
        });
        break;
      }
      case 'table.get':
        result = previewSnapshot(p.ref as DbRef, String(p.table));
        break;
      case 'sync.compare': {
        result = buildPreviewPlan(
          p.source as DbRef,
          p.targets as DbRef[],
          p.tables as TableChoice[],
          String(p.workspaceId || 'default'),
        );
        comparedPlans.set((result as SyncPlan).id, result as SyncPlan);
        break;
      }
      case 'sync.compare.start': {
        if (
          [...compareTasks.values()].some((task) => ['RUNNING', 'CANCELLING'].includes(task.status))
        )
          throw new Error('已有比较任务');
        const compareId = String(p.compareId || crypto.randomUUID());
        const tables = p.tables as TableChoice[],
          targets = p.targets as DbRef[];
        const task: CompareTask = {
          compareId,
          status: 'RUNNING',
          progress: {
            table: '',
            phase: '准备比较（虚构预览）',
            completed: 0,
            total: tables.length * (1 + targets.length),
            rows: 0,
          },
        };
        compareTasks.set(compareId, task);
        const tick = () => {
          if (task.status !== 'RUNNING') return;
          task.progress.completed++;
          task.progress.table = tables[(task.progress.completed - 1) % tables.length]?.name || '';
          task.progress.ref =
            task.progress.completed <= tables.length
              ? (p.source as DbRef)
              : targets[Math.floor((task.progress.completed - tables.length - 1) / tables.length)];
          task.progress.phase = '比较表（虚构预览）';
          if (task.progress.completed >= task.progress.total) {
            try {
              task.plan = buildPreviewPlan(
                p.source as DbRef,
                targets,
                tables,
                String(p.workspaceId || 'default'),
              );
              task.status = 'COMPLETED';
              comparedPlans.set(task.plan.id, task.plan);
            } catch (error) {
              task.status = 'FAILED';
              task.error = error instanceof Error ? error.message : String(error);
            }
          }
          previewEvent(task);
          if (task.status === 'RUNNING') setTimeout(tick, 350);
        };
        setTimeout(tick, 350);
        setTimeout(() => compareTasks.delete(compareId), 600_000);
        result = { compareId };
        break;
      }
      case 'sync.compare.get': {
        const task = compareTasks.get(String(p.compareId));
        if (!task) throw new Error('比较任务不存在或已过期');
        result = structuredClone(task);
        break;
      }
      case 'sync.compare.cancel': {
        const task = compareTasks.get(String(p.compareId));
        if (!task) throw new Error('比较任务不存在或已过期');
        if (task.status === 'RUNNING') {
          task.status = 'CANCELLING';
          previewEvent(task);
          setTimeout(() => {
            task.status = 'CANCELLED';
            previewEvent(task);
          }, 100);
        }
        result = { compareId: task.compareId, status: task.status };
        break;
      }
      case 'entity.save': {
        const value = structuredClone(p.value) as ConnectionInfo & {
          clearPassword?: boolean;
          importCredentialId?: string;
        };
        value.id ||= crypto.randomUUID();
        if (p.kind === 'connection') {
          const validation = connectionTestError(value);
          if (validation) throw new Error(validation);
          const group = connectionGroupName(value);
          if (!state.connectionGroups.some((g) => g.name === group))
            state.connectionGroups.push({
              id: crypto.randomUUID(),
              name: group,
              sortOrder: state.connectionGroups.length,
            });
          const old = state.connections.find((connection) => connection.id === value.id);
          if (value.password) connectionFailures.set(value.id, value.password === 'preview-fail');
          if (value.clearPassword) connectionFailures.delete(value.id);
          value.hasPassword = value.clearPassword ? false : !!value.password || !!old?.hasPassword;
          delete value.password;
          delete value.certificatePassword;
          delete value.clearPassword;
          delete value.importCredentialId;
          value.group = group;
          value.sortOrder =
            old && connectionGroupName(old) === group
              ? old.sortOrder
              : Math.max(
                  -1,
                  ...state.connections
                    .filter((c) => connectionGroupName(c) === group)
                    .map((c) => c.sortOrder ?? 0),
                ) + 1;
        }
        const key = (
          {
            workspace: 'workspaces',
            connection: 'connections',
            template: 'templates',
            settings: 'settings',
          } as const
        )[p.kind as 'workspace' | 'connection' | 'template' | 'settings'];
        if (key === 'settings')
          state.settings = { ...(value as unknown as State['settings']), id: 'global' };
        else if (key) {
          const list = state[key] as { id: string }[];
          const v = value;
          const i = list.findIndex((x) => x.id === v.id);
          if (i >= 0) list[i] = structuredClone(v);
          else list.push(structuredClone(v));
        }
        result = value;
        break;
      }
      case 'connectionGroups.save': {
        const name = String(p.name || '').trim();
        if (!name) throw new Error('分组名称不能为空');
        if (state.connectionGroups.some((g) => g.name === name && g.id !== p.id))
          throw new Error('分组名称已存在');
        const old = state.connectionGroups.find((g) => g.id === p.id);
        if (p.id && !old) throw new Error('分组不存在');
        if (old) {
          state.connections.forEach((connection) => {
            if (connectionGroupName(connection) === old.name) connection.group = name;
          });
          old.name = name;
          result = old;
        } else {
          const group = { id: crypto.randomUUID(), name, sortOrder: state.connectionGroups.length };
          state.connectionGroups.push(group);
          result = group;
        }
        break;
      }
      case 'connectionGroups.delete': {
        if (!String(p.groupId || '').trim()) throw new Error('请选择要删除的分组');
        const group = state.connectionGroups.find((value) => value.id === p.groupId);
        if (!group) throw new Error('分组不存在');
        if (state.connections.some((connection) => connectionGroupName(connection) === group.name))
          throw new Error('该分组仍有连接，请先将连接移到其他分组');
        state.connectionGroups = state.connectionGroups
          .filter((value) => value.id !== group.id)
          .sort((first, second) => first.sortOrder - second.sortOrder)
          .map((value, sortOrder) => ({ ...value, sortOrder }));
        result = { ok: true };
        break;
      }
      case 'connectionGroups.move': {
        if (!['before', 'after'].includes(String(p.placement))) throw new Error('无效投放位置');
        const group = state.connectionGroups.find((g) => g.id === p.groupId);
        const groups = [...state.connectionGroups]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .filter((g) => g.id !== p.groupId);
        let index = groups.findIndex((g) => g.id === p.anchorGroupId);
        if (!group || index < 0) throw new Error('分组或目标分组不存在');
        if (p.placement === 'after') index++;
        groups.splice(index, 0, group);
        groups.forEach((g, i) => {
          g.sortOrder = i;
        });
        state.connectionGroups = groups;
        result = { ok: true };
        break;
      }
      case 'connections.move': {
        const connection = state.connections.find((c) => c.id === p.connectionId);
        const group = state.connectionGroups.find((g) => g.id === p.groupId);
        if (!connection || !group) throw new Error('连接或分组不存在');
        if (!['before', 'after', 'last'].includes(String(p.placement)))
          throw new Error('无效投放位置');
        const destination = orderedConnections(
          state.connections.filter(
            (c) => connectionGroupName(c) === group.name && c.id !== connection.id,
          ),
        );
        let index = destination.length;
        if (p.placement !== 'last') {
          index = destination.findIndex((c) => c.id === p.anchorConnectionId);
          if (index < 0) throw new Error('目标连接不存在于该分组');
          if (p.placement === 'after') index++;
        }
        const oldGroup = connectionGroupName(connection);
        connection.group = group.name;
        destination.splice(index, 0, connection);
        destination.forEach((c, i) => {
          c.sortOrder = i;
        });
        if (oldGroup !== group.name)
          orderedConnections(
            state.connections.filter((c) => connectionGroupName(c) === oldGroup),
          ).forEach((c, i) => {
            c.sortOrder = i;
          });
        result = { ok: true };
        break;
      }
      case 'entity.delete': {
        const key = (
          { workspace: 'workspaces', connection: 'connections', template: 'templates' } as const
        )[p.kind as 'workspace'];
        if (key) {
          const list = state[key] as { id: string }[];
          const i = list.findIndex((v) => v.id === p.id);
          if (i >= 0) list.splice(i, 1);
          if (p.kind === 'connection') connectionFailures.delete(String(p.id));
        }
        result = { ok: true };
        break;
      }
      case 'sync.save': {
        if (p.mode === 'EXECUTE_AND_SAVE')
          throw new Error('浏览器预览不会执行数据库操作，请使用桌面客户端');
        const plan = comparedPlans.get(String(p.planId));
        if (!plan) throw new Error('比较结果已失效，请重新比较');
        const selectedIds = [...new Set(p.selectedIds as string[])];
        if (
          !selectedIds.length ||
          selectedIds.some(
            (id) =>
              !plan.targets.some((target) =>
                target.changes.some((change) => change.id === id && !change.blocked),
              ),
          )
        )
          throw new Error('请选择有效且未被阻止的变更');
        result = {
          id: 'PREVIEW-' + crypto.randomUUID(),
          workspaceId: plan.workspaceId,
          parentId: '',
          archivePath: '',
          recoveryFormat: 'LOCAL_V1',
          plan: structuredClone(plan),
          source: plan.source,
          tables: plan.tables,
          targetCount: plan.targets.length,
          createdAt: new Date().toISOString(),
          mode: 'SAVE_ONLY',
          status: 'UNEXECUTED',
          results: [],
          selectedIds,
          remark: String(p.remark || ''),
        };
        state.records.unshift(result as State['records'][number]);
        break;
      }
      case 'schema.export': {
        const opts = p as { source: DbRef; includeDrop: boolean; tables: string[] };
        // Simulate an async database read so the browser preview shows the loading state.
        await new Promise((resolve) => setTimeout(resolve, 800));
        result = {
          sql:
            '-- 浏览器设计预览\n' +
            opts.tables
              .map(
                (t) =>
                  (opts.includeDrop ? 'DROP TABLE IF EXISTS `' + t + '`;\n' : '') +
                  previewSnapshot(opts.source, t).createSql,
              )
              .join('\n\n'),
        };
        break;
      }
      case 'record.get': {
        const record = state.records.find((r) => r.id === p.id);
        if (!record) throw new Error('同步记录不存在');
        result = {
          record,
          events: [],
          external: state.external.find((e) => e.id === p.id) || {},
          files: [
            'README.txt',
            ...(record?.plan?.targets || []).flatMap((target) =>
              (target.changes.some(
                (change) => record?.selectedIds.includes(change.id) && !change.blocked,
              )
                ? ['target.json', '02_sync.sql', '04_rollback.sql']
                : ['target.json', '00_full_diff.sql']
              ).map((name) => `${target.ref.database}/${name}`),
            ),
          ],
        };
        break;
      }
      case 'record.file': {
        const record = state.records.find((r) => r.id === p.id);
        if (!record) throw new Error('同步记录不存在');
        const file = String(p.file);
        const target = record?.plan?.targets.find((item) =>
          file.startsWith(item.ref.database + '/'),
        );
        const selected =
          target?.changes.filter((c) => record?.selectedIds.includes(c.id) && !c.blocked) || [];
        if (file.endsWith('target.json')) {
          result = JSON.stringify(target?.ref);
          break;
        }
        result = file.endsWith('02_sync.sql')
          ? '-- 浏览器设计预览：仅包含勾选项\n' + executionScript(selected)
          : file.endsWith('04_rollback.sql')
            ? '-- 浏览器设计预览：以下是虚构的回滚示例\n' +
              [...selected]
                .reverse()
                .flatMap((change) => change.rollbackSql)
                .map((sql) => (sql.endsWith(';') ? sql : sql + ';'))
                .join('\n\n')
            : '-- 浏览器设计预览\n-- 正式客户端按目标库生成同步与回滚脚本，不在目标库创建任何备份或凭据表。\n-- 本页示例不连接或执行数据库，请在桌面客户端查看真实档案。';
        break;
      }
      case 'version.save': {
        const v = {
          id: String(p.id || crypto.randomUUID()),
          workspaceId: String(p.workspaceId),
          number: String(p.number),
          description: String(p.description),
          createdAt: time,
        };
        const existing = state.versions.findIndex((version) => version.id === v.id);
        if (existing >= 0) state.versions[existing] = v;
        else state.versions.push(v);
        for (const id of p.recordIds as string[]) state.versionLinks[id] = v.id;
        result = v;
        break;
      }
      case 'rollback.preview': {
        const record = state.records.find((r) => r.id === p.id);
        if (!record) throw new Error('同步记录不存在');
        result = {
          id: 'PREVIEW-ROLLBACK',
          recordId: p.id,
          items: (record.plan?.targets || []).flatMap((target) => {
            const completed = new Set(
              record.results
                .find(
                  (result) =>
                    result.ref.connectionId === target.ref.connectionId &&
                    result.ref.database === target.ref.database,
                )
                ?.steps.filter((step) => step.status === 'DONE')
                .map((step) => step.changeId),
            );
            return [...target.changes]
              .reverse()
              .filter(
                (change) => record.selectedIds.includes(change.id) && completed.has(change.id),
              )
              .map((change) => ({
                id: change.id,
                targetKey: `${target.ref.connectionId}/${target.ref.database}`,
                table: change.table,
                label: change.label,
                eligible: !change.blocked && change.rollbackSql.length > 0,
                selected: !change.blocked && change.rollbackSql.length > 0,
                reason: change.blocked
                  ? change.reason
                  : change.rollbackSql.length
                    ? ''
                    : '缺少可信恢复资料（虚构预览）',
                sql: change.rollbackSql,
              }));
          }),
        };
        break;
      }
      default:
        throw new Error('此操作需要桌面客户端，浏览器仅用于界面预览');
    }
    return structuredClone(result) as T;
  },
  onEvent(fn) {
    listeners.add(fn);
    if (!stopThemeListener) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const updated = () => {
        if (themeMode === 'system') notifyAppearance();
      };
      media.addEventListener('change', updated);
      stopThemeListener = () => media.removeEventListener('change', updated);
    }
    return () => {
      listeners.delete(fn);
      if (!listeners.size) {
        stopThemeListener?.();
        stopThemeListener = undefined;
      }
    };
  },
  window() {},
};
