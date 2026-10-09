<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Coin,
  Folder,
  Grid,
  Plus,
  Upload,
  Clock,
  Setting,
  Document,
  Key,
  Edit,
  Delete,
  Refresh,
  Search,
  ArrowRight,
  Close,
  Minus,
  FullScreen,
  Check,
  Collection,
  Connection as ConnectionIcon,
  Download,
} from '@element-plus/icons-vue';
import { api, preview, onEvent, windowAction } from './api';
import type {
  State,
  DbRef,
  Table,
  TableChoice,
  SyncPlan,
  Change,
  SyncRecord,
  RollbackPlan,
  RollbackItem,
  ConnectionInfo,
  Workspace,
  SyncTemplate,
  Version,
} from './types';
import SqlView from './components/SqlView.vue';
import { copyModel } from './copy';
type Page =
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
interface TreeNode {
  id: string;
  label: string;
  type: string;
  ref?: DbRef;
  table?: string;
  connectionId?: string;
  leaf?: boolean;
  children?: TreeNode[];
}
interface ReviewNode {
  id: string;
  label: string;
  type: string;
  children?: ReviewNode[];
  change?: Change;
  item?: RollbackItem;
}
const state = reactive<State>({
  workspaces: [],
  connections: [],
  templates: [],
  records: [],
  versions: [],
  versionLinks: {},
  settings: {
    id: 'global',
    concurrency: 4,
    perHost: 1,
    batchSize: 500,
    archivePath: '',
    retention: 'forever',
  },
  external: [],
});
const uid = () => crypto.randomUUID();
const workspaceId = ref('default'),
  page = ref<Page>('scope'),
  busy = ref(false),
  loading = ref(true),
  engineError = ref('');
const activeWorkspace = computed(() => state.workspaces.find((w) => w.id === workspaceId.value));
const workspaceConnections = computed(() =>
  state.connections.filter((c) => c.workspaceIds.includes(workspaceId.value)),
);
const localTemplates = computed(() =>
  state.templates.filter((t) => t.workspaceId === workspaceId.value),
);
const records = computed(() => state.records.filter((r) => r.workspaceId === workspaceId.value));
const versions = computed(() => state.versions.filter((v) => v.workspaceId === workspaceId.value));
const dbCache = reactive<Record<string, string[]>>({});
const connectionTree = computed<TreeNode[]>(() =>
  [...new Set(workspaceConnections.value.map((c) => c.group || '数据库连接'))].map((group) => ({
    id: 'group:' + group,
    label: group,
    type: 'group',
    children: workspaceConnections.value
      .filter((c) => (c.group || '数据库连接') === group)
      .map((c) => ({
        id: c.id,
        label: c.name,
        type: 'connection',
        connectionId: c.id,
        leaf: false,
      })),
  })),
);
const dbOptions = computed(() =>
  workspaceConnections.value.flatMap((c) =>
    [...new Set([...c.databases, ...(dbCache[c.id] || [])])].map((database) => ({
      key: c.id + '/' + database,
      label: c.name + ' / ' + database,
      ref: { connectionId: c.id, database },
    })),
  ),
);
const refKey = (r: DbRef) => r.connectionId + '/' + r.database;
function fromKey(key: string): DbRef {
  const at = key.indexOf('/');
  return { connectionId: key.slice(0, at), database: key.slice(at + 1) };
}
const sourceKey = ref(''),
  targetKeys = ref<string[]>([]),
  scopeTables = ref<(TableChoice & { comment: string })[]>([]),
  tableSearch = ref(''),
  scopeRemark = ref('');
const filteredScopeTables = computed(() =>
  scopeTables.value.filter((t) => t.name.toLowerCase().includes(tableSearch.value.toLowerCase())),
);
const sourceLabel = computed(() =>
  sourceKey.value ? fromKey(sourceKey.value).database : '选择源库',
);
const plan = ref<SyncPlan>(),
  selectedIds = ref(new Set<string>()),
  diffTab = ref('structure'),
  currentChange = ref<Change>(),
  diffSearch = ref('');
