import type {
  Change,
  CompareTask,
  ConnectionInfo,
  ConnectionGroup,
  DbRef,
  RollbackItem,
  RollbackPlan,
  State,
  StructureOptions,
  SyncPlan,
  SyncRecord,
  SyncTemplate,
  Table,
  TableChoice,
  Workspace,
} from './types';
import { defaultStructureOptions } from './structure-options';
import { organizedConnections } from './connection-organization';

export type Page =
  | 'scope'
  | 'diff'
  | 'workspaces'
  | 'connections'
  | 'import'
  | 'table'
  | 'templates'
  | 'history'
  | 'record'
  | 'rollback'
  | 'export'
  | 'settings';
export interface TreeNode {
  key: string;
  title: string;
  type: 'group' | 'connection' | 'database' | 'schema' | 'table';
  ref?: DbRef;
  table?: string;
  connectionId?: string;
  groupId?: string;
  isLeaf?: boolean;
  children?: TreeNode[];
}
export interface ReviewNode {
  id: string;
  label: string;
  type: string;
  targetKey?: string;
  children?: ReviewNode[];
  change?: Change;
  item?: RollbackItem;
}
export interface RecordDetail {
  record: SyncRecord;
  events: { time: string; event: Record<string, unknown> }[];
  external: {
    declaredAt?: string;
    confirmedIds?: string[];
    remark?: string;
    verified?: boolean;
    checks?: {
      target: string;
      table: string;
      message: string;
      valid?: boolean;
      declaredIds?: string[];
      recoveryAvailable?: boolean;
    }[];
  };
  verification?: { notice: string; checks: Record<string, string>[] };
  files: string[];
}
export type ScopeTable = TableChoice & { comment: string; missingTargets?: string[] };
export type ScopeTableFilter = 'all' | 'selected';
export function scopeTableMatches(table: ScopeTable, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return (
    table.name.toLowerCase().replaceAll('_', '').includes(query.replaceAll('_', '')) ||
    table.comment.toLowerCase().includes(query)
  );
}
export interface CompareSelection {
  workspaceId: string;
  sourceKey: string;
  targetKeys: string[];
  tables: ScopeTable[];
  structureDefaults: StructureOptions;
}
export type ConnectionTestResult = {
  status: 'testing' | 'success' | 'error';
  message: string;
};
export type ImportRow = ConnectionInfo & {
  credentialStatus: string;
  warning?: string;
  selected: boolean;
  connectionTest?: ConnectionTestResult;
};
export interface Model {
  syncDatabaseType: 'mysql' | 'postgresql';
  state: State;
  workspaceId: string;
  page: Page;
  busy: number;
  syncSubmitting?: string;
  rollbackSubmitting?: string;
  scopeView: number;
  tableView: number;
  recordView: number;
  rollbackView: number;
  loading: boolean;
  refreshing: Record<string, boolean>;
  refreshResults: Record<string, ConnectionTestResult>;
  engineError: string;
  schemaCache: Record<string, string[]>;
  dbCache: Record<string, string[]>;
  dbLoading: Record<string, boolean>;
  dbErrors: Record<string, string>;
  treeChildren: Record<string, TreeNode[]>;
  sourceKey: string;
  targetKeys: string[];
  /** 各目标库表名清单（"连接/库" → 表名），用于标注目标缺失表；加载失败的目标不出现在其中。 */
  targetTables: Record<string, string[]>;
  targetTablesLoading: Record<string, boolean>;
  targetTablesErrors: Record<string, string>;
  scopeTables: ScopeTable[];
  scopeMode: 'structure' | 'data';
  scopeDrafts: Partial<
    Record<'structure' | 'data', { tables: ScopeTable[]; search: string; filter: ScopeTableFilter }>
  >;
  templateMode: 'structure' | 'data';
  scopeTemplateId: string;
  applyingTemplateId: string;
  appliedTemplate?: { id: string; name: string };
  templateApplyError: string;
  structureDefaults: StructureOptions;
  templateStructureDefaults: StructureOptions;
  compareConfirmation?: CompareSelection;
  compareScope?: CompareSelection;
  compareTask?: CompareTask;
  compareStartedAt: number;
  compareFinishedAt: number;
  compareTransportError: string;
  tableSearch: string;
  scopeTableFilter: ScopeTableFilter;
  scopeRemark: string;
  plan?: SyncPlan;
  selectedIds: string[];
  diffTab: string;
  currentChangeId: string;
  diffSearch: string;
  currentTable?: { id: string; ref: DbRef; table: string; model: Table };
  structureTab: string;
  workspaceForm: Workspace;
  workspaceDialog: boolean;
  workspaceSubmitting: boolean;
  connectionForm: ConnectionInfo;
  connectionDialog: boolean;
  groupDialog: boolean;
  groupSubmitting: boolean;
  groupForm?: ConnectionGroup;
  groupName: string;
  moveConnectionId: string;
  moveGroupId: string;
  organizationSaving: boolean;
  connectionTest?: ConnectionTestResult;
  connectionTests: Record<string, ConnectionTestResult>;
  databasesText: string;
  connectionSearch: string;
  connectionSelection: string[];
  importFileToken: string;
  importWorkspaceIds: string[];
  importFormat: string;
  importText: string;
  importName: string;
  importRows: ImportRow[];
  duplicateMode: string;
  importGroup: string;
  templateForm: SyncTemplate;
  templateDialog: boolean;
  templateSubmitting: boolean;
  templateSource: string;
  templateTargets: string[];
  historyTab: string;
  historySearch: string;
  historyFilter: string;
  historySelection: string[];
  versionDrawer: boolean;
  versionMode: string;
  versionForm: { id: string; number: string; description: string; move: boolean };
  currentVersionId: string;
  detail?: RecordDetail;
  fileSelected: string;
  fileSql: string;
  recordScripts: Record<string, string>;
  recordScriptErrors: Record<string, string>;
  recordScriptTargets: Record<string, DbRef>;
  recordTab: string;
  externalDrawer: boolean;
  externalIds: string[];
  externalRemark: string;
  rollback?: RollbackPlan;
  rollbackIds: string[];
  rollbackRemark: string;
  rollbackSql: string;
  exportSource: string;
  exportTables: { name: string; comment: string; selected: boolean }[];
  includeDrop: boolean;
  exportSql: string;
  exportPreview?: { source: string; tables: string[]; includeDrop: boolean };
  exportGenerating: boolean;
  exportFilename: string;
  settingsForm: State['settings'];
  settingsDirty: boolean;
  cleanupDrawer: boolean;
}
export const emptyConnection = (workspaceId: string): ConnectionInfo => ({
  id: '',
  name: '',
  host: 'localhost',
  port: 3306,
  user: '',
  group: '',
  databases: [],
  workspaceIds: [workspaceId],
  ssl: false,
  ca: '',
  clientCert: '',
  hasPassword: false,
  password: '',
  certificatePassword: '',
});
export function initialModel(): Model {
  const settings = {
    id: 'global',
    concurrency: 4,
    perHost: 1,
    batchSize: 500,
    archivePath: '',
    retention: 'forever',
  };
  return {
    state: {
      workspaces: [],
      connections: [],
      connectionGroups: [],
      templates: [],
      records: [],
      versions: [],
      versionLinks: {},
      settings,
      external: [],
    },
    workspaceId: 'default',
    page: 'scope',
    busy: 0,
    scopeView: 0,
    tableView: 0,
    recordView: 0,
    rollbackView: 0,
    loading: true,
    refreshing: {},
    refreshResults: {},
    engineError: '',
    schemaCache: {},
    dbCache: {},
    dbLoading: {},
    dbErrors: {},
    treeChildren: {},
    syncDatabaseType: 'mysql',
    sourceKey: '',
    targetKeys: [],
    targetTables: {},
    targetTablesLoading: {},
    targetTablesErrors: {},
    scopeTables: [],
    scopeMode: 'structure',
    scopeDrafts: {},
    templateMode: 'structure',
    scopeTemplateId: '',
    applyingTemplateId: '',
    templateApplyError: '',
    structureDefaults: { ...defaultStructureOptions },
    templateStructureDefaults: { ...defaultStructureOptions },
    compareStartedAt: 0,
    compareFinishedAt: 0,
    compareTransportError: '',
    tableSearch: '',
    scopeTableFilter: 'all',
    scopeRemark: '',
    selectedIds: [],
    diffTab: 'structure',
    currentChangeId: '',
    diffSearch: '',
    structureTab: 'columns',
    workspaceForm: { id: '', name: '', description: '', connectionIds: [] },
    workspaceDialog: false,
    workspaceSubmitting: false,
    connectionForm: emptyConnection('default'),
    connectionDialog: false,
    groupDialog: false,
    groupSubmitting: false,
    groupName: '',
    moveConnectionId: '',
    moveGroupId: '',
    organizationSaving: false,
    connectionTests: {},
    databasesText: '',
    connectionSearch: '',
    connectionSelection: [],
    importFileToken: '',
    importWorkspaceIds: ['default'],
    importFormat: 'navicat',
    importText: '',
    importName: '',
    importRows: [],
    duplicateMode: 'skip',
    importGroup: '导入连接',
    templateForm: {
      id: '',
      workspaceId: 'default',
      name: '',
      description: '',
      source: { connectionId: '', database: '' },
      targets: [],
      tables: [],
    },
    templateSource: '',
    templateDialog: false,
    templateSubmitting: false,
    templateTargets: [],
    historyTab: 'records',
    historySearch: '',
    historyFilter: '',
    historySelection: [],
    versionDrawer: false,
    versionMode: 'new',
    versionForm: { id: '', number: '', description: '', move: false },
    currentVersionId: '',
    fileSelected: '',
    fileSql: '',
    recordScripts: {},
    recordScriptErrors: {},
    recordScriptTargets: {},
    recordTab: 'scripts',
    externalDrawer: false,
    externalIds: [],
    externalRemark: '',
    rollbackIds: [],
    rollbackRemark: '',
    rollbackSql: '',
    exportSource: '',
    exportTables: [],
    includeDrop: false,
    exportSql: '',
    exportGenerating: false,
    exportFilename: 'schema.sql',
    settingsForm: { ...settings },
    settingsDirty: false,
    cleanupDrawer: false,
  };
}
export type ModelAction = { type: 'replace'; value: Model };
export const modelReducer = (_state: Model, action: ModelAction): Model => action.value;
export const refKey = (r: DbRef) =>
  r.schema === undefined
    ? `${r.connectionId}/${r.database}`
    : `pg:${JSON.stringify([r.connectionId, r.database, r.schema])}`;
