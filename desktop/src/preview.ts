import type { Appearance, DesktopBridge, State, Table, SyncPlan, ThemeMode } from './types';
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
    sys_menu: { ...previewTable, name: 'sys_menu', comment: '菜单表' },
    sys_user: { ...previewTable, name: 'sys_user', comment: '用户表' },
  },
  targets: connections.slice(1).map((c, i) => ({
    ref: { connectionId: c.id, database: c.databases[0]! },
    label: c.databases[0]!,
    error: '',
    serverVersion: '8.0.40',
    before: {
      sys_dict: {
        ...previewTable,
        columns: previewTable.columns.filter((c) => c.name !== 'remark'),
      },
      sys_menu: { ...previewTable, name: 'sys_menu' },
      sys_user: { ...previewTable, name: 'sys_user' },
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
            change(
              'd2',
              'sys_dict',
              'ADD_ROW',
              'code = PAYMENT_TYPE',
              "INSERT INTO `shop_a`.`sys_dict` (`code`,`dict_name`) VALUES ('PAYMENT_TYPE','支付方式');",
            ),
            change(
              'd3',
              'sys_dict',
              'DELETE_ROW',
              'code = LEGACY_FLAG',
              "DELETE FROM `shop_a`.`sys_dict` WHERE `code`='LEGACY_FLAG';",
              true,
            ),
          ]
        : [
            change(
              'x' + i,
              'sys_user',
              'TABLE_COMMENT',
              '表注释',
              'ALTER TABLE `shop_' + String.fromCharCode(97 + i) + "`.`sys_user` COMMENT='用户表';",
            ),
          ].map((x) => ({ ...x, targetKey: c.id + '/' + c.databases[0] })),
  })),
};
const state: State = {
  workspaces: [
    { id: 'default', name: '跨境电商项目', description: '管理字典、菜单和各站点数据库' },
  ],
  connections,
  templates: [
    {
      id: 'tpl1',
      workspaceId: 'default',
      name: '基础字典与菜单',
      description: '同步系统字典、菜单与用户表结构',
      source: previewPlan.source,
      targets: previewPlan.targets.map((t) => t.ref),
      tables: previewPlan.tables,
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
      case 'connections.test':
        result = { serverVersion: '8.4.8 · 虚构预览数据' };
        break;
      case 'ping':
        result = { version: '0.1.0', protocol: 1 };
        break;
      case 'state.load':
        result = structuredClone(state);
        break;
      case 'databases.list':
        result = connections.find((c) => c.id === p.connectionId)?.databases || [];
        break;
      case 'tables.list':
        result = [
          { name: 'sys_dict', comment: '系统字典' },
          { name: 'sys_menu', comment: '菜单表' },
          { name: 'sys_user', comment: '用户表' },
          { name: 'orders', comment: '订单表' },
          { name: 'order_items', comment: '订单明细表' },
        ];
        break;
      case 'table.get':
        result = { ...previewTable, name: p.table };
        break;
      case 'sync.compare':
        result = structuredClone(previewPlan);
        break;
      case 'entity.save': {
        const key = (
          {
            workspace: 'workspaces',
            connection: 'connections',
            template: 'templates',
            settings: 'settings',
          } as const
        )[p.kind as 'workspace' | 'connection' | 'template' | 'settings'];
        if (key === 'settings') state.settings = p.value as State['settings'];
        else if (key) {
          const list = state[key] as { id: string }[];
          const v = p.value as { id: string };
          const i = list.findIndex((x) => x.id === v.id);
          if (i >= 0) list[i] = structuredClone(v);
          else list.push(structuredClone(v));
        }
        result = p.value;
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
        }
        result = { ok: true };
        break;
      }
      case 'sync.save':
        if (p.mode === 'EXECUTE_AND_SAVE')
          throw new Error('浏览器预览不会执行数据库操作，请使用桌面客户端');
        result = {
          ...state.records[0],
          id: 'PREVIEW-' + Date.now(),
          selectedIds: p.selectedIds,
          remark: p.remark,
        };
        state.records.unshift(result as State['records'][number]);
        break;
      case 'schema.export': {
        const opts = p as { includeDrop: boolean; tables: string[] };
        result = {
          sql:
            '-- 浏览器设计预览\n' +
            opts.tables
              .map(
                (t) =>
                  (opts.includeDrop ? 'DROP TABLE IF EXISTS `' + t + '`;\n' : '') +
                  previewTable.createSql.replaceAll('sys_dict', t) +
                  ';',
              )
              .join('\n\n'),
        };
        break;
      }
      case 'record.get':
        result = {
          record: state.records.find((r) => r.id === p.id),
          events: [],
          external: state.external.find((e) => e.id === p.id) || {},
          files: [
            'README.txt',
            'shop_a/01_prepare_backup.sql',
            'shop_a/02_sync.sql',
            'shop_a/03_verify.sql',
            'shop_a/04_rollback.sql',
          ],
        };
        break;
      case 'record.file': {
        const record = state.records.find((r) => r.id === p.id);
        const file = String(p.file);
        const selected = previewPlan.targets[0]!.changes.filter((c) =>
          record?.selectedIds.includes(c.id),
        );
        result = file.endsWith('02_sync.sql')
          ? '-- 浏览器设计预览：仅包含勾选项\n' + selected.map((c) => c.sql).join('\n\n')
          : '-- 浏览器设计预览\n-- 正式客户端按目标库生成备份、同步、校验、回滚脚本。\n-- 本页示例不连接或执行数据库，请在桌面客户端查看真实档案。';
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
      case 'rollback.preview':
        result = {
          id: 'PREVIEW-ROLLBACK',
          recordId: p.id,
          items: [
            {
              id: 'r1',
              targetKey: 'target0/shop_a',
              table: 'sys_dict',
              label: 'ORDER_STATUS',
              reason: '',
              eligible: true,
              selected: true,
              sql: [
                "UPDATE shop_a.sys_dict SET dict_name='订单状态配置' WHERE code='ORDER_STATUS';",
              ],
            },
            {
              id: 'r2',
              targetKey: 'target1/shop_b',
              table: 'sys_dict',
              label: 'ORDER_STATUS',
              reason: '存在后续结构或数据修改',
              eligible: false,
              selected: false,
              sql: [],
            },
          ],
        };
        break;
      default:
        throw new Error('此操作需要桌面客户端，浏览器仅用于界面预览');
    }
    return result as T;
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