const planChanges = computed(() => plan.value?.targets.flatMap((t) => t.changes) || []);
const selectedChanges = computed(() =>
  planChanges.value.filter((c) => selectedIds.value.has(c.id)),
);
const kindLabels: Record<string, string> = {
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
const diffNodes = computed<ReviewNode[]>(
  () =>
    plan.value?.targets
      .map((t) => ({
        id: refKey(t.ref),
        label: t.ref.database,
        type: 'database',
        children: [...new Set(t.changes.map((c) => c.table))]
          .map((table) => ({
            id: refKey(t.ref) + '/' + table,
            label: table,
            type: 'table',
            children: t.changes
              .filter(
                (c) =>
                  c.table === table &&
                  (diffTab.value === 'data' ? c.kind.endsWith('_ROW') : !c.kind.endsWith('_ROW')) &&
                  (!diffSearch.value ||
                    [c.table, c.label, c.kind]
                      .join(' ')
                      .toLowerCase()
                      .includes(diffSearch.value.toLowerCase())),
              )
              .map((c) => ({ id: c.id, label: c.label, type: 'change', change: c })),
          }))
          .filter((n) => n.children.length),
      }))
      .filter((n) => n.children.length) || [],
);
function leaves(n: ReviewNode): Change[] {
  return n.change ? [n.change] : (n.children || []).flatMap(leaves);
}
watch(diffNodes, (nodes) => {
  const changes = nodes.flatMap(leaves);
  if (!changes.some((c) => c.id === currentChange.value?.id))
    currentChange.value = changes.find((c) => !c.blocked) || changes[0];
});
function isChecked(n: ReviewNode) {
  const c = leaves(n).filter((c) => !c.blocked);
  return !!c.length && c.every((c) => selectedIds.value.has(c.id));
}
function partial(n: ReviewNode) {
  const c = leaves(n).filter((c) => !c.blocked);
  return c.some((c) => selectedIds.value.has(c.id)) && !isChecked(n);
}
function toggleNode(n: ReviewNode, on: boolean) {
  const s = new Set(selectedIds.value);
  leaves(n)
    .filter((c) => !c.blocked)
    .forEach((c) => (on ? s.add(c.id) : s.delete(c.id)));
  selectedIds.value = s;
}
const changeTarget = computed(() =>
  plan.value?.targets.find((t) => refKey(t.ref) === currentChange.value?.targetKey),
);
const columnComparison = computed(() => {
  const c = currentChange.value;
  if (!c) return null;
  return {
    source: plan.value?.sourceSnapshot[c.table]?.columns.find((x) => x.name === c.label),
    target: changeTarget.value?.before[c.table]?.columns.find((x) => x.name === c.label),
  };
});
const rowFields = computed(() =>
  currentChange.value
    ? [
        ...new Set([
          ...Object.keys(currentChange.value.before),
          ...Object.keys(currentChange.value.after),
        ]),
      ].map((name) => ({
        name,
        before: currentChange.value!.before[name],
        after: currentChange.value!.after[name],
      }))
    : [],
);
const displayValue = (v: unknown) =>
  v === undefined
    ? '—'
    : v === null
      ? 'NULL'
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
const context = ref<{ x: number; y: number; node: TreeNode }>();
const tableTabs = ref<{ id: string; ref: DbRef; table: string; model: Table }[]>([]),
  activeTableTab = ref(''),
  structureTab = ref('columns');
const viewedTable = computed(() => tableTabs.value.find((t) => t.id === activeTableTab.value));
const workspaceForm = reactive<Workspace>({ id: '', name: '', description: '', connectionIds: [] });
const connectionForm = reactive<ConnectionInfo>({
  id: '',
  name: '',
  host: 'localhost',
  port: 3306,
  user: '',
  group: '数据库连接',
  databases: [],
  workspaceIds: ['default'],
  ssl: false,
  ca: '',
  clientCert: '',
  hasPassword: false,
  password: '',
  certificatePassword: '',
});
const databasesText = ref(''),
  connectionSearch = ref('');
const filteredConnections = computed(() =>
  state.connections.filter((c) =>
    [c.name, c.host, c.group]
      .join(' ')
      .toLowerCase()
      .includes(connectionSearch.value.toLowerCase()),
  ),
);
const importFileToken = ref(''),
  importWorkspaceIds = ref<string[]>(['default']);
watch(workspaceId, (id) => {
  importWorkspaceIds.value = [id];
});
const importFormat = ref('navicat'),
  importText = ref(''),
  importName = ref(''),
  importRows = ref<
    (ConnectionInfo & { credentialStatus: string; warning?: string; selected: boolean })[]
  >([]),
  duplicateMode = ref('skip'),
  importGroup = ref('导入连接');
const templateForm = reactive<SyncTemplate>({
  id: '',
  workspaceId: 'default',
  name: '',
  description: '',
  source: { connectionId: '', database: '' },
  targets: [],
  tables: [],
});
const templateSource = ref(''),
  templateTargets = ref<string[]>([]);
const historyTab = ref('records'),
  historySearch = ref(''),
  historyFilter = ref(''),
  historySelection = ref<SyncRecord[]>([]),
  versionDrawer = ref(false),
  versionMode = ref('new'),
  versionForm = reactive({ id: '', number: '', description: '', move: false });
const currentVersionId = ref(''),
  currentVersion = computed(() => versions.value.find((v) => v.id === currentVersionId.value)),
  currentVersionRecords = computed(() =>
    records.value.filter((r) => state.versionLinks[r.id] === currentVersionId.value),
  );
const filteredRecords = computed(() =>
  records.value.filter(
    (r) =>
      (r.id + ' ' + r.remark).toLowerCase().includes(historySearch.value.toLowerCase()) &&
      (!historyFilter.value || statusOf(r) === historyFilter.value),
  ),
);
const detail = ref<{
    record: SyncRecord;
    events: { time: string; event: Record<string, unknown> }[];
    external: Record<string, any>;
    verification?: { notice: string; checks: Record<string, string>[] };
    files: string[];
  }>(),
  fileSelected = ref(''),
  fileSql = ref(''),
  recordTab = ref('scripts');
const externalDrawer = ref(false),
  externalIds = ref<string[]>([]),
  externalBackup = ref(false),
  externalRemark = ref('');
const rollback = ref<RollbackPlan>(),
  rollbackIds = ref(new Set<string>()),
  rollbackRemark = ref(''),
  rollbackSql = ref('');
const rollbackNodes = computed<ReviewNode[]>(() =>
  rollback.value
    ? [...new Set(rollback.value.items.map((i) => i.targetKey))].map((target) => ({
        id: target,
        label: target.split('/').slice(1).join('/'),
        type: 'database',
        children: [
          ...new Set(
            rollback.value!.items.filter((i) => i.targetKey === target).map((i) => i.table),
          ),
        ].map((table) => ({
          id: target + '/' + table,
          label: table,
          type: 'table',
          children: rollback
            .value!.items.filter((i) => i.targetKey === target && i.table === table)
            .map((i) => ({ id: i.id, label: i.label, type: 'change', item: i })),
        })),
      }))
    : [],
);
function rollbackLeaves(n: ReviewNode): RollbackItem[] {
  return n.item ? [n.item] : (n.children || []).flatMap(rollbackLeaves);
}
function rollbackChecked(n: ReviewNode) {
  const a = rollbackLeaves(n).filter((i) => i.eligible);
  return !!a.length && a.every((i) => rollbackIds.value.has(i.id));
}
function toggleRollback(n: ReviewNode, on: boolean) {
  const ids = new Set(rollbackIds.value);
  rollbackLeaves(n)
    .filter((i) => i.eligible)
    .forEach((i) => (on ? ids.add(i.id) : ids.delete(i.id)));
  rollbackIds.value = ids;
}
const exportSource = ref(''),
  exportTables = ref<{ name: string; comment: string; selected: boolean }[]>([]),
  includeDrop = ref(false),
  exportSql = ref(''),
  exportFilename = ref('schema.sql');
const settingsForm = reactive({ ...state.settings }),
  cleanupDrawer = ref(false);
let unsubscribe = () => {},
  refreshTimer: ReturnType<typeof setTimeout> | undefined;
function statusOf(r: SyncRecord) {
  const e = state.external.find((e) => e.id === r.id);
  if (e) return e.verified ? 'EXTERNAL_VERIFIED' : 'EXTERNAL_UNVERIFIED';
  return r.status;
}
const statusLabels: Record<string, string> = {
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
const statusLabel = (s: string) => statusLabels[s] || s;
const statusType = (s: string): 'success' | 'warning' | 'danger' | 'info' | 'primary' =>
  ['SUCCESS', 'DONE', 'VERIFIED', 'EXTERNAL_VERIFIED'].includes(s)
    ? 'success'
    : ['FAILED'].includes(s)
      ? 'danger'
      : ['PARTIAL', 'UNKNOWN', 'INTERRUPTED', 'EXTERNAL_UNVERIFIED'].includes(s)
        ? 'warning'
        : s === 'RUNNING' || s === 'IN_FLIGHT'
          ? 'primary'
          : 'info';
const modeLabel = (r: SyncRecord) =>
  state.external.some((e) => e.id === r.id)
    ? '外部执行'
    : { SAVE_ONLY: '仅保存记录', EXECUTE_AND_SAVE: '工具执行', ROLLBACK: '工具回滚' }[r.mode] ||
      r.mode;
const date = (s: string) => (s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—');
const title = computed(
  () =>
    ({
      scope: '新建同步',
      diff: diffTab.value === 'data' ? '基础数据差异' : '差异预览',
      workspaces: '工作区管理',
      connections: '连接管理',
      import: '导入连接',
      table: viewedTable.value?.table || '表结构',
      templates: '同步模板',
      history: '同步历史',
      record: '同步记录详情',
      rollback: '回滚预览',
      export: '导出表结构',
      settings: '设置',
    })[page.value],
);
async function action<T>(fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = true;
  try {
    return await fn();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
    return undefined;
  } finally {
    busy.value = false;
  }
}
async function loadState() {
  try {
    const value = await api<State>('state.load');
    Object.assign(state, value);
    if (!state.workspaces.some((w) => w.id === workspaceId.value))
      workspaceId.value = state.workspaces[0]?.id || 'default';
    Object.assign(settingsForm, state.settings);
    engineError.value = '';
  } catch (e) {
    engineError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
async function loadNode(node: any, resolve: (data: TreeNode[]) => void) {
  try {
    const n = node.data as TreeNode;
    if (node.level === 0) {
      resolve(connectionTree.value);
      return;
    }
    if (n.type === 'group') {
      resolve(n.children || []);
      return;
    }
    if (n.type === 'connection') {
      const databases = await api<string[]>('databases.list', { connectionId: n.connectionId });
      dbCache[n.connectionId!] = databases;
      resolve(
        databases.map((database) => ({
          id: n.connectionId + '/' + database,
          label: database,
          type: 'database',
          ref: { connectionId: n.connectionId!, database },
          leaf: false,
        })),
      );
      return;
    }
    if (n.type === 'database') {
      const tables = await api<{ name: string; comment: string }[]>('tables.list', { ref: n.ref });
      resolve(
        tables.map((t) => ({
          id: refKey(n.ref!) + '/' + t.name,
          label: t.name,
          type: 'table',
          table: t.name,
          ref: n.ref,
          leaf: true,
        })),
      );
      return;
    }
    resolve([]);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e));
    resolve([]);
  }
}
function rightClick(e: MouseEvent, node: TreeNode) {
  if (node.type !== 'table' && node.type !== 'database') return;
  e.preventDefault();
  context.value = {
    x: Math.min(e.clientX, window.innerWidth - 240),
    y: Math.min(e.clientY, window.innerHeight - 250),
    node,
  };
}
async function openTable(node: TreeNode) {
  if (!node.ref || !node.table) return;
  context.value = undefined;
  await action(async () => {
    const id = refKey(node.ref!) + '/' + node.table;
    let tab = tableTabs.value.find((t) => t.id === id);
    if (!tab) {
      const model = await api<Table>('table.get', { ref: node.ref, table: node.table });
      tab = { id, ref: node.ref!, table: node.table!, model };
      tableTabs.value.push(tab);
    }
    activeTableTab.value = id;
    page.value = 'table';
  });
}
async function refreshTable() {
  if (viewedTable.value)
    await action(async () => {
      viewedTable.value!.model = await api<Table>('table.get', {
        ref: viewedTable.value!.ref,
        table: viewedTable.value!.table,
      });
    });
}
function closeTable(id: string) {
  tableTabs.value = tableTabs.value.filter((t) => t.id !== id);
  if (activeTableTab.value === id) {
    activeTableTab.value = tableTabs.value[0]?.id || '';
    if (!activeTableTab.value) page.value = plan.value ? 'diff' : 'scope';
  }
}
async function beginSync(node?: TreeNode, mode: 'structure' | 'data' = 'structure') {
  context.value = undefined;
  page.value = 'scope';
  if (node?.ref) {
    sourceKey.value = refKey(node.ref);
    await loadScope(node.table, mode);
  } else if (!sourceKey.value && dbOptions.value.length) {
    sourceKey.value = dbOptions.value[0]!.key;
    await loadScope();
  }
}
async function loadScope(preselect?: string, mode: 'structure' | 'data' = 'structure') {
  if (!sourceKey.value) return;
  await action(async () => {
    const rows = await api<{ name: string; comment: string }[]>('tables.list', {
      ref: fromKey(sourceKey.value),
    });
    scopeTables.value = rows.map((t) => ({
      ...t,
      structure: !!preselect && t.name === preselect && mode === 'structure',
      data: !!preselect && t.name === preselect && mode === 'data',
      keyColumns: [],
      keyText: '',
    }));
    targetKeys.value = targetKeys.value.filter((k) => k !== sourceKey.value);
  });
}
function setScopeAll(on: boolean, type: 'structure' | 'data') {
  filteredScopeTables.value.forEach((t) => (t[type] = on));
}
async function compare() {
  await action(async () => {
    plan.value = await api<SyncPlan>('sync.compare', {
      workspaceId: workspaceId.value,
      source: fromKey(sourceKey.value),
      targets: targetKeys.value.map(fromKey),
      tables: scopeTables.value
        .filter((t) => t.structure || t.data)
        .map((t) => ({
          name: t.name,
          structure: t.structure,
          data: t.data,
          keyColumns: (t.keyText || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        })),
    });
    selectedIds.value = new Set(
      planChanges.value.filter((c) => c.selected && !c.blocked).map((c) => c.id),
    );
    currentChange.value = planChanges.value.find((c) => !c.blocked);
    diffTab.value = scopeTables.value.some((t) => t.structure) ? 'structure' : 'data';
    page.value = 'diff';
  });
}
async function saveSync(mode: string) {
  await action(async () => {
    if (!plan.value) return;
    const r = await api<SyncRecord>('sync.save', {
      planId: plan.value.id,
      selectedIds: [...selectedIds.value],
      mode,
      remark: scopeRemark.value,
    });
    await loadState();
    await openRecord(r.id);
    ElMessage.success(
      mode === 'SAVE_ONLY' ? '同步记录和脚本已保存，目标库未变更' : '任务已创建，正在准备恢复资料',
    );
  });
}
function editWorkspace(w?: Workspace) {
  Object.assign(
    workspaceForm,
    w
      ? {
          ...copyModel(w),
          connectionIds: state.connections
            .filter((c) => c.workspaceIds.includes(w.id))
            .map((c) => c.id),
        }
      : { id: crypto.randomUUID(), name: '', description: '', connectionIds: [] },
  );
  page.value = 'workspaces';
}
async function saveWorkspace() {
  await action(async () => {
    await api('entity.save', { kind: 'workspace', value: { ...workspaceForm } });
    for (const c of state.connections) {
      const workspaceIds = c.workspaceIds.filter((id) => id !== workspaceForm.id);
      if (workspaceForm.connectionIds?.includes(c.id)) workspaceIds.push(workspaceForm.id);
      await api('entity.save', { kind: 'connection', value: { ...c, workspaceIds } });
    }
    await loadState();
    ElMessage.success('工作区已保存');
  });
}
function editConnection(c?: ConnectionInfo) {
  Object.assign(
    connectionForm,
    c
      ? { ...copyModel(c), password: '', certificatePassword: '' }
      : {
          id: crypto.randomUUID(),
          name: '',
          host: 'localhost',
          port: 3306,
          user: '',
          group: '数据库连接',
          databases: [],
          workspaceIds: [workspaceId.value],
          ssl: false,
          ca: '',
          clientCert: '',
          hasPassword: false,
          password: '',
          certificatePassword: '',
        },
  );
  databasesText.value = connectionForm.databases.join(', ');
  page.value = 'connections';
}
async function saveConnection() {
  await action(async () => {
    connectionForm.databases = databasesText.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await api('entity.save', { kind: 'connection', value: { ...connectionForm } });
    connectionForm.password = '';
    connectionForm.certificatePassword = '';
    await loadState();
    ElMessage.success('连接已保存');
  });
}
async function testConnection() {
  await action(async () => {
    const c = {
      ...connectionForm,
      databases: databasesText.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const r = await api<{ serverVersion: string }>('connections.test', { id: c.id, config: c });
    ElMessage.success('连接成功 · ' + r.serverVersion);
  });
}
async function chooseCertificate(field: 'ca' | 'clientCert') {
  const p = await action(() => api<string | null>('files.chooseCertificate'));
  if (p) connectionForm[field] = p;
}
async function removeEntity(kind: string, id: string) {
  try {
    await ElMessageBox.confirm('确认删除这项配置？已有同步记录会保留。', '删除配置', {
      type: 'warning',
    });
  } catch {
    return;
  }
  await action(async () => {
    await api('entity.delete', { kind, id });
    await loadState();
  });
}
async function readImport() {
  await action(async () => {
    const f = await api<{ name: string; content: string; token?: string } | null>('files.read', {
      intent: 'sessions',
    });
    if (f) {
      importName.value = f.name;
      importText.value = f.content;
      importFileToken.value = f.token || '';
      await parseImport();
    }
  });
}
async function parseImport() {
  const parsed = await api<(ConnectionInfo & { credentialStatus: string; warning?: string })[]>(
    'imports.parse',
    { format: importFormat.value, content: importText.value, fileToken: importFileToken.value },
  );
  importRows.value = parsed.map((c) => ({
    ...c,
    selected: !c.warning,
    workspaceIds: [workspaceId.value],
    password: c.password || '',
  }));
}
async function submitImport() {
  await action(async () => {
    for (const row of importRows.value.filter((r) => r.selected)) {
      const existing = state.connections.find(
        (c) => c.host === row.host && c.port === row.port && c.user === row.user,
      );
      if (existing && duplicateMode.value === 'skip') continue;
      await api('entity.save', {
        kind: 'connection',
        value: {
          ...row,
          id: existing && duplicateMode.value === 'update' ? existing.id : row.id,
          group: importGroup.value,
          importCredentialId: row.id,
          workspaceIds: [
            ...new Set([
              ...(existing && duplicateMode.value === 'update' ? existing.workspaceIds : []),
              ...importWorkspaceIds.value,
            ]),
          ],
        },
      });
    }
    importRows.value = [];
    importText.value = '';
    importFileToken.value = '';
    await loadState();
    page.value = 'connections';
    ElMessage.success('所选连接已导入');
  });
}
function editTemplate(t?: SyncTemplate) {
  Object.assign(
    templateForm,
    t
      ? copyModel(t)
      : {
          id: crypto.randomUUID(),
          workspaceId: workspaceId.value,
          name: '',
          description: '',
          source: sourceKey.value ? fromKey(sourceKey.value) : { connectionId: '', database: '' },
          targets: targetKeys.value.map(fromKey),
          tables: scopeTables.value
            .filter((t) => t.structure || t.data)
            .map((t) => ({
              ...t,
              keyColumns: (t.keyText || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })),
        },
  );
  templateSource.value = templateForm.source.connectionId ? refKey(templateForm.source) : '';
  templateTargets.value = templateForm.targets.map(refKey);
  templateForm.tables = templateForm.tables.map((t) => ({
    ...t,
    keyText: t.keyColumns.join(', '),
  }));
  page.value = 'templates';
}
async function templateSourceChanged() {
  sourceKey.value = templateSource.value;
  await loadScope();
  templateForm.tables = scopeTables.value;
}
async function saveTemplate() {
  await action(async () => {
    const t = {
      ...templateForm,
      source: fromKey(templateSource.value),
      targets: templateTargets.value.map(fromKey),
      tables: templateForm.tables
        .filter((t) => t.structure || t.data)
        .map((t) => ({
          ...t,
          keyColumns: (t.keyText || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        })),
    };
    await api('entity.save', { kind: 'template', value: t });
    await loadState();
    ElMessage.success('模板已保存');
  });
}
async function applyTemplate(t: SyncTemplate) {
  sourceKey.value = refKey(t.source);
  targetKeys.value = t.targets.map(refKey);
  await loadScope();
  for (const item of scopeTables.value) {
    const saved = t.tables.find((c) => c.name === item.name);
    if (saved) Object.assign(item, saved, { keyText: saved.keyColumns.join(', ') });
  }
  page.value = 'scope';
}
function openVersionDrawer() {
  versionForm.id = '';
  versionForm.number = '';
  versionForm.description = '';
  versionForm.move = false;
  versionMode.value = 'new';
  versionDrawer.value = true;
}
async function markVersion() {
  await action(async () => {
    let version = versionForm;
    if (versionMode.value === 'append') {
      const v = versions.value.find((v) => v.id === versionForm.id);
      if (!v) throw new Error('请选择已有版本');
      version = { ...versionForm, ...v };
    }
    await api('version.save', {
      workspaceId: workspaceId.value,
      id: version.id,
      number: version.number,
      description: version.description,
      move: versionForm.move,
      recordIds: historySelection.value.map((r) => r.id),
    });
    versionDrawer.value = false;
    await loadState();
    ElMessage.success('版本归档已更新');
  });
}
async function editVersion() {
  if (!currentVersion.value) return;
  try {
    const r = await ElMessageBox.prompt('修改版本说明', '编辑说明', {
      inputValue: currentVersion.value.description,
    });
    await action(async () => {
      await api('version.save', { ...currentVersion.value, recordIds: [], description: r.value });
      await loadState();
    });
  } catch {}
}
async function openRecord(id: string) {
  detail.value = await api('record.get', { id });
  fileSelected.value =
    detail.value?.files.find((f) => f.endsWith('02_sync.sql')) || detail.value?.files[0] || '';
  fileSql.value = '';
  if (fileSelected.value) await selectFile(fileSelected.value);
  recordTab.value =
    detail.value?.record.mode === 'EXECUTE_AND_SAVE' &&
    ['RUNNING', 'QUEUED'].includes(detail.value.record.status)
      ? 'results'
      : 'scripts';
  page.value = 'record';
}
async function selectFile(file: string) {
  fileSelected.value = file;
  if (detail.value)
    fileSql.value = await api<string>('record.file', { id: detail.value.record.id, file });
}
async function exportRecords(ids: string[], name?: string) {
  await action(async () => {
    const path = await api<string | null>('record.export', { ids, name });
    if (path) ElMessage.success('脚本包已导出');
  });
}
async function auditRecord() {
  if (detail.value)
    await action(async () => {
      await api('record.verify', { id: detail.value!.record.id });
      await openRecord(detail.value!.record.id);
      recordTab.value = 'results';
      ElMessage.success('当前状态核验已记录，原执行状态保留');
    });
}
async function cancelTask() {
  if (detail.value) await action(() => api('record.cancel', { id: detail.value!.record.id }));
}
function declareExternal() {
  if (!detail.value) return;
  externalIds.value = [...detail.value.record.selectedIds];
  externalBackup.value = false;
  externalRemark.value = '';
  externalDrawer.value = true;
}
async function saveExternal() {
  if (detail.value)
    await action(async () => {
      await api('external.declare', {
        id: detail.value!.record.id,
        confirmedIds: externalIds.value,
        backupCompleted: externalBackup.value,
        remark: externalRemark.value,
      });
      externalDrawer.value = false;
      await loadState();
      await openRecord(detail.value!.record.id);
      ElMessage.success('外部执行已登记，待核验');
    });
}
async function verifyExternal() {
  if (detail.value)
    await action(async () => {
      const result = await api<{ verified: boolean }>('external.verify', {
        id: detail.value!.record.id,
      });
      await loadState();
      await openRecord(detail.value!.record.id);
      result.verified
        ? ElMessage.success('执行状态与恢复资料已核验')
        : ElMessage.warning('未通过完整核验，请查看校验结果');
    });
}
async function beginRollback(id: string) {
  await action(async () => {
    rollback.value = await api<RollbackPlan>('rollback.preview', { id });
    rollbackIds.value = new Set(rollback.value.items.filter((i) => i.eligible).map((i) => i.id));
    rollbackSql.value = rollback.value.items.find((i) => i.eligible)?.sql.join(';\n') || '';
    rollbackRemark.value = '';
    page.value = 'rollback';
  });
}
async function executeRollback() {
  if (!rollback.value) return;
  await action(async () => {
    const r = await api<SyncRecord>('rollback.execute', {
      id: rollback.value!.recordId,
      selectedIds: [...rollbackIds.value],
      remark: rollbackRemark.value,
    });
    await loadState();
    await openRecord(r.id);
  });
}
async function beginExport(node?: TreeNode) {
  context.value = undefined;
  includeDrop.value = false;
  exportSql.value = '';
  page.value = 'export';
  exportSource.value = node?.ref
    ? refKey(node.ref)
    : sourceKey.value || dbOptions.value[0]?.key || '';
  await loadExport(node?.table);
}
async function loadExport(preselect?: string) {
  if (!exportSource.value) return;
  await action(async () => {
    const list = await api<{ name: string; comment: string }[]>('tables.list', {
      ref: fromKey(exportSource.value),
    });
    exportTables.value = list.map((t) => ({ ...t, selected: !!preselect && t.name === preselect }));
    exportFilename.value = fromKey(exportSource.value).database + '_schema.sql';
    exportSql.value = '';
    if (preselect) await updateExport();
  });
}
async function updateExport() {
  const tables = exportTables.value.filter((t) => t.selected).map((t) => t.name);
  if (!tables.length) {
    exportSql.value = '';
    return;
  }
  await action(async () => {
    const result = await api<{ sql: string }>('schema.export', {
      source: fromKey(exportSource.value),
      tables,
      includeDrop: includeDrop.value,
    });
    exportSql.value = result.sql;
  });
}
async function saveSql() {
  if (exportSql.value)
    await action(async () => {
      const result = await api('files.save', {
        name: exportFilename.value,
        content: exportSql.value,
      });
      if (result) ElMessage.success('结构 SQL 已导出');
    });
}
async function saveSettings() {
  await action(async () => {
    await api('entity.save', { kind: 'settings', value: { ...settingsForm } });
    await loadState();
    ElMessage.success('设置已保存');
  });
}
async function selectDirectory() {
  const folder = await action(() => api<string | null>('files.chooseDirectory'));
  if (folder) settingsForm.archivePath = folder;
}
async function backupLocal() {
  await action(async () => {
    const p = await api('backup.export');
    if (p) ElMessage.success('本地配置、记录和脚本已备份');
  });
}
async function restoreLocal() {
  try {
    await ElMessageBox.confirm(
      '导入备份会替换当前配置与记录。系统会先备份当前资料；连接密码需在本机重新核对。',
      '恢复本地备份',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  await action(async () => {
    const result = await api('backup.import');
    if (result) {
      await loadState();
      ElMessage.success('本地备份已恢复');
    }
  });
}
async function clearArchive(id: string) {
  try {
    await ElMessageBox.confirm(
      '永久删除此记录的本地脚本与恢复档案，之后工具内无法回滚。历史条目仍保留。',
      '清理档案',
      { type: 'warning', confirmButtonText: '永久清理' },
    );
  } catch {
    return;
  }
  await action(async () => {
    await api('archives.clear', { id, confirm: true });
    await loadState();
    ElMessage.success('档案已清理');
  });
}
async function exportConfig() {
  await action(async () => {
    const config = await api('config.export');
    await api('files.save', {
      name: 'datasync-config.json',
      content: JSON.stringify(config, null, 2),
    });
  });
}
async function importConfig() {
  await action(async () => {
    const f = await api<{ content: string } | null>('files.read');
    if (f) {
      await api('config.import', { content: f.content });
      await loadState();
      ElMessage.success('项目配置已导入');
    }
  });
}
async function closeWindow() {
  if (state.records.some((r) => ['RUNNING', 'QUEUED'].includes(r.status))) {
    try {
      await ElMessageBox.confirm(
        '有同步任务正在执行。关闭客户端会中断任务，重启后需要核验实际状态。',
        '关闭客户端',
        { type: 'warning', confirmButtonText: '关闭' },
      );
    } catch {
      return;
    }
  }
  windowAction('close');
}
function switchWorkspace() {
  plan.value = undefined;
  sourceKey.value = '';
  targetKeys.value = [];
  scopeTables.value = [];
  page.value = 'scope';
}
onMounted(async () => {
  document.addEventListener('click', hideContext);
  await loadState();
  if (preview) {
    sourceKey.value = 'test/shop_test';
    targetKeys.value = dbOptions.value
      .filter((o) => o.ref.connectionId !== 'test')
      .map((o) => o.key);
    await loadScope();
    scopeTables.value.forEach((t) => {
      if (['sys_dict', 'sys_menu', 'sys_user'].includes(t.name)) {
        t.structure = true;
        t.data = t.name !== 'sys_user';
        t.keyText = 'code';
      }
    });
    await compare();
  }
  unsubscribe = onEvent((event) => {
    if (event.event === 'engine-error') engineError.value = String(event.message);
    if (event.event === 'job') {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        await loadState();
        if (page.value === 'record' && detail.value) {
          const id = detail.value.record.id;
          detail.value = await api('record.get', { id });
        }
      }, 300);
    }
  });
});
function hideContext() {
  context.value = undefined;
}
onUnmounted(() => {
  unsubscribe();
  document.removeEventListener('click', hideContext);
  if (refreshTimer) clearTimeout(refreshTimer);
});
</script>
<template>
  <div class="app-shell" @click="context = undefined">
    <header class="titlebar">
      <el-icon class="brand-icon"><Coin /></el-icon><span>Data Sync</span
      ><span v-if="preview" class="preview-label">浏览器设计预览 · 执行操作请使用桌面客户端</span>
      <div class="window-actions">
        <button aria-label="最小化" @click="windowAction('minimize')">
          <el-icon><Minus /></el-icon></button
        ><button aria-label="最大化" @click="windowAction('maximize')">
          <el-icon><FullScreen /></el-icon></button
        ><button aria-label="关闭" @click="closeWindow">
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </header>
    <aside class="sidebar">
      <div class="workspace-picker">
        <div class="sidebar-label">
          <span>工作空间</span
          ><el-button
            text
            size="small"
            :icon="Setting"
            aria-label="管理工作区"
            @click="editWorkspace(activeWorkspace)"
          />
        </div>
        <el-select v-model="workspaceId" @change="switchWorkspace" aria-label="工作空间"
          ><el-option v-for="w in state.workspaces" :key="w.id" :value="w.id" :label="w.name"
        /></el-select>
      </div>
      <div class="connection-heading">
        <button @click="page = 'connections'">数据库连接</button
        ><el-button text :icon="Plus" aria-label="添加连接" @click="editConnection()" /><el-button
          text
          size="small"
          @click="page = 'import'"
          >导入连接</el-button
        >
      </div>
      <div class="tree-scroll">
        <el-tree
          :key="
            workspaceId + ':' + workspaceConnections.map((c) => c.id + c.name + c.group).join(',')
          "
          :data="connectionTree"
          :props="{ label: 'label', children: 'children', isLeaf: 'leaf' }"
          lazy
          :load="loadNode"
          node-key="id"
          highlight-current
          :expand-on-click-node="false"
          @node-contextmenu="rightClick"
          ><template #default="{ data }"
            ><span class="tree-label" @dblclick.stop="data.type === 'table' && openTable(data)"
              ><el-icon :class="{ 'blue-icon': data.type === 'connection' }"
                ><Folder v-if="data.type === 'group'" /><Grid
                  v-else-if="data.type === 'table'" /><Coin v-else /></el-icon
              ><span>{{ data.label }}</span></span
            ></template
          ></el-tree
        >
        <div v-if="!workspaceConnections.length" class="tree-empty">尚未添加数据库连接</div>
      </div>
      <nav class="sidebar-nav">
        <button :class="{ active: page === 'templates' }" @click="editTemplate(localTemplates[0])">
          <el-icon><Collection /></el-icon>同步模板</button
        ><button
          :class="{ active: ['history', 'record', 'rollback'].includes(page) }"
          @click="page = 'history'"
        >
          <el-icon><Clock /></el-icon>同步历史</button
        ><button :class="{ active: page === 'settings' }" @click="page = 'settings'">
          <el-icon><Setting /></el-icon>设置
        </button>
      </nav>
    </aside>
    <main class="main-area" v-loading="loading">
      <el-alert
        v-if="engineError"
        class="engine-alert"
        :title="engineError"
        type="error"
        show-icon
        :closable="false"
        ><el-button text @click="loadState">重试连接引擎</el-button></el-alert
      >
      <div v-if="tableTabs.length" class="document-tabs">
        <button :class="{ active: page !== 'table' }" @click="page = plan ? 'diff' : 'scope'">
          同步预览</button
        ><button
          v-for="tab in tableTabs"
          :key="tab.id"
          :class="{ active: page === 'table' && activeTableTab === tab.id }"
          @click="
            activeTableTab = tab.id;
            page = 'table';
          "
        >
          {{ tab.table }} · 结构<el-icon @click.stop="closeTable(tab.id)"><Close /></el-icon>
        </button>
      </div>
      <div class="page-content">
        <div class="breadcrumb">
          {{ activeWorkspace?.name || '工作区' }}<span>/</span
          >{{
            page === 'table'
              ? viewedTable?.ref.database
              : page === 'record'
                ? detail?.record.id
                : page === 'rollback'
                  ? rollback?.recordId
                  : title
          }}
        </div>
        <div class="page-heading">
          <div>
            <h1>{{ title }}</h1>
            <p v-if="page === 'export'">选择需要导出的表，预览后保存为 SQL 文件。</p>
            <p v-if="page === 'templates'">保存常用范围，每次使用时重新比较。</p>
            <p v-if="page === 'settings'">本地保存配置、同步记录与恢复资料。</p>
            <p v-if="page === 'table'">{{ viewedTable?.model.comment }}</p>
          </div>
          <div class="heading-actions">
            <template v-if="page === 'table'"
              ><el-button :icon="Refresh" @click="refreshTable">刷新</el-button
              ><el-button
                @click="
                  viewedTable &&
                  beginExport({
                    id: viewedTable.id,
                    label: viewedTable.table,
                    type: 'table',
                    table: viewedTable.table,
                    ref: viewedTable.ref,
                  })
                "
                >导出表结构</el-button
              ></template
            ><template v-if="page === 'record' && detail"
              ><el-tag :type="statusType(statusOf(detail.record))">{{
                statusLabel(statusOf(detail.record))
              }}</el-tag
              ><el-button v-if="detail.record.mode === 'SAVE_ONLY'" @click="declareExternal"
                >登记外部执行</el-button
              ><el-button
                :disabled="['RUNNING', 'QUEUED'].includes(detail.record.status)"
                :loading="busy"
                @click="auditRecord"
                >核验当前状态</el-button
              ><el-button type="primary" @click="exportRecords([detail.record.id])"
                >导出完整脚本包</el-button
              ></template
            ><el-button
              v-if="page === 'rollback' && rollback"
              :icon="Refresh"
              @click="beginRollback(rollback.recordId)"
              >重新校验</el-button
            >
          </div>
        </div>

        <section
          v-if="!state.connections.length && ['scope', 'diff'].includes(page)"
          class="onboarding"
        >
          <el-icon><Coin /></el-icon>
          <h2>添加你的第一个数据库连接</h2>
          <p>导入已有会话，或新建连接，再选择源库、目标库和同步表。</p>
          <el-button type="primary" :icon="Plus" @click="editConnection()">新建连接</el-button
          ><el-button :icon="Upload" @click="page = 'import'">导入会话</el-button>
        </section>

        <template v-else-if="page === 'scope'">
          <div class="scope-layout">
            <section class="panel scope-main">
              <h2>来源与目标</h2>
              <div class="source-target-form">
                <el-form label-position="top"
                  ><el-form-item label="来源数据库"
                    ><el-select
                      v-model="sourceKey"
                      filterable
                      placeholder="展开左侧连接加载数据库"
                      @change="loadScope()"
                      ><el-option
                        v-for="o in dbOptions"
                        :key="o.key"
                        :value="o.key"
                        :label="o.label" /></el-select></el-form-item></el-form
                ><el-icon class="flow-arrow"><ArrowRight /></el-icon
                ><el-form label-position="top"
                  ><el-form-item label="目标数据库（可多选）"
                    ><el-select
                      v-model="targetKeys"
                      multiple
                      filterable
                      collapse-tags
                      collapse-tags-tooltip
                      placeholder="选择目标库"
                      ><el-option
                        v-for="o in dbOptions.filter((o) => o.key !== sourceKey)"
                        :key="o.key"
                        :value="o.key"
                        :label="o.label" /></el-select></el-form-item
                ></el-form>
              </div>
              <div class="section-heading">
                <h2>选择需要比较的表</h2>
                <el-input
                  v-model="tableSearch"
                  :prefix-icon="Search"
                  placeholder="搜索表名"
                  class="short-input"
                />
              </div>
              <div class="scope-toolbar">
                <el-button text @click="setScopeAll(true, 'structure')">全选结构</el-button
                ><el-button text @click="setScopeAll(false, 'structure')">取消结构</el-button
                ><el-button text @click="setScopeAll(true, 'data')">全选数据</el-button
                ><el-button text @click="setScopeAll(false, 'data')">取消数据</el-button
                ><span>只读取已选表的结构与数据</span>
              </div>
              <el-table :data="filteredScopeTables" empty-text="选择源库后加载表名" border
                ><el-table-column prop="name" label="表名" min-width="170"
                  ><template #default="{ row }"
                    ><el-icon><Grid /></el-icon> {{ row.name }}
                    <div class="secondary">{{ row.comment }}</div></template
                  ></el-table-column
                ><el-table-column label="表结构" width="95" align="center"
                  ><template #default="{ row }"
                    ><el-checkbox
                      v-model="row.structure"
                      :aria-label="row.name + ' 表结构'" /></template></el-table-column
                ><el-table-column label="基础数据" width="100" align="center"
                  ><template #default="{ row }"
                    ><el-checkbox
                      v-model="row.data"
                      :aria-label="row.name + ' 基础数据'" /></template></el-table-column
                ><el-table-column label="匹配键" min-width="190"
                  ><template #default="{ row }"
                    ><el-input
                      v-model="row.keyText"
                      :disabled="!row.data"
                      placeholder="默认主键；复合键用逗号分隔" /></template></el-table-column
              ></el-table>
              <div class="hint">删除与高风险结构变更默认不选中，在差异预览中逐项确认。</div>
              <div class="hint">
                业务键匹配保留目标主键，不自动映射关联表
                ID。已有表的字段定义或顺序变化时，请先同步结构，再重新比较数据。
              </div>
            </section>
            <aside class="panel scope-templates">
              <h2>同步模板</h2>
              <p>复用常用连接与选表规则</p>
              <button
                v-for="t in localTemplates"
                :key="t.id"
                class="template-card"
                @click="applyTemplate(t)"
              >
                <el-icon><Document /></el-icon><strong>{{ t.name }}</strong
                ><span>{{ t.tables.length }} 张表 · {{ t.targets.length }} 个目标库</span></button
              ><el-button @click="editTemplate()">将当前范围保存为模板</el-button
              ><el-button text @click="editTemplate(localTemplates[0])">管理模板</el-button>
            </aside>
          </div>
          <div class="action-footer">
            <span
              >已选 {{ scopeTables.filter((t) => t.structure || t.data).length }} 张表 ·
              {{ targetKeys.length }} 个目标库</span
            ><el-button
              type="primary"
              size="large"
              :loading="busy"
              :disabled="
                !sourceKey || !targetKeys.length || !scopeTables.some((t) => t.structure || t.data)
              "
              @click="compare"
              >开始比较</el-button
            >
          </div>
        </template>

        <template v-else-if="page === 'diff' && plan">
          <div class="source-summary">
            <div>
              <el-icon><Coin /></el-icon
              ><span
                ><strong>{{ plan.source.database }}</strong
                ><small>{{
                  state.connections.find((c) => c.id === plan?.source.connectionId)?.name
                }}</small></span
              >
            </div>
            <el-icon class="arrow"><ArrowRight /></el-icon>
            <div>
              <el-icon class="blue-icon"><Coin /></el-icon
              ><span
                ><strong>{{ plan.targets.length }} 个目标库</strong
                ><small
                  >包括
                  {{
                    plan.targets
                      .slice(0, 3)
                      .map((t) => t.ref.database)
                      .join('、')
                  }}</small
                ></span
              >
            </div>
            <div class="summary-actions">
              <el-button @click="page = 'scope'">调整同步范围</el-button
              ><el-button @click="beginSync()">新建同步</el-button
              ><el-dropdown
                ><el-button>更多</el-button
                ><template #dropdown
                  ><el-dropdown-menu
                    ><el-dropdown-item @click="beginExport()">导出表结构</el-dropdown-item
                    ><el-dropdown-item @click="editTemplate()"
                      >保存同步模板</el-dropdown-item
                    ></el-dropdown-menu
                  ></template
                ></el-dropdown
              >
            </div>
          </div>
          <div class="table-chips">
            仅比较已选的 {{ plan.tables.length }} 张表：<el-tag
              v-for="t in plan.tables"
              :key="t.name"
              >{{ t.name }}</el-tag
            >
          </div>
          <div v-if="plan.targets.some((t) => t.error)" class="target-errors">
            <el-alert
              v-for="t in plan.targets.filter((t) => t.error)"
              :key="refKey(t.ref)"
              :title="t.ref.database + '：' + t.error"
              type="error"
              :closable="false"
            />
          </div>
          <div class="diff-toolbar">
            <el-tabs v-model="diffTab"
              ><el-tab-pane label="表结构" name="structure" /><el-tab-pane
                label="基础数据"
                name="data" /></el-tabs
            ><el-input
              v-model="diffSearch"
              :prefix-icon="Search"
              placeholder="筛选表或变更项"
              class="short-input"
            />
          </div>
          <div class="diff-layout">
            <section class="diff-list">
              <p class="small-label">
                {{ diffTab === 'data' ? '按目标库、表和数据记录分组' : '按目标库与表分组' }}
              </p>
              <el-table
                :data="diffNodes"
                row-key="id"
                default-expand-all
                border
                :tree-props="{ children: 'children' }"
                empty-text="所选范围内没有差异"
                @row-click="
                  (row: ReviewNode) => {
                    if (row.change) currentChange = row.change;
                  }
                "
                ><el-table-column label="对象／变更项" min-width="255"
                  ><template #default="{ row }"
                    ><span class="diff-object"
                      ><el-checkbox
                        :model-value="isChecked(row)"
                        :indeterminate="partial(row)"
                        :disabled="!leaves(row).some((c) => !c.blocked)"
                        @change="(v: any) => toggleNode(row, !!v)"
                        @click.stop
                        :aria-label="'选择 ' + row.label"
                      /><el-icon
                        ><Coin v-if="row.type === 'database'" /><Grid
                          v-else-if="row.type === 'table'" /><Document
                          v-else-if="row.change?.kind.endsWith('_ROW')" /><Key
                          v-else-if="row.change?.kind.includes('INDEX')" /><Edit v-else /></el-icon
                      >{{ row.label }}</span
                    ></template
                  ></el-table-column
                ><el-table-column label="变更类型" min-width="175"
                  ><template #default="{ row }"
                    ><template v-if="row.change"
                      ><el-tag
                        :type="
                          row.change.blocked ? 'danger' : row.change.risk ? 'warning' : 'success'
                        "
                        size="small"
                        >{{ kindLabels[row.change.kind] }}</el-tag
                      ><el-tooltip v-if="row.change.blocked" :content="row.change.reason"
                        ><span class="blocked-text">无法执行</span></el-tooltip
                      ><span v-else-if="row.change.risk" class="risk-label">需确认</span></template
                    ><span v-else class="blue-text">{{ leaves(row).length }} 项差异</span></template
                  ></el-table-column
                ></el-table
              >
            </section>
            <aside class="diff-inspector">
              <template v-if="currentChange"
                ><h2>
                  {{ currentChange.targetKey.split('/').slice(1).join('/') }} /
                  {{ currentChange.table }} / {{ currentChange.label }}
                </h2>
                <dl class="metadata">
                  <dt>目标库</dt>
                  <dd>{{ changeTarget?.ref.database }}</dd>
                  <dt>表名</dt>
                  <dd>{{ currentChange.table }}</dd>
                  <dt>变更类型</dt>
                  <dd>{{ kindLabels[currentChange.kind] }}</dd>
                </dl>
                <el-alert
                  v-if="currentChange.blocked"
                  :title="currentChange.reason"
                  type="error"
                  :closable="false" />
                <template v-if="currentChange.kind.endsWith('_ROW')"
                  ><h3>字段值对比</h3>
                  <p class="hint">按唯一匹配键定位记录，保留目标库主键。</p>
                  <el-table :data="rowFields" border
                    ><el-table-column prop="name" label="字段" /><el-table-column label="同步前"
                      ><template #default="{ row }">{{
                        displayValue(row.before)
                      }}</template></el-table-column
                    ><el-table-column label="同步后"
                      ><template #default="{ row }">{{
                        displayValue(row.after)
                      }}</template></el-table-column
                    ></el-table
                  ></template
                >
                <template v-else-if="columnComparison?.source || columnComparison?.target"
                  ><h3>字段定义对比</h3>
                  <div class="definition-cards">
                    <div
                      v-for="(col, i) in [columnComparison.target, columnComparison.source]"
                      :key="i"
                      class="definition-card"
                    >
                      <h4>{{ i === 0 ? '目标库现状' : '源库定义' }}</h4>
                      <dl v-if="col">
                        <dt>字段名</dt>
                        <dd>{{ col.name }}</dd>
                        <dt>数据类型</dt>
                        <dd>{{ col.type }}</dd>
                        <dt>允许空</dt>
                        <dd>{{ col.nullable ? 'YES' : 'NO' }}</dd>
                        <dt>默认值</dt>
                        <dd>{{ col.defaultValue ?? 'NULL' }}</dd>
                        <dt>注释</dt>
                        <dd>{{ col.comment || '—' }}</dd>
                      </dl>
                      <p v-else>不存在该字段</p>
                    </div>
                  </div></template
                >
                <h3>SQL 预览</h3>
                <SqlView :sql="currentChange.sql || '-- 此项不可执行'" /></template
              ><el-empty v-else description="选择变更项查看详情" />
            </aside>
          </div>
          <div class="sync-footer">
            <div class="footer-help">同步脚本与记录自动保存；执行前准备回滚资料。</div>
            <div class="footer-controls">
              <label>本次备注</label
              ><el-input v-model="scopeRemark" placeholder="填写本次变更说明" /><span
                >已选 {{ selectedChanges.length }} 项变更</span
              ><el-button
                size="large"
                :disabled="!selectedChanges.length || busy"
                @click="saveSync('SAVE_ONLY')"
                >仅保存记录</el-button
              ><el-button
                size="large"
                type="primary"
                :loading="busy"
                :disabled="!selectedChanges.length"
                @click="saveSync('EXECUTE_AND_SAVE')"
                >执行并保存</el-button
              >
            </div>
          </div>
        </template>

        <template v-else-if="page === 'table' && viewedTable"
          ><div class="table-summary">
            <span
              >数据库 <strong>{{ viewedTable.ref.database }}</strong></span
            ><span
              >引擎 <strong>{{ viewedTable.model.engine }}</strong></span
            ><span
              >字符集 <strong>{{ viewedTable.model.charset }}</strong></span
            ><span
              >排序规则 <strong>{{ viewedTable.model.collation }}</strong></span
            >
          </div>
          <el-tabs v-model="structureTab"
            ><el-tab-pane label="字段" name="columns" /><el-tab-pane
              :label="'索引（' + viewedTable.model.indexes.length + '）'"
              name="indexes" /><el-tab-pane
              :label="'外键（' + viewedTable.model.foreignKeys.length + '）'"
              name="foreignKeys" /><el-tab-pane label="建表 SQL" name="sql" /></el-tabs
          ><el-table v-if="structureTab === 'columns'" :data="viewedTable.model.columns" border
            ><el-table-column prop="name" label="字段名" min-width="170"
              ><template #default="{ row }"
                ><el-icon
                  v-if="
                    viewedTable.model.indexes.some(
                      (i) => i.name === 'PRIMARY' && i.columns.includes(row.name),
                    )
                  "
                  class="key-icon"
                  ><Key /></el-icon
                >{{ row.name }}</template
              ></el-table-column
            ><el-table-column prop="type" label="类型" min-width="150" /><el-table-column
              label="主键"
              width="80"
              align="center"
              ><template #default="{ row }"
                ><el-icon
                  v-if="
                    viewedTable.model.indexes.some(
                      (i) => i.name === 'PRIMARY' && i.columns.includes(row.name),
                    )
                  "
                  class="blue-icon"
                  ><Check /></el-icon></template></el-table-column
            ><el-table-column label="自增" width="80" align="center"
              ><template #default="{ row }"
                ><el-icon v-if="row.extra.includes('auto_increment')" class="blue-icon"
                  ><Check /></el-icon></template></el-table-column
            ><el-table-column label="允许空" width="100" align="center"
              ><template #default="{ row }"
                ><el-icon v-if="row.nullable" class="blue-icon"
                  ><Check /></el-icon></template></el-table-column
            ><el-table-column label="默认值" min-width="120"
              ><template #default="{ row }">{{
                row.defaultValue ?? 'NULL'
              }}</template></el-table-column
            ><el-table-column prop="comment" label="注释" min-width="170" /></el-table
          ><el-table v-else-if="structureTab === 'indexes'" :data="viewedTable.model.indexes" border
            ><el-table-column prop="name" label="索引名" /><el-table-column label="类型"
              ><template #default="{ row }">{{
                row.name === 'PRIMARY' ? '主键' : row.unique ? '唯一索引' : '普通索引'
              }}</template></el-table-column
            ><el-table-column prop="type" label="方法" /><el-table-column label="包含字段"
              ><template #default="{ row }">{{ row.columns.join(', ') }}</template></el-table-column
            ><el-table-column prop="definition" label="定义" min-width="220" /></el-table
          ><el-table
            v-else-if="structureTab === 'foreignKeys'"
            :data="viewedTable.model.foreignKeys"
            border
            empty-text="此表没有外键"
            ><el-table-column prop="name" label="外键名" /><el-table-column
              prop="referencedTable"
              label="引用表" /><el-table-column
              prop="definition"
              label="完整定义"
              min-width="350" /></el-table
          ><SqlView v-else :sql="viewedTable.model.createSql" />
          <div class="two-panels" v-if="structureTab === 'columns'">
            <section class="panel">
              <h2>索引信息</h2>
              <el-table :data="viewedTable.model.indexes" border
                ><el-table-column prop="name" label="索引名" /><el-table-column label="类型"
                  ><template #default="{ row }">{{
                    row.name === 'PRIMARY' ? '主键' : row.unique ? '唯一索引' : '普通索引'
                  }}</template></el-table-column
                ><el-table-column label="包含字段"
                  ><template #default="{ row }">{{
                    row.columns.join(', ')
                  }}</template></el-table-column
                ></el-table
              >
            </section>
            <section class="panel">
              <h2>表定义摘要</h2>
              <dl class="metadata">
                <dt>表注释</dt>
                <dd>{{ viewedTable.model.comment || '—' }}</dd>
                <dt>外键数量</dt>
                <dd>{{ viewedTable.model.foreignKeys.length }}</dd>
                <dt>结构状态</dt>
                <dd>
                  {{
                    viewedTable.model.supported ? '支持同步' : viewedTable.model.issues.join('；')
                  }}
                </dd>
              </dl>
            </section>
          </div>
          <p class="hint">查看结构后可从右键菜单发起同步，已打开的任务保留在原标签页。</p></template
        >

        <template v-else-if="page === 'workspaces'"
          ><div class="management-layout">
            <section>
              <div class="section-heading">
                <h2>项目工作区</h2>
                <el-button :icon="Plus" @click="editWorkspace()">新建工作区</el-button>
              </div>
              <el-table :data="state.workspaces" border @row-click="editWorkspace"
                ><el-table-column prop="name" label="工作区" /><el-table-column
                  prop="description"
                  label="说明"
                /><el-table-column label="连接数" width="85"
                  ><template #default="{ row }">{{
                    state.connections.filter((c) => c.workspaceIds.includes(row.id)).length
                  }}</template></el-table-column
                ></el-table
              >
              <div class="button-row">
                <el-button @click="exportConfig">导出项目配置</el-button
                ><el-button @click="importConfig">导入项目配置</el-button>
              </div>
              <p class="hint">配置导出不包含连接密码和证书文件。</p>
            </section>
            <aside class="panel">
              <h2>{{ workspaceForm.id ? '编辑工作区' : '选择工作区' }}</h2>
              <el-form label-position="top"
                ><el-form-item label="工作区名称"
                  ><el-input v-model="workspaceForm.name" /></el-form-item
                ><el-form-item label="说明"
                  ><el-input
                    v-model="workspaceForm.description"
                    type="textarea"
                    :rows="3" /></el-form-item
                ><el-form-item label="关联连接"
                  ><el-checkbox-group v-model="workspaceForm.connectionIds"
                    ><el-checkbox v-for="c in state.connections" :key="c.id" :value="c.id">{{
                      c.name
                    }}</el-checkbox></el-checkbox-group
                  ></el-form-item
                ></el-form
              >
              <div class="button-row">
                <el-button type="primary" :loading="busy" @click="saveWorkspace"
                  >保存工作区</el-button
                ><el-button
                  v-if="workspaceForm.id"
                  type="danger"
                  plain
                  @click="removeEntity('workspace', workspaceForm.id)"
                  >删除</el-button
                >
              </div>
            </aside>
          </div></template
        >

        <template v-else-if="page === 'connections'"
          ><div class="management-layout">
            <section>
              <div class="section-heading">
                <el-input
                  v-model="connectionSearch"
                  :prefix-icon="Search"
                  placeholder="搜索连接名称、地址"
                /><el-button :icon="Plus" @click="editConnection()">新建连接</el-button
                ><el-button @click="page = 'import'">导入</el-button>
              </div>
              <el-table
                :data="filteredConnections"
                border
                @row-click="editConnection"
                empty-text="新建连接或导入已有会话"
                ><el-table-column prop="name" label="连接名称" /><el-table-column label="地址"
                  ><template #default="{ row }"
                    >{{ row.host }}:{{ row.port }}</template
                  ></el-table-column
                ><el-table-column prop="group" label="分组" /><el-table-column
                  label="凭据"
                  width="100"
                  ><template #default="{ row }"
                    ><el-tag :type="row.hasPassword ? 'info' : 'warning'">{{
                      row.hasPassword ? '已保存' : '待填写'
                    }}</el-tag></template
                  ></el-table-column
                ></el-table
              >
            </section>
            <aside class="panel connection-editor">
              <h2>连接配置</h2>
              <el-form label-position="top"
                ><el-form-item label="连接名称"
                  ><el-input v-model="connectionForm.name"
                /></el-form-item>
                <div class="form-pair">
                  <el-form-item label="服务器地址"
                    ><el-input v-model="connectionForm.host" /></el-form-item
                  ><el-form-item label="端口"
                    ><el-input-number
                      v-model="connectionForm.port"
                      :min="1"
                      :max="65535"
                      controls-position="right"
                  /></el-form-item>
                </div>
                <div class="form-pair">
                  <el-form-item label="用户名"
                    ><el-input v-model="connectionForm.user" autocomplete="off" /></el-form-item
                  ><el-form-item label="密码"
                    ><el-input
                      v-model="connectionForm.password"
                      type="password"
                      autocomplete="new-password"
                      :placeholder="
                        connectionForm.hasPassword ? '已保存；留空保持原密码' : '填写连接密码'
                      "
                      show-password
                  /></el-form-item>
                </div>
                <el-form-item label="数据库范围（逗号分隔，留空显示所有有权限的库）"
                  ><el-input
                    v-model="databasesText"
                    placeholder="shop_test, shop_a" /></el-form-item
                ><el-form-item label="连接分组"
                  ><el-input v-model="connectionForm.group" /></el-form-item
                ><el-form-item label="关联工作区"
                  ><el-select v-model="connectionForm.workspaceIds" multiple
                    ><el-option
                      v-for="w in state.workspaces"
                      :key="w.id"
                      :value="w.id"
                      :label="w.name" /></el-select></el-form-item
                ><el-form-item
                  ><el-checkbox v-model="connectionForm.ssl"
                    >启用 SSL，验证证书与服务器名称</el-checkbox
                  ></el-form-item
                ><template v-if="connectionForm.ssl"
                  ><el-form-item label="CA 证书（PEM，可留空使用系统信任）"
                    ><el-input v-model="connectionForm.ca"
                      ><template #append
                        ><el-button @click="chooseCertificate('ca')">选择</el-button></template
                      ></el-input
                    ></el-form-item
                  ><el-form-item label="客户端证书（PKCS#12，可选）"
                    ><el-input v-model="connectionForm.clientCert"
                      ><template #append
                        ><el-button @click="chooseCertificate('clientCert')"
                          >选择</el-button
                        ></template
                      ></el-input
                    ></el-form-item
                  ><el-form-item v-if="connectionForm.clientCert" label="证书密码"
                    ><el-input
                      v-model="connectionForm.certificatePassword"
                      type="password" /></el-form-item></template
              ></el-form>
              <div class="button-row">
                <el-button :loading="busy" @click="testConnection">测试连接</el-button
                ><el-button type="primary" :loading="busy" @click="saveConnection"
                  >保存连接</el-button
                ><el-button
                  v-if="state.connections.some((c) => c.id === connectionForm.id)"
                  type="danger"
                  plain
                  :icon="Delete"
                  @click="removeEntity('connection', connectionForm.id)"
                  aria-label="删除连接"
                />
              </div>
            </aside></div
        ></template>

        <template v-else-if="page === 'import'"
          ><div class="panel">
            <el-radio-group v-model="importFormat" @change="importRows = []"
              ><el-radio-button value="navicat">Navicat .ncx</el-radio-button
              ><el-radio-button value="dbeaver">DBeaver JSON</el-radio-button
              ><el-radio-button value="datagrip">DataGrip XML</el-radio-button></el-radio-group
            >
            <div class="button-row">
              <el-button :icon="Upload" @click="readImport">选择会话文件</el-button
              ><span>{{ importName || '也可粘贴 XML / JSON 内容' }}</span>
            </div>
            <el-input
              v-model="importText"
              @input="importFileToken = ''"
              type="textarea"
              :rows="4"
              placeholder="粘贴会话内容后解析"
            /><el-button
              class="top-gap"
              :loading="busy"
              :disabled="!importText && !importFileToken"
              @click="action(parseImport)"
              >解析会话</el-button
            ><el-table v-if="importRows.length" :data="importRows" class="top-gap" border
              ><el-table-column label="选择" width="70"
                ><template #default="{ row }"
                  ><el-checkbox
                    v-model="row.selected"
                    :disabled="!!row.warning" /></template></el-table-column
              ><el-table-column prop="name" label="连接名称" /><el-table-column label="服务器"
                ><template #default="{ row }"
                  >{{ row.host }}:{{ row.port }}</template
                ></el-table-column
              ><el-table-column prop="user" label="用户" /><el-table-column label="凭据"
                ><template #default="{ row }"
                  ><el-input
                    v-model="row.password"
                    type="password"
                    :placeholder="row.credentialStatus" /></template></el-table-column
              ><el-table-column label="说明"
                ><template #default="{ row }">{{
                  row.warning || row.credentialStatus
                }}</template></el-table-column
              ></el-table
            >
            <div class="form-pair top-gap">
              <el-form-item label="导入工作区"
                ><el-select v-model="importWorkspaceIds" multiple
                  ><el-option
                    v-for="w in state.workspaces"
                    :key="w.id"
                    :value="w.id"
                    :label="w.name" /></el-select></el-form-item
              ><el-form-item label="导入分组"><el-input v-model="importGroup" /></el-form-item
              ><el-form-item label="重复连接"
                ><el-select v-model="duplicateMode"
                  ><el-option value="skip" label="跳过" /><el-option
                    value="update"
                    label="更新已有连接" /><el-option value="copy" label="另存新连接" /></el-select
              ></el-form-item>
            </div>
            <p class="hint">不能解密的密码需要补充；SSH 隧道连接暂不导入。</p>
          </div>
          <div class="action-footer">
            <span
              >已选 {{ importRows.filter((r) => r.selected).length }} 个连接 · 工作区
              {{ activeWorkspace?.name }}</span
            ><el-button
              type="primary"
              :disabled="!importRows.some((r) => r.selected)"
              :loading="busy"
              @click="submitImport"
              >确认导入</el-button
            >
          </div></template
        >

        <template v-else-if="page === 'templates'"
          ><div class="management-layout template-management">
            <section>
              <div class="section-heading">
                <h2>已保存模板</h2>
                <el-button :icon="Plus" @click="editTemplate()">新建模板</el-button>
              </div>
              <button
                v-for="t in localTemplates"
                :key="t.id"
                class="template-card large"
                :class="{ selected: templateForm.id === t.id }"
                @click="editTemplate(t)"
              >
                <strong>{{ t.name }}</strong
                ><span>{{ t.description }}</span
                ><span
                  >{{ t.source.database }} → {{ t.targets.length }} 个目标库 /
                  {{ t.tables.length }} 张表</span
                ></button
              ><el-empty v-if="!localTemplates.length" description="尚未保存模板" />
            </section>
            <aside class="panel">
              <div class="section-heading">
                <h2>{{ templateForm.name || '新建同步模板' }}</h2>
                <el-button
                  v-if="templateForm.id"
                  @click="
                    templateForm.id = uid();
                    templateForm.name += '（副本）';
                  "
                  >复制模板</el-button
                >
              </div>
              <el-form label-position="top"
                ><el-form-item label="模板名称"
                  ><el-input v-model="templateForm.name" /></el-form-item
                ><el-form-item label="说明"
                  ><el-input v-model="templateForm.description" type="textarea" /></el-form-item
                ><el-form-item label="来源库"
                  ><el-select v-model="templateSource" @change="templateSourceChanged"
                    ><el-option
                      v-for="o in dbOptions"
                      :key="o.key"
                      :value="o.key"
                      :label="o.label" /></el-select></el-form-item
                ><el-form-item label="目标库"
                  ><el-select v-model="templateTargets" multiple
                    ><el-option
                      v-for="o in dbOptions.filter((o) => o.key !== templateSource)"
                      :key="o.key"
                      :value="o.key"
                      :label="o.label" /></el-select></el-form-item
              ></el-form>
              <h3>范围与匹配规则</h3>
              <el-table :data="templateForm.tables" border
                ><el-table-column prop="name" label="表名" /><el-table-column
                  label="结构"
                  width="70"
                  ><template #default="{ row }"
                    ><el-checkbox v-model="row.structure" /></template></el-table-column
                ><el-table-column label="数据" width="70"
                  ><template #default="{ row }"
                    ><el-checkbox v-model="row.data" /></template></el-table-column
                ><el-table-column label="匹配键"
                  ><template #default="{ row }"
                    ><el-input
                      v-model="row.keyText"
                      :disabled="!row.data"
                      placeholder="默认主键" /></template></el-table-column
              ></el-table>
              <p class="hint">模板保存连接与选择规则，不保存差异结果；使用时重新读取已选表。</p>
              <div class="button-row">
                <el-button :loading="busy" @click="saveTemplate">保存模板</el-button
                ><el-button
                  type="primary"
                  :disabled="!templateSource"
                  @click="
                    applyTemplate({
                      ...templateForm,
                      source: fromKey(templateSource),
                      targets: templateTargets.map(fromKey),
                      tables: templateForm.tables.map((t) => ({
                        ...t,
                        keyColumns: (t.keyText || '')
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })),
                    })
                  "
                  >使用模板开始比较</el-button
                ><el-button
                  v-if="localTemplates.some((t) => t.id === templateForm.id)"
                  type="danger"
                  plain
                  @click="removeEntity('template', templateForm.id)"
                  >删除</el-button
                >
              </div>
            </aside>
          </div></template
        >

        <template v-else-if="page === 'history'"
          ><el-tabs v-model="historyTab"
            ><el-tab-pane label="同步记录" name="records" /><el-tab-pane
              label="版本"
              name="versions" /></el-tabs
          ><template v-if="historyTab === 'records'"
            ><div class="section-heading">
              <el-input
                v-model="historySearch"
                :prefix-icon="Search"
                placeholder="搜索备注、记录编号"
                class="medium-input"
              /><el-select
                v-model="historyFilter"
                clearable
                placeholder="全部状态"
                class="short-input"
                ><el-option
                  v-for="s in [
                    'UNEXECUTED',
                    'RUNNING',
                    'SUCCESS',
                    'PARTIAL',
                    'FAILED',
                    'INTERRUPTED',
                    'EXTERNAL_UNVERIFIED',
                    'EXTERNAL_VERIFIED',
                  ]"
                  :key="s"
                  :value="s"
                  :label="statusLabel(s)"
              /></el-select>
            </div>
            <div v-if="historySelection.length" class="selection-bar">
              <strong>已选择 {{ historySelection.length }} 条同步记录</strong>
              <div>
                <el-button @click="exportRecords(historySelection.map((r) => r.id))"
                  >导出记录</el-button
                ><el-button type="primary" @click="openVersionDrawer">标记版本</el-button>
              </div>
            </div>
            <el-table
              :data="filteredRecords"
              border
              @selection-change="(rows: SyncRecord[]) => (historySelection = rows)"
              @row-dblclick="(row: SyncRecord) => action(() => openRecord(row.id))"
              ><el-table-column type="selection" width="55" /><el-table-column
                label="同步记录／备注"
                min-width="280"
                ><template #default="{ row }"
                  ><button class="link-button" @click="action(() => openRecord(row.id))">
                    {{ row.id }}
                  </button>
                  <div>{{ row.remark || '未填写备注' }}</div>
                  <div class="secondary">{{ date(row.createdAt) }}</div>
                  <div v-if="row.parentId" class="secondary">关联 {{ row.parentId }}</div></template
                ></el-table-column
              ><el-table-column label="执行方式" min-width="120"
                ><template #default="{ row }">{{ modeLabel(row) }}</template></el-table-column
              ><el-table-column label="状态" min-width="140"
                ><template #default="{ row }"
                  ><el-tag :type="statusType(statusOf(row))">{{
                    statusLabel(statusOf(row))
                  }}</el-tag></template
                ></el-table-column
              ><el-table-column label="所属版本" min-width="120"
                ><template #default="{ row }">{{
                  versions.find((v) => v.id === state.versionLinks[row.id])?.number || '未标记'
                }}</template></el-table-column
              ></el-table
            >
            <p class="hint">
              保存记录与执行状态分别展示。点击记录查看脚本、执行结果及回滚资料。
            </p></template
          >
          <div v-else class="version-layout">
            <section class="version-list">
              <button
                v-for="v in versions"
                :key="v.id"
                class="template-card large"
                :class="{ selected: currentVersionId === v.id }"
                @click="currentVersionId = v.id"
              >
                <strong>{{ v.number }}</strong
                ><span>{{ date(v.createdAt) }}</span
                ><span>{{ v.description }}</span
                ><span
                  >{{
                    records.filter((r) => state.versionLinks[r.id] === v.id).length
                  }}
                  条记录</span
                ></button
              ><el-empty v-if="!versions.length" description="在同步记录中勾选多条记录后标记版本" />
            </section>
            <section v-if="currentVersion" class="version-details">
              <div class="section-heading">
                <h2>{{ currentVersion.number }}</h2>
                <div>
                  <el-button @click="editVersion">编辑说明</el-button
                  ><el-button @click="historyTab = 'records'">追加记录</el-button
                  ><el-button
                    type="primary"
                    @click="
                      exportRecords(
                        currentVersionRecords.map((r) => r.id),
                        currentVersion.number + '-scripts.zip',
                      )
                    "
                    >导出版本脚本</el-button
                  >
                </div>
              </div>
              <p>{{ currentVersion.description }}</p>
              <p class="hint">版本用于归档多条同步记录，各记录执行状态独立保存。</p>
              <el-table :data="currentVersionRecords" border
                ><el-table-column label="同步记录"
                  ><template #default="{ row }"
                    ><el-button link type="primary" @click="action(() => openRecord(row.id))">{{
                      row.id
                    }}</el-button></template
                  ></el-table-column
                ><el-table-column prop="remark" label="备注" /><el-table-column label="状态"
                  ><template #default="{ row }"
                    ><el-tag :type="statusType(statusOf(row))">{{
                      statusLabel(statusOf(row))
                    }}</el-tag></template
                  ></el-table-column
                ></el-table
              >
              <h3>版本脚本包</h3>
              <p class="hint">
                按记录及目标库保留备份、同步、校验与回滚脚本，点击记录查看具体内容。
              </p>
            </section>
            <el-empty v-else-if="versions.length" description="选择版本查看详情" /></div
        ></template>

        <template v-else-if="page === 'record' && detail"
          ><div class="record-summary">
            <span>{{ modeLabel(detail.record) }}</span
            ><span>{{ date(detail.record.createdAt) }}</span
            ><span
              >{{ detail.record.plan?.source.database }} →
              {{ detail.record.plan?.targets.length }} 个目标库</span
            ><span>{{ detail.record.plan?.tables.length }} 张表</span>
            <div>
              <strong>本次备注</strong> {{ detail.record.remark || '—' }}<strong>所属版本</strong>
              {{
                versions.find((v) => v.id === state.versionLinks[detail!.record.id])?.number ||
                '未标记'
              }}
            </div>
          </div>
          <el-alert
            v-if="detail.record.mode === 'SAVE_ONLY'"
            title="已保存同步脚本；外部执行结果需登记与校验。导出后可在 Navicat 等工具中执行。"
            type="info"
            show-icon
            :closable="false"
          />
          <section v-if="detail.verification?.checks?.length" class="panel">
            <h2>当前状态核验</h2>
            <p class="hint">{{ detail.verification.notice }}</p>
            <el-table :data="detail.verification.checks"
              ><el-table-column prop="table" label="表" width="140" /><el-table-column
                prop="label"
                label="变更项" /><el-table-column
                prop="currentState"
                label="目标当前状态" /><el-table-column
                prop="recoveryStatus"
                label="恢复资料与限制"
            /></el-table>
          </section>
          <el-tabs v-model="recordTab"
            ><el-tab-pane label="脚本与恢复资料" name="scripts" /><el-tab-pane
              label="执行结果"
              name="results" /><el-tab-pane
              label="外部执行校验"
              name="external"
              v-if="detail.record.mode === 'SAVE_ONLY'"
          /></el-tabs>
          <div v-if="recordTab === 'scripts'" class="record-script-layout">
            <aside class="panel file-list">
              <h2>脚本包</h2>
              <button
                v-for="file in detail.files"
                :key="file"
                :class="{ active: fileSelected === file }"
                @click="action(() => selectFile(file))"
              >
                <el-icon><Document /></el-icon>{{ file }}</button
              ><el-empty v-if="!detail.files.length" description="档案不可用或已清理" />
            </aside>
            <section>
              <SqlView :sql="fileSql || '-- 选择文件查看内容'" />
              <div class="panel top-gap">
                <h2>导出后执行流程</h2>
                <div class="export-flow">
                  <span>1　执行备份步骤</span><el-icon><ArrowRight /></el-icon
                  ><span>2　执行同步脚本</span><el-icon><ArrowRight /></el-icon
                  ><span>3　执行校验并返回核验</span>
                </div>
                <p class="hint">
                  回滚前需确认恢复资料已完成，并检查目标库后续变更。完整差异文件仅用于审阅。
                </p>
              </div>
            </section>
          </div>
          <template v-else-if="recordTab === 'results'"
            ><el-table :data="detail.record.results" border row-key="ref.database"
              ><el-table-column type="expand"
                ><template #default="{ row }"
                  ><el-table :data="row.steps" class="nested-table"
                    ><el-table-column label="表／变更项"
                      ><template #default="{ row: step }"
                        >{{
                          detail?.record.plan?.targets
                            .flatMap((t) => t.changes)
                            .find((c) => c.id === step.changeId)?.table
                        }}
                        /
                        {{
                          detail?.record.plan?.targets
                            .flatMap((t) => t.changes)
                            .find((c) => c.id === step.changeId)?.label || step.changeId
                        }}</template
                      ></el-table-column
                    ><el-table-column label="状态"
                      ><template #default="{ row: step }"
                        ><el-tag :type="statusType(step.status)">{{
                          statusLabel(step.status)
                        }}</el-tag></template
                      ></el-table-column
                    ><el-table-column
                      prop="error"
                      label="错误信息" /></el-table></template></el-table-column
              ><el-table-column label="目标库"
                ><template #default="{ row }">{{ row.ref.database }}</template></el-table-column
              ><el-table-column label="进度" min-width="170"
                ><template #default="{ row }"
                  ><el-progress
                    :percentage="
                      row.steps.length
                        ? Math.round(
                            (row.steps.filter((s: any) => s.status === 'DONE').length /
                              row.steps.length) *
                              100,
                          )
                        : 0
                    "
                    :status="
                      row.status === 'FAILED'
                        ? 'exception'
                        : row.status === 'SUCCESS'
                          ? 'success'
                          : undefined
                    " /></template></el-table-column
              ><el-table-column label="状态"
                ><template #default="{ row }"
                  ><el-tag :type="statusType(row.status)">{{
                    statusLabel(row.status)
                  }}</el-tag></template
                ></el-table-column
              ><el-table-column prop="error" label="说明"
            /></el-table>
            <div class="section-heading top-gap">
              <h2>执行日志</h2>
              <el-button
                v-if="['RUNNING', 'QUEUED'].includes(detail.record.status)"
                @click="cancelTask"
                >停止后续任务</el-button
              >
            </div>
            <div class="log-list">
              <div v-for="(log, i) in detail.events" :key="i">
                <time>{{ date(log.time) }}</time
                ><span>{{ log.event.type }}</span
                ><span>{{ log.event.table || log.event.target || '' }}</span
                ><span>{{ log.event.message || log.event.status || '' }}</span>
              </div>
            </div></template
          >
          <section v-else class="panel">
            <div class="section-heading">
              <h2>外部执行记录</h2>
              <el-button :loading="busy" @click="verifyExternal">校验目标库与恢复资料</el-button>
            </div>
            <template v-if="detail.external.declaredAt"
              ><dl class="metadata">
                <dt>登记时间</dt>
                <dd>{{ date(detail.external.declaredAt) }}</dd>
                <dt>执行范围</dt>
                <dd>{{ detail.external.confirmedIds?.length || 0 }} 项变更</dd>
                <dt>用户说明</dt>
                <dd>{{ detail.external.remark || '—' }}</dd>
                <dt>核验状态</dt>
                <dd>{{ detail.external.verified ? '已核验' : '待核实' }}</dd>
              </dl>
              <el-table v-if="detail.external.checks" :data="detail.external.checks" border
                ><el-table-column prop="target" label="目标库" /><el-table-column
                  prop="table"
                  label="表" /><el-table-column
                  prop="message"
                  label="校验结果" /></el-table></template
            ><el-empty v-else description="尚未登记外部执行" />
          </section>
          <div class="action-footer">
            <span>原始脚本保持存档；回滚生成新的关联记录。</span
            ><el-button v-if="detail.record.mode === 'SAVE_ONLY'" @click="recordTab = 'external'"
              >查看外部校验</el-button
            ><el-button
              :disabled="
                ['UNEXECUTED', 'RUNNING', 'QUEUED'].includes(detail.record.status) &&
                !detail.external.verified
              "
              @click="beginRollback(detail.record.id)"
              >回滚预览</el-button
            >
          </div></template
        >

        <template v-else-if="page === 'rollback' && rollback"
          ><el-alert
            title="仅恢复已执行的变更；按逆序处理，回滚结果另存为关联记录。"
            type="info"
            show-icon
            :closable="false"
          />
          <div class="diff-layout top-gap">
            <section class="diff-list">
              <el-table
                :data="rollbackNodes"
                border
                row-key="id"
                default-expand-all
                @row-click="
                  (row: ReviewNode) => {
                    if (row.item) rollbackSql = row.item.sql.join(';\n');
                  }
                "
                ><el-table-column label="目标库／表／恢复项" min-width="280"
                  ><template #default="{ row }"
                    ><span class="diff-object"
                      ><el-checkbox
                        :model-value="rollbackChecked(row)"
                        :disabled="!rollbackLeaves(row).some((i) => i.eligible)"
                        @click.stop
                        @change="(v: any) => toggleRollback(row, !!v)"
                      /><el-icon
                        ><Coin v-if="row.type === 'database'" /><Grid
                          v-else-if="row.type === 'table'" /><Document v-else /></el-icon
                      >{{ row.label }}</span
                    ></template
                  ></el-table-column
                ><el-table-column label="校验" min-width="170"
                  ><template #default="{ row }"
                    ><el-tag v-if="row.item" :type="row.item.eligible ? 'success' : 'danger'">{{
                      row.item.eligible ? '校验通过' : row.item.reason
                    }}</el-tag></template
                  ></el-table-column
                ></el-table
              >
            </section>
            <aside class="diff-inspector">
              <h2>回滚 SQL 预览</h2>
              <SqlView :sql="rollbackSql" /><el-alert
                v-if="rollback.items.some((i) => !i.eligible)"
                :title="rollback.items.filter((i) => !i.eligible).length + ' 项无法恢复，已禁用。'"
                type="error"
                show-icon
                :closable="false"
                class="top-gap"
              />
              <p class="hint">执行前会再次校验后续修改与恢复资料；冲突项不会覆盖。</p>
            </aside>
          </div>
          <div class="sync-footer">
            <div class="footer-controls">
              <label>回滚备注</label
              ><el-input v-model="rollbackRemark" placeholder="填写回滚原因" /><span
                >已选 {{ rollbackIds.size }} 项恢复</span
              ><el-button @click="action(() => openRecord(rollback!.recordId))">返回记录</el-button
              ><el-button
                type="primary"
                :disabled="!rollbackIds.size"
                :loading="busy"
                @click="executeRollback"
                >执行所选回滚</el-button
              >
            </div>
          </div></template
        >

        <template v-else-if="page === 'export'"
          ><div class="export-layout">
            <section class="panel">
              <h2>导出范围</h2>
              <el-form label-position="top"
                ><el-form-item label="来源数据库"
                  ><el-select v-model="exportSource" filterable @change="loadExport()"
                    ><el-option
                      v-for="o in dbOptions"
                      :key="o.key"
                      :value="o.key"
                      :label="o.label" /></el-select></el-form-item></el-form
              ><el-table :data="exportTables" border
                ><el-table-column label="选择" width="65"
                  ><template #default="{ row }"
                    ><el-checkbox
                      v-model="row.selected"
                      @change="updateExport" /></template></el-table-column
                ><el-table-column prop="name" label="表名" /><el-table-column
                  prop="comment"
                  label="备注"
              /></el-table>
              <div class="button-row">
                <el-button
                  text
                  @click="
                    exportTables.forEach((t) => (t.selected = true));
                    updateExport();
                  "
                  >全选</el-button
                ><el-button
                  text
                  @click="
                    exportTables.forEach((t) => (t.selected = false));
                    updateExport();
                  "
                  >取消全选</el-button
                >
              </div>
              <p class="hint">已选 {{ exportTables.filter((t) => t.selected).length }} 张表</p>
            </section>
            <section>
              <div class="panel">
                <h2>导出选项</h2>
                <el-checkbox v-model="includeDrop" @change="updateExport"
                  >包含 DROP TABLE（高风险）</el-checkbox
                >
                <p :class="includeDrop ? 'danger-text' : 'hint'">
                  默认关闭；勾选后会在建表前生成 DROP TABLE IF EXISTS，执行会删除已有表及数据。
                </p>
                <el-alert
                  v-if="includeDrop"
                  title="文件含删除语句，执行前请核对目标数据库及备份。"
                  type="warning"
                  :closable="false"
                />
                <div class="form-pair top-gap">
                  <el-form-item label="文件名"><el-input v-model="exportFilename" /></el-form-item
                  ><el-form-item label="编码／范围"><span>UTF-8 · 仅表结构</span></el-form-item>
                </div>
                <p class="hint">
                  不含 DROP 时，目标已有同名表会导致 CREATE TABLE 报错，请先检查结构。
                </p>
              </div>
              <div class="section-heading top-gap">
                <h2>SQL 预览</h2>
                <span class="hint">{{ includeDrop ? '包含 DROP' : '不含 DROP' }} · 不含表数据</span>
              </div>
              <SqlView :sql="exportSql || '-- 勾选表后生成结构 SQL'" />
            </section>
          </div>
          <div class="action-footer">
            <span>仅生成文件，不执行数据库操作。</span
            ><el-button
              type="primary"
              :icon="Download"
              :disabled="!exportSql"
              :loading="busy"
              @click="saveSql"
              >导出 .sql</el-button
            >
          </div></template
        >

        <template v-else-if="page === 'settings'"
          ><section class="settings-section">
            <h2>同步执行</h2>
            <div class="settings-grid">
              <el-form-item label="最大并行目标库"
                ><el-input-number
                  v-model="settingsForm.concurrency"
                  :min="1"
                  :max="16"
                  controls-position="right" /></el-form-item
              ><el-form-item label="单服务器并行"
                ><el-input-number
                  v-model="settingsForm.perHost"
                  :min="1"
                  :max="8"
                  controls-position="right" /></el-form-item
              ><el-form-item label="数据批次大小"
                ><el-input-number
                  v-model="settingsForm.batchSize"
                  :min="1"
                  :max="5000"
                  controls-position="right"
                />
                行</el-form-item
              >
            </div>
            <p class="hint">提高并发前可先在少量目标库验证。</p>
          </section>
          <section class="settings-section">
            <h2>记录与恢复资料</h2>
            <el-form label-width="155px"
              ><el-form-item label="档案目录"
                ><el-input v-model="settingsForm.archivePath" /><el-button @click="selectDirectory"
                  >选择目录</el-button
                ><el-button text @click="action(() => api('files.openArchives'))"
                  >打开目录</el-button
                ></el-form-item
              ><el-form-item label="保留策略"
                ><el-select model-value="forever" disabled
                  ><el-option value="forever" label="永久保留" /></el-select></el-form-item
              ><el-form-item label="本地配置与记录"
                ><el-button @click="backupLocal">导出备份</el-button
                ><el-button @click="restoreLocal">导入备份</el-button></el-form-item
              ><el-form-item label="管理归档资料"
                ><el-button @click="cleanupDrawer = true">管理已归档资料</el-button
                ><span class="hint">清理后相应记录将无法回滚。</span></el-form-item
              ></el-form
            >
            <p class="hint">
              已有记录继续使用原位置，新记录保存到所选目录。连接密码由系统加密管理，不包含在配置或备份导出中。
            </p>
          </section>
          <section class="settings-section">
            <h2>外观</h2>
            <span>主题　浅色</span>
          </section>
          <section class="settings-section">
            <h2>关于</h2>
            <p>Data Sync · 桌面数据库同步工具 · 开源许可 Apache-2.0</p>
            <p class="hint">
              数据库驱动、Java 运行时及其他依赖的许可见项目 THIRD_PARTY_NOTICES.md。
            </p>
          </section>
          <div class="action-footer">
            <el-button @click="Object.assign(settingsForm, state.settings)">取消修改</el-button
            ><el-button type="primary" :loading="busy" @click="saveSettings">保存设置</el-button>
          </div></template
        >
      </div>
    </main>
    <div
      v-if="context"
      class="context-menu"
      :style="{ left: context.x + 'px', top: context.y + 'px' }"
      @click.stop
    >
      <div class="context-title">{{ context.node.label }}</div>
      <template v-if="context.node.type === 'table'"
        ><button @click="openTable(context!.node)">
          <el-icon><Grid /></el-icon>查看表结构
        </button>
        <hr /></template
      ><button @click="beginSync(context!.node, 'structure')">
        <el-icon><Coin /></el-icon>同步表结构…</button
      ><button @click="beginSync(context!.node, 'data')">
        <el-icon><Grid /></el-icon>同步表数据…
      </button>
      <hr />
      <button @click="beginExport(context!.node)">
        <el-icon><Upload /></el-icon>导出表结构…
      </button>
    </div>
    <el-drawer v-model="versionDrawer" title="标记版本" size="410px"
      ><el-radio-group v-model="versionMode"
        ><el-radio-button value="new">新建版本</el-radio-button
        ><el-radio-button value="append">追加到已有版本</el-radio-button></el-radio-group
      ><el-form label-position="top" class="top-gap"
        ><el-form-item v-if="versionMode === 'append'" label="已有版本"
          ><el-select v-model="versionForm.id"
            ><el-option
              v-for="v in versions"
              :key="v.id"
              :value="v.id"
              :label="v.number" /></el-select></el-form-item
        ><template v-else
          ><el-form-item label="版本号"
            ><el-input v-model="versionForm.number" placeholder="例如 v1.4.0" /></el-form-item
          ><el-form-item label="版本说明"
            ><el-input
              v-model="versionForm.description"
              type="textarea"
              :rows="4" /></el-form-item></template
        ><el-checkbox v-model="versionForm.move"
          >将已属于其他版本的记录移动至此版本</el-checkbox
        ></el-form
      >
      <h3>关联记录（{{ historySelection.length }} 条）</h3>
      <div v-for="r in historySelection" :key="r.id" class="drawer-record">
        <strong>{{ r.id }}</strong>
        <p>{{ r.remark }}</p>
        <el-tag :type="statusType(statusOf(r))">{{ statusLabel(statusOf(r)) }}</el-tag>
      </div>
      <p class="hint">每条记录仅归属一个版本；原始脚本与执行结果保持完整。</p>
      <template #footer
        ><el-button @click="versionDrawer = false">取消</el-button
        ><el-button type="primary" :loading="busy" @click="markVersion"
          >确认标记</el-button
        ></template
      ></el-drawer
    >
    <el-drawer v-model="externalDrawer" title="登记外部执行" size="470px"
      ><p class="hint">登记实际执行的变更；登记后仍需校验目标库与恢复资料。</p>
      <el-checkbox-group v-model="externalIds"
        ><el-checkbox
          v-for="c in detail?.record.plan?.targets
            .flatMap((t) => t.changes)
            .filter((c) => detail!.record.selectedIds.includes(c.id))"
          :key="c.id"
          :value="c.id"
          class="external-choice"
          >{{ c.targetKey.split('/').slice(1).join('/') }} / {{ c.table }} /
          {{ c.label }}</el-checkbox
        ></el-checkbox-group
      ><el-checkbox v-model="externalBackup" class="top-gap"
        >已执行备份及执行后校验快照步骤</el-checkbox
      ><el-input
        v-model="externalRemark"
        type="textarea"
        :rows="4"
        class="top-gap"
        placeholder="执行时间、工具、失败项等说明"
      /><template #footer
        ><el-button @click="externalDrawer = false">取消</el-button
        ><el-button type="primary" :loading="busy" @click="saveExternal"
          >保存登记</el-button
        ></template
      ></el-drawer
    >
    <el-drawer v-model="cleanupDrawer" title="管理归档资料" size="600px"
      ><el-alert
        title="清理会永久删除本地档案，并禁用相应记录的工具内回滚。默认不自动清理。"
        type="warning"
        :closable="false"
      /><el-table :data="state.records" class="top-gap"
        ><el-table-column prop="id" label="记录" /><el-table-column
          prop="remark"
          label="备注"
        /><el-table-column label="操作" width="80"
          ><template #default="{ row }"
            ><el-button type="danger" link @click="clearArchive(row.id)">清理</el-button></template
          ></el-table-column
        ></el-table
      ></el-drawer
    >
  </div>
</template>