export const namespaceLabel = (ref: DbRef) =>
  ref.database + (ref.schema === undefined ? '' : ' / ' + ref.schema);
export const connectionOwnsKey = (key: string, id: string) =>
  key === id || key.startsWith(id + '/') || key.startsWith('pg:[' + JSON.stringify(id) + ',');
export function fromKey(key: string): DbRef {
  if (key.startsWith('pg:')) {
    const [connectionId, database, schema] = JSON.parse(key.slice(3)) as string[];
    return { connectionId, database, schema };
  }
  const at = key.indexOf('/');
  return { connectionId: key.slice(0, at), database: key.slice(at + 1) };
}
export const splitKeys = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
export const displayValue = (v: unknown) =>
  v && typeof v === 'object' && '$pgType' in v && 'value' in v
    ? String(v.value)
    : v === undefined
      ? '—'
      : v === null
        ? 'NULL'
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
export const date = (s: string) =>
  s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—';
export const kindLabels: Record<string, string> = {
  CREATE_TABLE: '创建表',
  ADD_COLUMN: '新增字段',
  MODIFY_COLUMN: '修改字段',
  DROP_COLUMN: '删除字段',
  ADD_INDEX: '新增索引',
  DROP_INDEX: '删除索引',
  REPLACE_INDEX: '修改索引',
  ADD_FK: '新增外键',
  DROP_FK: '删除外键',
  REPLACE_FK: '修改外键',
  TABLE_COMMENT: '表注释',
  TABLE_COLLATION: '字符集／排序规则',
  ADD_ROW: '新增',
  UPDATE_ROW: '更新',
  DELETE_ROW: '删除',
  BLOCKED: '无法同步',
};
export const statusLabels: Record<string, string> = {
  UNEXECUTED: '未执行',
  QUEUED: '等待执行',
  RUNNING: '执行中',
  SUCCESS: '成功',
  PARTIAL: '部分成功',
  FAILED: '失败',
  CANCELLED: '已停止',
  INTERRUPTED: '待核验',
  SKIPPED: '无选中变更',
  EXTERNAL_VERIFIED: '外部执行已核验',
  EXTERNAL_UNVERIFIED: '外部执行待核实',
  DONE: '已完成',
  PENDING: '未执行',
  IN_FLIGHT: '执行中',
  UNKNOWN: '待核验',
  VERIFIED: '校验通过',
};
export const statusLabel = (s: string) => statusLabels[s] || s;
export const statusColor = (s: string) =>
  ['SUCCESS', 'DONE', 'VERIFIED', 'EXTERNAL_VERIFIED'].includes(s)
    ? 'success'
    : s === 'FAILED'
      ? 'error'
      : ['PARTIAL', 'UNKNOWN', 'INTERRUPTED', 'EXTERNAL_UNVERIFIED'].includes(s)
        ? 'warning'
        : ['RUNNING', 'IN_FLIGHT'].includes(s)
          ? 'processing'
          : 'default';
export function statusOf(m: Model, r: SyncRecord) {
  const e = m.state.external.find((e) => e.id === r.id);
  return e ? (e.verified ? 'EXTERNAL_VERIFIED' : 'EXTERNAL_UNVERIFIED') : r.status;
}
export function modeLabel(m: Model, r: SyncRecord) {
  return m.state.external.some((e) => e.id === r.id)
    ? '外部执行'
    : { SAVE_ONLY: '仅保存记录', EXECUTE_AND_SAVE: '工具执行', ROLLBACK: '工具回滚' }[r.mode] ||
        r.mode;
}
export const changesOf = (m: Model) => m.plan?.targets.flatMap((t) => t.changes) || [];
export const leaves = (n: ReviewNode): Change[] =>
  n.change ? [n.change] : (n.children || []).flatMap(leaves);
export const rollbackLeaves = (n: ReviewNode): RollbackItem[] =>
  n.item ? [n.item] : (n.children || []).flatMap(rollbackLeaves);
export function selection(ids: string[] | ReadonlySet<string>, eligibleIds: string[]) {
  const selected = Array.isArray(ids) ? new Set(ids) : ids;
  const count = eligibleIds.filter((id) => selected.has(id)).length;
  return {
    checked: eligibleIds.length > 0 && count === eligibleIds.length,
    indeterminate: count > 0 && count < eligibleIds.length,
    disabled: !eligibleIds.length,
  };
}
export function toggleIds(ids: string[], eligible: string[], checked: boolean) {
  const eligibleSet = new Set(eligible);
  return checked ? [...new Set([...ids, ...eligible])] : ids.filter((id) => !eligibleSet.has(id));
}
export function reviewNodes(m: Model): ReviewNode[] {
  const search = m.diffSearch.toLowerCase();
  return (m.plan?.targets || []).flatMap((target) => {
    const targetKey = refKey(target.ref);
    const tables = new Map<string, ReviewNode>();
    for (const change of target.changes) {
      let table = tables.get(change.table);
      if (!table) {
        table = {
          id: `${targetKey}/${change.table}`,
          label: change.table,
          type: 'table',
          targetKey,
          children: [],
        };
        tables.set(change.table, table);
      }
      if (change.kind !== 'BLOCKED' && (m.diffTab === 'data') !== change.kind.endsWith('_ROW'))
        continue;
      if (
        search &&
        !`${change.table} ${change.label} ${change.kind}`.toLowerCase().includes(search)
      )
        continue;
      table.children!.push({ id: change.id, label: change.label, type: 'change', change });
    }
    const children = [...tables.values()].filter((table) => table.children!.length);
    return children.length
      ? [
          {
            id: targetKey,
            label:
              target.ref.database +
              (target.ref.schema !== undefined ? ' / ' + target.ref.schema : ''),
            type: 'database',
            targetKey,
            children,
          },
        ]
      : [];
  });
}
export function recoveryNodes(m: Model): ReviewNode[] {
  const targets = new Map<string, ReviewNode>();
  const tables = new Map<string, ReviewNode>();
  for (const item of m.rollback?.items || []) {
    let target = targets.get(item.targetKey);
    if (!target) {
      target = {
        id: item.targetKey,
        label: namespaceLabel(fromKey(item.targetKey)),
        type: 'database',
        children: [],
      };
      targets.set(item.targetKey, target);
    }
    const tableKey = `${item.targetKey}/${item.table}`;
    let table = tables.get(tableKey);
    if (!table) {
      table = { id: tableKey, label: item.table, type: 'table', children: [] };
      tables.set(tableKey, table);
      target.children!.push(table);
    }
    table.children!.push({ id: item.id, label: item.label, type: 'change', item });
  }
  return [...targets.values()];
}

export function reviewCounts(nodes: ReviewNode[], selected: ReadonlySet<string>) {
  const counts = new Map<string, { total: number; eligible: number; selected: number }>();
  function visit(node: ReviewNode) {
    const eligible = node.change ? !node.change.blocked : !!node.item?.eligible;
    const count =
      node.change || node.item
        ? {
            total: 1,
            eligible: Number(eligible),
            selected: Number(eligible && selected.has(node.id)),
          }
        : { total: 0, eligible: 0, selected: 0 };
    for (const child of node.children || []) {
      const childCount = visit(child);
      count.total += childCount.total;
      count.eligible += childCount.eligible;
      count.selected += childCount.selected;
    }
    counts.set(node.id, count);
    return count;
  }
  nodes.forEach(visit);
  return counts;
}
export function dbOptions(m: Model) {
  return organizedConnections(m.state)
    .filter((c) => c.workspaceIds.includes(m.workspaceId))
    .flatMap((c) =>
      [...new Set([...c.databases, ...(m.dbCache[c.id] || [])])].flatMap<{
        value: string;
        label: string;
        databaseType: 'mysql' | 'postgresql';
      }>((database) =>
        c.databaseType === 'postgresql'
          ? (m.schemaCache[refKey({ connectionId: c.id, database })] || []).map((schema) => ({
              value: refKey({ connectionId: c.id, database, schema }),
              label: `${c.name} · PostgreSQL / ${database} / ${schema}`,
              databaseType: 'postgresql' as const,
            }))
          : [
              {
                value: refKey({ connectionId: c.id, database }),
                label: `${c.name} · MySQL / ${database}`,
                databaseType: 'mysql' as const,
              },
            ],
      ),
    );
}
export const pageTitles: Record<Page, string> = {
  scope: '新建同步',
  diff: '差异预览',
  workspaces: '工作区管理',
  connections: '连接管理',
  import: '导入连接',
  table: '表结构',
  templates: '同步模板',
  history: '同步历史',
  record: '同步记录详情',
  rollback: '回滚预览',
  export: '导出表结构',
  settings: '设置',
};

export function targetRefreshKey(m: Model, entry = 'main') {
  return `targetTables:${m.scopeMode}:${m.scopeView}:${entry}:${JSON.stringify([m.sourceKey, m.targetKeys])}`;
}
export function recordRefreshKey(m: Model) {
  return `recordScripts:${m.recordView}:${m.detail?.record.id}:${m.recordTab}`;
}
export function rollbackRefreshKey(m: Model) {
  return `rollback:${m.rollbackView}:${m.rollback?.recordId}`;
}
export function tableRefreshKey(m: Model) {
  return `table:${m.tableView}:${m.currentTable?.id}`;
}
