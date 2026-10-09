import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { App, Input } from 'antd';
import { api, onEvent, preview, windowAction } from './api';
import { previewPlan } from './preview';
import { copyModel } from './copy';
import { connectionTestError } from './connection-validation';
import { SyncExecutionConfirmation } from './components/SyncExecutionConfirmation';
import { effectiveOptions } from './structure-options';
import { defaultScriptFile, recordScriptFiles } from './sync-scripts';
import {
  changesOf,
  dbOptions,
  emptyConnection,
  fromKey,
  initialModel,
  modelReducer,
  refKey,
  splitKeys,
  toggleIds,
  type CompareSelection,
  type ImportRow,
  type Model,
  type Page,
  type RecordDetail,
  type ScopeTable,
  type TreeNode,
} from './model';
import type {
  CompareTask,
  ConnectionInfo,
  DbRef,
  RollbackPlan,
  State,
  SyncPlan,
  SyncRecord,
  SyncTemplate,
  Table,
  TableChoice,
  Workspace,
} from './types';

function useBusinessController() {
  const databaseLoads = useRef(
    new Map<string, { signature: string; workspace: string; promise: Promise<void> }>(),
  );
  const [m, dispatch] = useReducer(modelReducer, undefined, initialModel);
  const latest = useRef(m);
  const mounted = useRef(true);
  const requests = useRef(new Map<string, number>());
  const requestSerial = useRef(0);
  const { message, modal } = App.useApp();
  const closePending = useRef(false);
  const syncSubmitPending = useRef(false);
  const compareStarting = useRef(false);
  const compareCancelPending = useRef(false);
  const comparisonActive = () =>
    !!latest.current.compareTask &&
    ['RUNNING', 'CANCELLING'].includes(latest.current.compareTask.status);
  const compareSelection = (s: Model): CompareSelection => ({
    workspaceId: s.workspaceId,
    sourceKey: s.sourceKey,
    targetKeys: s.targetKeys,
    tables: s.scopeTables,
    structureDefaults: s.structureDefaults,
  });
  const selectionSignature = (selection: CompareSelection) => JSON.stringify(selection);
  const commit = useCallback((update: (current: Model) => Model) => {
    if (!mounted.current) return;
    const current = latest.current;
    const next = update(current);
    if (current.compareTask && ['RUNNING', 'CANCELLING'].includes(current.compareTask.status)) {
      for (const key of [
        'workspaceId',
        'sourceKey',
        'targetKeys',
        'scopeTables',
        'structureDefaults',
      ] as const)
        Object.assign(next, { [key]: current[key] });
    }
    if (
      next.compareConfirmation &&
      selectionSignature(compareSelection(next)) !== selectionSignature(next.compareConfirmation)
    )
      next.compareConfirmation = undefined;
    latest.current = next;
    dispatch({ type: 'replace', value: next });
  }, []);
  const set = useCallback(
    <K extends keyof Model>(key: K, value: Model[K]) =>
      commit((s) => ({
        ...s,
        [key]: value,
        ...(key === 'databasesText' ? { connectionTest: undefined } : {}),
      })),
    [commit],
  );
  const patch = useCallback(
    <
      K extends
        | 'workspaceForm'
        | 'connectionForm'
        | 'templateForm'
        | 'versionForm'
        | 'settingsForm',
    >(
      key: K,
      value: Partial<Model[K]>,
    ) =>
      commit((s) => ({
        ...s,
        [key]: { ...s[key], ...value },
        ...(key === 'settingsForm' ? { settingsDirty: true } : {}),
        ...(key === 'connectionForm' ? { connectionTest: undefined } : {}),
      })),
    [commit],
  );
  function request(name: string) {
    const id = ++requestSerial.current;
    requests.current.set(name, id);
    const workspace = latest.current.workspaceId;
    return () =>
      mounted.current &&
      requests.current.get(name) === id &&
      latest.current.workspaceId === workspace;
  }
  async function action<T>(fn: () => Promise<T>): Promise<T | undefined> {
    commit((s) => ({ ...s, busy: s.busy + 1 }));
    try {
      return await fn();
    } catch (e) {
      if (mounted.current) void message.error(e instanceof Error ? e.message : String(e));
    } finally {
      commit((s) => ({ ...s, busy: Math.max(0, s.busy - 1) }));
    }
  }
  async function confirm(title: string, content: string, okText = '确认') {
    return await modal.confirm({ title, content, okText, cancelText: '取消' });
  }
  async function loadState(resetSettings = false) {
    const valid = request('state');
    try {
      const state = await api<State>('state.load');
      if (!valid()) return;
      commit((s) => ({
        ...s,
        state,
        dbCache: Object.fromEntries(
          Object.entries(s.dbCache).filter(
            ([id]) =>
              JSON.stringify(s.state.connections.find((c) => c.id === id)) ===
                JSON.stringify(state.connections.find((c) => c.id === id)) &&
              state.connections.some((c) => c.id === id),
          ),
        ),
        treeChildren: Object.fromEntries(
          Object.entries(s.treeChildren).filter(([key]) =>
            state.connections.some(
              (c) =>
                (key === c.id || key.startsWith(c.id + '/')) &&
                JSON.stringify(c) ===
                  JSON.stringify(s.state.connections.find((old) => old.id === c.id)),
            ),
          ),
        ),
        connectionSelection: s.connectionSelection.filter((id) =>
          state.connections.some((c) => c.id === id),
        ),
        connectionTests: Object.fromEntries(
          Object.entries(s.connectionTests).filter(
            ([id]) =>
              state.connections.some((c) => c.id === id) &&
              JSON.stringify(s.state.connections.find((c) => c.id === id)) ===
                JSON.stringify(state.connections.find((c) => c.id === id)),
          ),
        ),
        dbLoading: Object.fromEntries(
          Object.entries(s.dbLoading).filter(([id]) => state.connections.some((c) => c.id === id)),
        ),
        dbErrors: Object.fromEntries(
          Object.entries(s.dbErrors).filter(([id]) => state.connections.some((c) => c.id === id)),
        ),
        connectionForm:
          s.connectionForm.id &&
          s.state.connections.some((c) => c.id === s.connectionForm.id) &&
          !state.connections.some((c) => c.id === s.connectionForm.id)
            ? emptyConnection(s.workspaceId)
            : s.connectionForm,
        sourceKey:
          s.sourceKey && !state.connections.some((c) => c.id === fromKey(s.sourceKey).connectionId)
            ? ''
            : s.sourceKey,
        targetKeys: s.targetKeys.filter((key) =>
          state.connections.some((c) => c.id === fromKey(key).connectionId),
        ),
        scopeTables:
          s.sourceKey && !state.connections.some((c) => c.id === fromKey(s.sourceKey).connectionId)
            ? []
            : s.scopeTables,
        currentTable:
          s.currentTable && state.connections.some((c) => c.id === s.currentTable!.ref.connectionId)
            ? s.currentTable
            : undefined,
        workspaceId: state.workspaces.some((w) => w.id === s.workspaceId)
          ? s.workspaceId
          : state.workspaces[0]?.id || 'default',
        settingsForm:
          resetSettings || !s.settingsDirty ? copyModel(state.settings) : s.settingsForm,
        settingsDirty: resetSettings ? false : s.settingsDirty,
        engineError: '',
        loading: false,
        historySelection: s.historySelection.filter((id) => state.records.some((r) => r.id === id)),
      }));
    } catch (e) {
      if (valid())
        commit((s) => ({
          ...s,
          engineError: e instanceof Error ? e.message : String(e),
          loading: false,
        }));
    }
  }
  function navigate(page: Page) {
    set('page', page);
    if (preview && page === 'import' && !latest.current.importRows.length) void loadImportExample();
  }
  async function loadImportExample() {
    if (!preview) return;
    commit((s) => ({
      ...s,
      importFormat: 'navicat',
      importName: '示例连接（虚构数据）.ncx',
      importFileToken: '',
      importText:
        '<Connections><Connection ConnectionName="示例连接" Host="192.0.2.100" Port="3306" UserName="demo_user" /></Connections>',
    }));
    await action(() => parseImport());
  }
  function switchWorkspace(id: string) {
    if (comparisonActive()) return;
    requests.current.clear();
    databaseLoads.current.clear();
    commit((s) => ({
      ...s,
      workspaceId: id,
      page: 'scope',
      sourceKey: '',
      targetKeys: [],
      scopeTables: [],
      plan: undefined,
      selectedIds: [],
      currentChangeId: '',
      detail: undefined,
      rollback: undefined,
      currentTable: undefined,
      dbCache: {},
      dbLoading: {},
      dbErrors: {},
      connectionSelection: [],
      connectionTest: undefined,
      connectionTests: {},
      connectionDialog: false,
      treeChildren: {},
      historySelection: [],
      currentVersionId: '',
      importWorkspaceIds: [id],
      importRows: [],
      exportSource: '',
      exportTables: [],
      exportSql: '',
    }));
  }
  async function loadDatabaseOptions(force = false, onlyId?: string) {
    const s = latest.current;
    const connections = s.state.connections.filter(
      (c) => c.workspaceIds.includes(s.workspaceId) && (!onlyId || c.id === onlyId),
    );
    await Promise.all(
      connections.map(async (connection) => {
        const id = connection.id;
        if (!force && latest.current.dbCache[id] !== undefined) return;
        const signature = JSON.stringify(connection);
        const pending = databaseLoads.current.get(id);
        if (pending && pending.signature === signature && pending.workspace === s.workspaceId)
          return pending.promise;
        const valid = request('databases:' + id);
        const current = () =>
          valid() &&
          JSON.stringify(latest.current.state.connections.find((c) => c.id === id)) === signature;
        commit((v) => ({
          ...v,
          dbLoading: { ...v.dbLoading, [id]: true },
          dbErrors: { ...v.dbErrors, [id]: '' },
        }));
        const loading = (async () => {
          try {
            const databases = await api<string[]>('databases.list', { connectionId: id });
            if (current()) commit((v) => ({ ...v, dbCache: { ...v.dbCache, [id]: databases } }));
          } catch (error) {
            if (current())
              commit((v) => ({
                ...v,
                dbErrors: {
                  ...v.dbErrors,
                  [id]: error instanceof Error ? error.message : String(error),
                },
              }));
          } finally {
            if (current()) commit((v) => ({ ...v, dbLoading: { ...v.dbLoading, [id]: false } }));
          }
        })();
        databaseLoads.current.set(id, { signature, workspace: s.workspaceId, promise: loading });
        await loading;
        if (databaseLoads.current.get(id)?.promise === loading) databaseLoads.current.delete(id);
      }),
    );
  }
  useEffect(() => {
    if (!m.loading && ['scope', 'templates', 'export'].includes(m.page)) void loadDatabaseOptions();
  }, [m.loading, m.page, m.workspaceId, m.state.connections]);
  async function loadTree(node: TreeNode) {
    if (!['connection', 'database'].includes(node.type)) return;
    const valid = request('tree:' + node.key);
    await action(async () => {
      let children: TreeNode[];
      if (node.type === 'connection') {
        const databases =
          latest.current.dbCache[node.connectionId!] ??
          (await api<string[]>('databases.list', {
            connectionId: node.connectionId,
          }));
        if (!valid()) return;
        children = databases.map((database) => ({
          key: `${node.connectionId}/${database}`,
          title: database,
          type: 'database',
          ref: { connectionId: node.connectionId!, database },
          isLeaf: false,
        }));
        commit((s) => ({
          ...s,
          dbCache: { ...s.dbCache, [node.connectionId!]: databases },
          treeChildren: { ...s.treeChildren, [node.key]: children },
        }));
      } else {
        const tables = await api<{ name: string; comment: string }[]>('tables.list', {
          ref: node.ref,
        });
        if (!valid()) return;
        children = tables.map((t) => ({
          key: `${refKey(node.ref!)}/${t.name}`,
          title: t.name,
          type: 'table',
          table: t.name,
          ref: node.ref,
          isLeaf: true,
        }));
        commit((s) => ({ ...s, treeChildren: { ...s.treeChildren, [node.key]: children } }));
      }
    });
  }
  async function openTable(node: TreeNode) {
    if (!node.ref || !node.table) return;
    const id = refKey(node.ref) + '/' + node.table;
    const valid = request('table');
    await action(async () => {
      let tab = latest.current.currentTable?.id === id ? latest.current.currentTable : undefined;
      if (!tab) {
        const model = await api<Table>('table.get', { ref: node.ref, table: node.table });
        tab = { id, ref: node.ref!, table: node.table!, model };
      }
      if (valid())
        commit((s) => ({
          ...s,
          currentTable: tab,
          page: 'table',
        }));
    });
  }
  async function refreshTable() {
    const tab = latest.current.currentTable;
    if (!tab) return;
    const valid = request('table:' + tab.id);
    await action(async () => {
      const model = await api<Table>('table.get', { ref: tab.ref, table: tab.table });
      if (valid() && latest.current.currentTable?.id === tab.id)
        commit((s) => ({
          ...s,
          currentTable: { ...tab, model },
        }));
    });
  }
  async function loadScope(
    source = latest.current.sourceKey,
    preselect?: string,
    mode: 'structure' | 'data' = 'structure',
  ) {
    commit((s) => ({ ...s, sourceKey: source, scopeTables: [] }));
    const valid = request('scope');
    if (!source) return false;
    return await action(async () => {
      const rows = await api<{ name: string; comment: string }[]>('tables.list', {
        ref: fromKey(source),
      });
      if (!valid() || latest.current.sourceKey !== source) return false;
      commit((s) => ({
        ...s,
        scopeTables: rows.map((t) => ({
          ...t,
          structure: !!preselect && t.name === preselect && mode === 'structure',
          data: !!preselect && t.name === preselect && mode === 'data',
          keyColumns: [],
          keyText: '',
          structureOptions: { ...s.structureDefaults },
        })),
        targetKeys: s.targetKeys.filter((k) => k !== source),
      }));
      return true;
    });
  }
  async function beginSync(node?: TreeNode, mode: 'structure' | 'data' = 'structure') {
    if (comparisonActive()) {
      navigate('scope');
      return;
    }
    const previousSource = latest.current.sourceKey;
    navigate('scope');
    if (!node && latest.current.sourceKey && latest.current.scopeTables.length) return;
    const valid = request('beginSync');
    await loadDatabaseOptions();
    if (!valid() || latest.current.page !== 'scope') return;
    if (!node && latest.current.sourceKey !== previousSource) return;
    const source = node?.ref
      ? refKey(node.ref)
      : latest.current.sourceKey || dbOptions(latest.current)[0]?.value || '';
    if (source) await loadScope(source, node?.table, mode);
  }
  function toggleScope(type: 'structure' | 'data') {
    commit((s) => {
      const matches = (table: ScopeTable) =>
        table.name.toLowerCase().includes(s.tableSearch.toLowerCase());
      const visible = s.scopeTables.filter(matches);
      if (!visible.length) return s;
      const selected = !visible.every((table) => table[type]);
      return {
        ...s,
        scopeTables: s.scopeTables.map((table) =>
          matches(table) ? { ...table, [type]: selected } : table,
        ),
      };
    });
  }
  function updateScope(name: string, fields: Partial<ScopeTable>) {
    commit((s) => ({
      ...s,
      scopeTables: s.scopeTables.map((t) => (t.name === name ? { ...t, ...fields } : t)),
    }));
  }
  const choices = (tables: TableChoice[]) =>
    tables
      .filter((t) => t.structure || t.data)
      .map((t) => ({
        name: t.name,
        structure: t.structure,
        data: t.data,
        keyColumns: t.keyText === undefined ? t.keyColumns : splitKeys(t.keyText),
        structureOptions: { ...effectiveOptions(t.structureOptions) },
      }));
  async function compare() {
    if (comparisonActive() || latest.current.compareConfirmation || compareStarting.current) return;
    const s = latest.current;
    if (!s.sourceKey || !s.targetKeys.length || !choices(s.scopeTables).length) return;
    const empty = s.scopeTables.find(
      (t) => t.structure && !Object.values(effectiveOptions(t.structureOptions)).some(Boolean),
    );
    if (empty) {
      void message.warning(`请选择结构细项：${empty.name}`);
      return;
    }
    set('compareConfirmation', copyModel(compareSelection(s)));
  }
  function dismissCompareConfirmation() {
    set('compareConfirmation', undefined);
  }
  async function startConfirmedCompare(pending: CompareSelection) {
    if (
      latest.current.compareConfirmation !== pending ||
      compareStarting.current ||
      comparisonActive()
    )
      return;
    if (selectionSignature(compareSelection(latest.current)) !== selectionSignature(pending)) {
      dismissCompareConfirmation();
      void message.warning('比较范围已变化，请重新确认');
      return;
    }
    compareStarting.current = true;
    const compareId = crypto.randomUUID();
    commit((s) => ({
      ...s,
      compareConfirmation: undefined,
      plan: undefined,
      selectedIds: [],
      currentChangeId: '',
      compareStartedAt: Date.now(),
      compareFinishedAt: 0,
      compareTransportError: '',
      compareTask: {
        compareId,
        status: 'RUNNING',
        progress: {
          table: '',
          phase: '准备比较',
          completed: 0,
          total: choices(pending.tables).length * (1 + pending.targetKeys.length),
          rows: 0,
        },
      },
    }));
    try {
      await api<{ compareId: string }>('sync.compare.start', {
        compareId,
        workspaceId: pending.workspaceId,
        source: fromKey(pending.sourceKey),
        targets: pending.targetKeys.map(fromKey),
        tables: choices(pending.tables),
      });
      if (
        latest.current.compareTask?.compareId === compareId &&
        latest.current.compareTask.status === 'CANCELLING'
      )
        await requestCompareCancel(compareId);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text.includes('超时')) {
        const task = latest.current.compareTask;
        if (task?.compareId === compareId) set('compareTask', { ...task, status: 'CANCELLING' });
        set('compareTransportError', '比较启动通信超时，正在请求停止并核验任务状态');
        await requestCompareCancel(compareId);
      } else if (latest.current.compareTask?.compareId === compareId) {
        commit((s) => ({
          ...s,
          compareTask: s.compareTask && { ...s.compareTask, status: 'FAILED', error: text },
          compareFinishedAt: Date.now(),
        }));
      }
    } finally {
      compareStarting.current = false;
    }
  }
  async function requestCompareCancel(compareId: string) {
    if (compareCancelPending.current) return;
    compareCancelPending.current = true;
    try {
      await api('sync.compare.cancel', { compareId });
    } catch (error) {
      if (latest.current.compareTask?.compareId === compareId)
        set(
          'compareTransportError',
          `停止请求尚未确认，将继续核验：${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      compareCancelPending.current = false;
    }
  }
  async function stopCompare() {
    const task = latest.current.compareTask;
    if (!task || !['RUNNING', 'CANCELLING'].includes(task.status)) return;
    set('compareTask', { ...task, status: 'CANCELLING' });
    if (!compareStarting.current) await requestCompareCancel(task.compareId);
  }
  function receiveCompare(task: CompareTask) {
    const current = latest.current.compareTask;
    if (
      !current ||
      current.compareId !== task.compareId ||
      !['RUNNING', 'CANCELLING'].includes(current.status)
    )
      return;
    const status =
      current.status === 'CANCELLING' && task.status === 'RUNNING' ? 'CANCELLING' : task.status;
    if (status === 'COMPLETED' && !task.plan) return; // Fetch the plan from get; events intentionally omit it.
    commit((s) => ({
      ...s,
      compareTask: { ...current, ...task, status, plan: undefined },
      compareTransportError: '',
      ...(['COMPLETED', 'CANCELLED', 'FAILED'].includes(status)
        ? { compareFinishedAt: Date.now() }
        : {}),
    }));
    if (status === 'COMPLETED' && task.plan) {
      const plan = task.plan;
      const changes = plan.targets.flatMap((target) => target.changes);
      commit((s) => ({
        ...s,
        plan,
        selectedIds: changes
          .filter((change) => change.selected && !change.blocked)
          .map((change) => change.id),
        currentChangeId: changes.find((change) => !change.blocked)?.id || '',
        diffTab: plan.tables.some((table) => table.structure) ? 'structure' : 'data',
        page: s.page === 'scope' ? 'diff' : s.page,
      }));
    }
  }
  function applyStructureDefaults(template = false) {
    commit((s) =>
      template
        ? {
            ...s,
            templateForm: {
              ...s.templateForm,
              tables: s.templateForm.tables.map((table) =>
                table.structure
                  ? { ...table, structureOptions: { ...s.templateStructureDefaults } }
                  : table,
              ),
            },
          }
        : {
            ...s,
            scopeTables: s.scopeTables.map((table) =>
              table.structure ? { ...table, structureOptions: { ...s.structureDefaults } } : table,
            ),
          },
    );
  }
  function toggleChanges(ids: string[], checked: boolean) {
    commit((s) => ({ ...s, selectedIds: toggleIds(s.selectedIds, ids, checked) }));
  }
  async function saveSync(mode: string) {
    const s = latest.current;
    if (!s.plan || !s.selectedIds.length || syncSubmitPending.current) return;
    for (const target of s.plan.targets) {
      const selected = target.changes.filter((change) => s.selectedIds.includes(change.id));
      const dependent = selected.find(
        (change) =>
          change.kind.endsWith('_ROW') &&
          !target.before[change.table]?.exists &&
          !selected.some(
            (item) => item.table === change.table && item.kind === 'CREATE_TABLE' && !item.blocked,
          ),
      );
      if (dependent) {
        void message.warning(
          `目标库 ${target.ref.database} 的 ${dependent.table} 不存在，请同时选中创建表操作`,
        );
        return;
      }
    }
    syncSubmitPending.current = true;
    try {
      if (mode === 'EXECUTE_AND_SAVE' || mode === 'SAVE_ONLY') {
        const accepted = await modal.confirm({
          title: mode === 'SAVE_ONLY' ? '预览并保存同步脚本' : '确认执行同步',
          centered: true,
          width: 960,
          content: (
            <SyncExecutionConfirmation
              plan={s.plan}
              selectedIds={s.selectedIds}
              connections={s.state.connections}
              saveOnly={mode === 'SAVE_ONLY'}
            />
          ),
          okText: mode === 'SAVE_ONLY' ? '确认保存' : '确认执行',
          cancelText: '取消',
        });
        if (!accepted) return;
        const current = latest.current;
        if (
          current.workspaceId !== s.workspaceId ||
          current.plan !== s.plan ||
          JSON.stringify(current.selectedIds) !== JSON.stringify(s.selectedIds)
        ) {
          void message.info(
            '同步范围已改变，请重新确认后' + (mode === 'SAVE_ONLY' ? '保存' : '执行'),
          );
          return;
        }
      }
      await action(async () => {
        const r = await api<SyncRecord>('sync.save', {
          planId: s.plan!.id,
          selectedIds: s.selectedIds,
          mode,
          remark: s.scopeRemark,
        });
        await loadState();
        if (latest.current.workspaceId === s.workspaceId) await openRecord(r.id);
        void message.success(
          mode === 'SAVE_ONLY'
            ? '同步记录和脚本已保存，目标库未变更'
            : '任务已创建，正在准备恢复资料',
        );
      });
    } finally {
      syncSubmitPending.current = false;
    }
  }
  function editWorkspace(w?: Workspace) {
    const s = latest.current;
    set(
      'workspaceForm',
      w
        ? {
            ...copyModel(w),
            connectionIds: s.state.connections
              .filter((c) => c.workspaceIds.includes(w.id))
              .map((c) => c.id),
          }
        : { id: crypto.randomUUID(), name: '', description: '', connectionIds: [] },
    );
    navigate('workspaces');
  }
  async function saveWorkspace() {
    const s = latest.current;
    const form = { ...copyModel(s.workspaceForm), id: s.workspaceForm.id || crypto.randomUUID() };
    await action(async () => {
      if (!form.name.trim()) throw new Error('请输入工作区名称');
      await api('entity.save', { kind: 'workspace', value: form });
      if (latest.current.workspaceForm === s.workspaceForm) patch('workspaceForm', { id: form.id });
      for (const c of s.state.connections) {
        const workspaceIds = c.workspaceIds.filter((id) => id !== form.id);
        if (form.connectionIds?.includes(c.id)) workspaceIds.push(form.id);
        await api('entity.save', { kind: 'connection', value: { ...c, workspaceIds } });
      }
      await loadState();
      void message.success('工作区已保存');
    });
  }
  function editConnection(c?: ConnectionInfo) {
    const form = c
      ? { ...copyModel(c), password: '', certificatePassword: '' }
      : { ...emptyConnection(latest.current.workspaceId), id: crypto.randomUUID() };
    commit((s) => ({
      ...s,
      connectionForm: form,
      connectionTest: undefined,
      connectionDialog: true,
      databasesText: form.databases.join(', '),
      page: 'connections',
    }));
  }
  function closeConnection() {
    commit((s) => ({
      ...s,
      connectionDialog: false,
      connectionForm: emptyConnection(s.workspaceId),
      connectionTest: undefined,
      databasesText: '',
    }));
  }
  async function saveConnection() {
    const s = latest.current;
    const form = {
      ...copyModel(s.connectionForm),
      id: s.connectionForm.id || crypto.randomUUID(),
      databases: splitKeys(s.databasesText),
    };
    await action(async () => {
      if (!form.name.trim() || !form.host.trim() || !form.user.trim() || !form.workspaceIds.length)
        throw new Error('请填写连接名称、服务器、用户并选择工作区');
      await api('entity.save', { kind: 'connection', value: form });
      if (latest.current.connectionForm === s.connectionForm)
        commit((v) => ({
          ...v,
          connectionDialog: false,
          connectionForm: {
            ...v.connectionForm,
            id: form.id,
            password: '',
            certificatePassword: '',
          },
        }));
      for (const key of requests.current.keys())
        if (
          key === 'databases:' + form.id ||
          key === 'tree:' + form.id ||
          key.startsWith('tree:' + form.id + '/')
        )
          requests.current.delete(key);
      databaseLoads.current.delete(form.id);
      commit((v) => ({
        ...v,
        dbCache: Object.fromEntries(Object.entries(v.dbCache).filter(([key]) => key !== form.id)),
        dbLoading: { ...v.dbLoading, [form.id]: false },
        dbErrors: { ...v.dbErrors, [form.id]: '' },
        treeChildren: Object.fromEntries(
          Object.entries(v.treeChildren).filter(
            ([key]) => key !== form.id && !key.startsWith(form.id + '/'),
          ),
        ),
      }));
      await loadState();
      void message.success('连接已保存');
    });
  }
  async function testConnection(connection?: ConnectionInfo) {
    const s = latest.current;
    const previous = connection ? s.connectionTests[connection.id] : s.connectionTest;
    if (previous?.status === 'testing') return;
    const config = connection
      ? { ...connection }
      : { ...s.connectionForm, databases: splitKeys(s.databasesText) };
    const valid = request(connection ? 'connectionTest:' + connection.id : 'connectionTest:form');
    const testing = { status: 'testing' as const, message: '正在测试连接' };
    commit((v) =>
      connection
        ? { ...v, connectionTests: { ...v.connectionTests, [connection.id]: testing } }
        : { ...v, connectionTest: testing },
    );
    let result: NonNullable<Model['connectionTest']>;
    try {
      const validation = connectionTestError(config);
      if (validation) throw new Error(validation);
      const response = await api<{ serverVersion: string }>('connections.test', {
        id: config.id,
        config,
      });
      result = { status: 'success', message: '连接成功 · ' + response.serverVersion };
    } catch (error) {
      result = {
        status: 'error',
        message: '连接失败 · ' + (error instanceof Error ? error.message : String(error)),
      };
    }
    if (!valid()) return;
    const current = latest.current;
    if (connection) {
      if (
        current.connectionTests[connection.id] !== testing ||
        JSON.stringify(current.state.connections.find((c) => c.id === connection.id)) !==
          JSON.stringify(connection)
      )
        return;
      commit((v) => ({ ...v, connectionTests: { ...v.connectionTests, [connection.id]: result } }));
      if (current.page !== 'connections')
        void message.open({
          type: result.status === 'success' ? 'success' : 'error',
          content: connection.name + '：' + result.message,
        });
    } else if (
      current.connectionTest === testing &&
      current.connectionForm === s.connectionForm &&
      current.databasesText === s.databasesText
    ) {
      commit((v) => ({ ...v, connectionTest: result }));
    }
  }
  async function chooseCertificate(field: 'ca' | 'clientCert') {
    const id = latest.current.connectionForm.id;
    const path = await action(() => api<string | null>('files.chooseCertificate'));
    if (path && latest.current.connectionForm.id === id) patch('connectionForm', { [field]: path });
  }
  async function removeEntity(kind: string, id: string) {
    if (kind === 'connection') return removeConnections([id]);
    if (!(await confirm('删除配置', '确认删除这项配置？已有同步记录会保留。', '删除'))) return;
    await action(async () => {
      await api('entity.delete', { kind, id });
      await loadState();
    });
  }
  async function removeConnections(ids = latest.current.connectionSelection) {
    const connections = latest.current.state.connections.filter((c) => ids.includes(c.id));
    if (!connections.length) return;
    if (
      !(await confirm(
        '删除连接',
        `确认删除这 ${connections.length} 个连接配置（${connections.map((c) => c.name).join('、')}）？连接会从所有关联工作区移除，已有同步记录会保留。`,
        '删除',
      ))
    )
      return;
    await action(async () => {
      let deleted = 0;
      try {
        for (const connection of connections) {
          await api('entity.delete', { kind: 'connection', id: connection.id });
          deleted++;
          requests.current.delete('databases:' + connection.id);
          databaseLoads.current.delete(connection.id);
          for (const key of requests.current.keys())
            if (key === 'tree:' + connection.id || key.startsWith('tree:' + connection.id + '/'))
              requests.current.delete(key);
        }
      } catch (error) {
        throw new Error(
          `已删除 ${deleted} 个连接，其余连接删除失败：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await loadState();
      }
      void message.success(`已删除 ${deleted} 个连接`);
    });
  }
  async function refreshConnection(id: string) {
    const connection = latest.current.state.connections.find((c) => c.id === id);
    if (!connection) return;
    for (const key of requests.current.keys())
      if (key === 'tree:' + id || key.startsWith('tree:' + id + '/')) requests.current.delete(key);
    commit((s) => ({
      ...s,
      treeChildren: Object.fromEntries(
        Object.entries(s.treeChildren).filter(([key]) => key !== id && !key.startsWith(id + '/')),
      ),
    }));
    await loadDatabaseOptions(true, id);
    if (!latest.current.dbErrors[id])
      await loadTree({ key: id, title: connection.name, type: 'connection', connectionId: id });
  }
  async function parseImport(input = latest.current) {
    const valid = request('import');
    const parsed = await api<ImportRow[]>('imports.parse', {
      format: input.importFormat,
      content: input.importText,
      fileToken: input.importFileToken,
    });
    if (
      valid() &&
      latest.current.importFormat === input.importFormat &&
      latest.current.importText === input.importText &&
      latest.current.importFileToken === input.importFileToken
    )
      set(
        'importRows',
        parsed.map((c) => ({
          ...c,
          selected: !c.warning,
          workspaceIds: [input.workspaceId],
          password: c.password || '',
        })),
      );
  }
  async function readImport() {
    const valid = request('importFile');
    await action(async () => {
      const f = await api<{ name: string; content: string; token?: string } | null>('files.read', {
        intent: 'sessions',
      });
      if (f && valid()) {
        commit((s) => ({
          ...s,
          importName: f.name,
          importText: f.content,
          importFileToken: f.token || '',
        }));
        await parseImport();
      }
    });
  }
  function updateImport(id: string, fields: Partial<ImportRow>) {
    const connectionChanged = [
      'host',
      'port',
      'user',
      'password',
      'ssl',
      'ca',
      'clientCert',
      'certificatePassword',
    ].some((key) => key in fields);
    if (connectionChanged) requests.current.delete('importTest:' + id);
    commit((s) => ({
      ...s,
      importRows: s.importRows.map((r) =>
        r.id === id
          ? {
              ...r,
              ...fields,
              ...(connectionChanged ? { connectionTest: undefined } : {}),
            }
          : r,
      ),
    }));
  }
  async function testImportConnection(id: string) {
    const row = latest.current.importRows.find((r) => r.id === id);
    if (!row || row.warning || row.connectionTest?.status === 'testing') return;
    const valid = request('importTest:' + id);
    updateImport(id, { connectionTest: { status: 'testing', message: '正在测试连接' } });
    const testingRow = latest.current.importRows.find((r) => r.id === id);
    const applyResult = (status: 'success' | 'error', message: string) => {
      if (
        valid() &&
        latest.current.importRows.some(
          (r) => r.id === id && r.connectionTest === testingRow?.connectionTest,
        )
      )
        updateImport(id, { connectionTest: { status, message } });
    };
    try {
      const { credentialStatus, warning, selected, connectionTest, ...config } = row;
      const validation = connectionTestError(config);
      if (validation) throw new Error(validation);
      const result = await api<{ serverVersion: string }>('connections.test', {
        config: { ...config, importCredentialId: row.id },
      });
      applyResult('success', '连接成功 · ' + result.serverVersion);
    } catch (error) {
      applyResult(
        'error',
        '连接失败 · ' + (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  async function submitImport() {
    const s = latest.current;
    await action(async () => {
      if (!s.importWorkspaceIds.length) throw new Error('请选择导入工作区');
      for (const row of s.importRows.filter((r) => r.selected && !r.warning)) {
        const { connectionTest, ...connection } = row;
        const existing = s.state.connections.find(
          (c) => c.host === row.host && c.port === row.port && c.user === row.user,
        );
        if (existing && s.duplicateMode === 'skip') continue;
        await api('entity.save', {
          kind: 'connection',
          value: {
            ...connection,
            id: existing && s.duplicateMode === 'update' ? existing.id : row.id,
            group: s.importGroup,
            importCredentialId: row.id,
            workspaceIds: [
              ...new Set([
                ...(existing && s.duplicateMode === 'update' ? existing.workspaceIds : []),
                ...s.importWorkspaceIds,
              ]),
            ],
          },
        });
      }
      if (latest.current.workspaceId === s.workspaceId)
        commit((v) => ({
          ...v,
          importRows: [],
          importText: '',
          importFileToken: '',
          page: 'connections',
        }));
      await loadState();
      void message.success('所选连接已导入');
    });
  }
  function editTemplate(t?: SyncTemplate) {
    const s = latest.current;
    const form = t
      ? copyModel(t)
      : {
          id: crypto.randomUUID(),
          workspaceId: s.workspaceId,
          name: '',
          description: '',
          source: s.sourceKey ? fromKey(s.sourceKey) : { connectionId: '', database: '' },
          targets: s.targetKeys.map(fromKey),
          tables: choices(s.scopeTables),
        };
    commit((v) => ({
      ...v,
      templateForm: {
        ...form,
        tables: form.tables.map((t) => ({ ...t, keyText: t.keyColumns.join(', ') })),
      },
      templateSource: form.source.connectionId ? refKey(form.source) : '',
      templateTargets: form.targets.map(refKey),
      page: 'templates',
    }));
  }
  async function templateSourceChanged(source: string) {
    set('templateSource', source);
    const valid = request('templateScope');
    const id = latest.current.templateForm.id;
    await action(async () => {
      const rows = await api<{ name: string }[]>('tables.list', { ref: fromKey(source) });
      if (
        valid() &&
        latest.current.templateSource === source &&
        latest.current.templateForm.id === id
      )
        patch('templateForm', {
          tables: rows.map((t) => ({
            name: t.name,
            structure: false,
            data: false,
            keyColumns: [],
            keyText: '',
            structureOptions: { ...latest.current.templateStructureDefaults },
          })),
        });
    });
  }
  function updateTemplateTable(name: string, fields: Partial<TableChoice>) {
    commit((s) => ({
      ...s,
      templateForm: {
        ...s.templateForm,
        tables: s.templateForm.tables.map((t) => (t.name === name ? { ...t, ...fields } : t)),
      },
    }));
  }
  async function saveTemplate() {
    const s = latest.current;
    await action(async () => {
      if (!s.templateForm.name.trim() || !s.templateSource || !s.templateTargets.length)
        throw new Error('请填写模板名称并选择来源与目标库');
      await api('entity.save', {
        kind: 'template',
        value: {
          ...s.templateForm,
          source: fromKey(s.templateSource),
          targets: s.templateTargets.map(fromKey),
          tables: choices(s.templateForm.tables),
        },
      });
      await loadState();
      void message.success('模板已保存');
    });
  }
  async function applyTemplate(t: SyncTemplate) {
    if (comparisonActive()) return;
    const source = refKey(t.source);
    set('sourceKey', source);
    set('targetKeys', t.targets.map(refKey));
    if (!(await loadScope(source))) return;
    if (latest.current.sourceKey !== source || latest.current.workspaceId !== t.workspaceId) return;
    commit((s) => ({
      ...s,
      scopeTables: s.scopeTables.map((item) => {
        const saved = t.tables.find((c) => c.name === item.name);
        return saved
          ? {
              ...item,
              ...copyModel(saved),
              structureOptions: { ...effectiveOptions(saved.structureOptions) },
              keyText: saved.keyColumns.join(', '),
            }
          : item;
      }),
      page: 'scope',
    }));
  }
  function openVersionDrawer() {
    commit((s) => ({
      ...s,
      versionForm: { id: '', number: '', description: '', move: false },
      versionMode: 'new',
      versionDrawer: true,
    }));
  }
  async function markVersion() {
    const s = latest.current;
    await action(async () => {
      const version =
        s.versionMode === 'append'
          ? s.state.versions.find((v) => v.id === s.versionForm.id)
          : s.versionForm;
      if (!version || !version.number.trim()) throw new Error('请填写版本号或选择已有版本');
      await api('version.save', {
        workspaceId: s.workspaceId,
        id: version.id,
        number: version.number,
        description: version.description,
        move: s.versionForm.move,
        recordIds: s.historySelection,
      });
      set('versionDrawer', false);
      await loadState();
      void message.success('版本归档已更新');
    });
  }
  async function editVersion() {
    const s = latest.current;
    const version = s.state.versions.find((v) => v.id === s.currentVersionId);
    if (!version) return;
    let description = version.description;
    const accepted = await modal.confirm({
      title: '编辑版本说明',
      content: (
        <Input.TextArea
          defaultValue={description}
          onChange={(e) => {
            description = e.target.value;
          }}
          rows={4}
          aria-label="版本说明"
        />
      ),
      okText: '保存',
      cancelText: '取消',
    });
    if (accepted)
      await action(async () => {
        await api('version.save', { ...version, recordIds: [], description });
        await loadState();
      });
  }
  async function openRecord(id: string) {
    const valid = request('record');
    const detail = await api<RecordDetail>('record.get', { id });
    if (!valid()) return;
    const file = defaultScriptFile(detail.files, 'scripts');
    commit((s) => ({
      ...s,
      detail,
      fileSelected: file,
      fileSql: '',
      recordScripts: {},
      recordScriptErrors: {},
      recordScriptTargets: {},
      recordTab:
        detail.record.mode === 'EXECUTE_AND_SAVE' &&
        ['RUNNING', 'QUEUED'].includes(detail.record.status)
          ? 'results'
          : 'scripts',
      page: 'record',
    }));
    await loadRecordScripts('scripts');
  }
  async function selectFile(file: string) {
    const id = latest.current.detail?.record.id;
    if (!id) return;
    commit((s) => ({ ...s, fileSelected: file, fileSql: '' }));
    const valid = request('file');
    const sql = await api<string>('record.file', { id, file });
    if (valid() && latest.current.detail?.record.id === id && latest.current.fileSelected === file)
      set('fileSql', sql);
  }
  async function changeRecordTab(tab: string) {
    set('recordTab', tab);
    await loadRecordScripts(tab);
  }
  async function loadRecordScripts(tab: string) {
    const s = latest.current;
    if (!s.detail || !['scripts', 'rollbackScripts'].includes(tab)) return;
    const id = s.detail.record.id;
    const valid = request('recordScripts');
    // Target manifests identify the connection even when two connections use the same database name.
    const manifests = s.detail.files.filter((file) => file.endsWith('/target.json'));
    await Promise.all(
      manifests.map(async (file) => {
        const folder = file.slice(0, -'/target.json'.length);
        if (s.recordScriptTargets[folder]) return;
        try {
          const ref = JSON.parse(await api<string>('record.file', { id, file })) as DbRef;
          if (
            valid() &&
            latest.current.detail?.record.id === id &&
            ref.database &&
            ref.connectionId
          )
            commit((current) => ({
              ...current,
              recordScriptTargets: { ...current.recordScriptTargets, [folder]: ref },
            }));
        } catch {
          /* Legacy archives can still display their folder label. */
        }
      }),
    );
    await Promise.all(
      recordScriptFiles(s.detail.files, tab).map(async (file) => {
        if (s.recordScripts[file] !== undefined) return;
        try {
          const sql = await api<string>('record.file', { id, file });
          if (valid() && latest.current.detail?.record.id === id) {
            commit((current) => ({
              ...current,
              recordScripts: { ...current.recordScripts, [file]: sql },
              recordScriptErrors: { ...current.recordScriptErrors, [file]: '' },
            }));
          }
        } catch (error) {
          if (valid() && latest.current.detail?.record.id === id) {
            commit((current) => ({
              ...current,
              recordScriptErrors: {
                ...current.recordScriptErrors,
                [file]: error instanceof Error ? error.message : String(error),
              },
            }));
          }
        }
      }),
    );
  }
  async function exportRecords(ids: string[], name?: string) {
    await action(async () => {
      if (await api('record.export', { ids, name })) void message.success('脚本包已导出');
    });
  }
  async function auditRecord() {
    const id = latest.current.detail?.record.id;
    if (!id) return;
    await action(async () => {
      await api('record.verify', { id });
      await loadState();
      if (latest.current.detail?.record.id === id) {
        await openRecord(id);
        set('recordTab', 'results');
      }
      void message.success('当前状态核验已记录，原执行状态保留');
    });
  }
  async function cancelTask() {
    const id = latest.current.detail?.record.id;
    if (id) await action(() => api('record.cancel', { id }));
  }
  function declareExternal() {
    const record = latest.current.detail?.record;
    if (!record) return;
    commit((s) => ({
      ...s,
      externalIds: [...record.selectedIds],
      externalBackup: false,
      externalRemark: '',
      externalDrawer: true,
    }));
  }
  async function saveExternal() {
    const s = latest.current;
    if (!s.detail) return;
    const id = s.detail.record.id;
    await action(async () => {
      await api('external.declare', {
        id,
        confirmedIds: s.externalIds,
        backupCompleted: s.externalBackup,
        remark: s.externalRemark,
      });
      set('externalDrawer', false);
      await loadState();
      if (latest.current.detail?.record.id === id) await openRecord(id);
      void message.success('外部执行已登记，待核验');
    });
  }
  async function verifyExternal() {
    const id = latest.current.detail?.record.id;
    if (!id) return;
    await action(async () => {
      const result = await api<{ verified: boolean }>('external.verify', { id });
      await loadState();
      if (latest.current.detail?.record.id === id) await openRecord(id);
      void (result.verified
        ? message.success('执行状态与恢复资料已核验')
        : message.warning('未通过完整核验，请查看校验结果'));
    });
  }
  async function beginRollback(id: string) {
    const valid = request('rollback');
    await action(async () => {
      const rollback = await api<RollbackPlan>('rollback.preview', { id });
      if (valid())
        commit((s) => ({
          ...s,
          rollback,
          rollbackIds: rollback.items.filter((i) => i.eligible).map((i) => i.id),
          rollbackSql: rollback.items.find((i) => i.eligible)?.sql.join(';\n') || '',
          rollbackRemark: '',
          page: 'rollback',
        }));
    });
  }
  function toggleRecovery(ids: string[], checked: boolean) {
    commit((s) => ({ ...s, rollbackIds: toggleIds(s.rollbackIds, ids, checked) }));
  }
  async function executeRollback() {
    const s = latest.current;
    if (!s.rollback) return;
    if (
      !(await confirm(
        '执行回滚',
        `将恢复已选的 ${s.rollbackIds.length} 项变更，执行前会再次核验目标状态与恢复资料。`,
        '执行所选回滚',
      ))
    )
      return;
    await action(async () => {
      const r = await api<SyncRecord>('rollback.execute', {
        id: s.rollback!.recordId,
        selectedIds: s.rollbackIds,
        remark: s.rollbackRemark,
      });
      await loadState();
      if (latest.current.workspaceId === s.workspaceId) await openRecord(r.id);
    });
  }
  async function beginExport(node?: TreeNode) {
    const s = latest.current;
    const source = node?.ref ? refKey(node.ref) : s.sourceKey || dbOptions(s)[0]?.value || '';
    commit((v) => ({
      ...v,
      page: 'export',
      includeDrop: false,
      exportSql: '',
      exportSource: source,
    }));
    await loadExport(source, node?.table);
  }
  async function loadExport(source = latest.current.exportSource, preselect?: string) {
    request('exportSQL');
    commit((s) => ({ ...s, exportSource: source, exportTables: [], exportSql: '' }));
    const valid = request('exportScope');
    if (!source) return;
    await action(async () => {
      const rows = await api<{ name: string; comment: string }[]>('tables.list', {
        ref: fromKey(source),
      });
      if (!valid() || latest.current.exportSource !== source) return;
      commit((s) => ({
        ...s,
        exportTables: rows.map((t) => ({ ...t, selected: !!preselect && t.name === preselect })),
        exportFilename: fromKey(source).database + '_schema.sql',
        exportSql: '',
      }));
    });
  }
  async function updateExport() {
    const s = latest.current;
    const tables = s.exportTables.filter((t) => t.selected).map((t) => t.name);
    if (s.loading || s.busy || !s.exportSource || !tables.length) return;
    const valid = request('exportSQL');
    commit((v) => ({ ...v, exportSql: '', exportGenerating: true }));
    try {
      await action(async () => {
        const result = await api<{ sql: string }>('schema.export', {
          source: fromKey(s.exportSource),
          tables,
          includeDrop: s.includeDrop,
        });
        const current = latest.current;
        if (
          valid() &&
          current.exportSource === s.exportSource &&
          current.includeDrop === s.includeDrop &&
          JSON.stringify(current.exportTables.filter((t) => t.selected).map((t) => t.name)) ===
            JSON.stringify(tables)
        )
          set('exportSql', result.sql);
      });
    } finally {
      set('exportGenerating', false);
    }
  }
  function selectExport(names: string[]) {
    request('exportSQL');
    commit((s) => ({
      ...s,
      exportSql: '',
      exportTables: s.exportTables.map((t) => ({ ...t, selected: names.includes(t.name) })),
    }));
  }
  function setIncludeDrop(value: boolean) {
    if (value === latest.current.includeDrop) return;
    request('exportSQL');
    commit((s) => ({ ...s, includeDrop: value, exportSql: '' }));
  }
  async function saveSql() {
    const s = latest.current;
    if (s.exportSql && !s.busy)
      await action(async () => {
        if (await api('files.save', { name: s.exportFilename, content: s.exportSql }))
          void message.success('结构 SQL 已导出');
      });
  }
  async function saveSettings() {
    const form = latest.current.settingsForm;
    await action(async () => {
      await api('entity.save', { kind: 'settings', value: form });
      commit((s) => ({ ...s, settingsDirty: s.settingsForm !== form }));
      await loadState();
      void message.success('设置已保存');
    });
  }
  function cancelSettings() {
    commit((s) => ({ ...s, settingsForm: copyModel(s.state.settings), settingsDirty: false }));
  }
  async function selectDirectory() {
    const path = await action(() => api<string | null>('files.chooseDirectory'));
    if (path) patch('settingsForm', { archivePath: path });
  }
  async function backupLocal() {
    await action(async () => {
      if (await api('backup.export')) void message.success('本地配置、记录和脚本已备份');
    });
  }
  async function restoreLocal() {
    if (
      !(await confirm(
        '恢复本地备份',
        '导入备份会替换当前配置与记录。系统会先备份当前资料；连接密码需在本机重新核对。',
        '恢复',
      ))
    )
      return;
    await action(async () => {
      if (await api('backup.import')) {
        await loadState(true);
        void message.success('本地备份已恢复');
      }
    });
  }
  async function clearArchive(id: string) {
    if (
      !(await confirm(
        '清理档案',
        '永久删除此记录的本地脚本与恢复档案，之后工具内无法回滚。历史条目仍保留。',
        '永久清理',
      ))
    )
      return;
    await action(async () => {
      await api('archives.clear', { id, confirm: true });
      await loadState();
      void message.success('档案已清理');
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
        await loadState(true);
        void message.success('项目配置已导入');
      }
    });
  }
  async function closeWindow() {
    if (closePending.current) return;
    closePending.current = true;
    try {
      const state = await api<State>('state.load');
      if (
        (comparisonActive() ||
          state.records.some((r) => ['RUNNING', 'QUEUED'].includes(r.status))) &&
        !(await confirm(
          '关闭客户端',
          comparisonActive()
            ? '有比较任务正在运行，关闭客户端会中断比较并丢弃本次结果。'
            : '有同步任务正在执行。关闭客户端会中断任务，重启后需要核验实际状态。',
          '关闭',
        ))
      ) {
        windowAction('close-cancelled');
        return;
      }
      windowAction('close-confirmed');
    } catch {
      if (
        await confirm(
          '关闭客户端',
          '当前无法确认同步任务状态，关闭可能中断任务。确认关闭客户端？',
          '关闭',
        )
      )
        windowAction('close-confirmed');
      else windowAction('close-cancelled');
    } finally {
      closePending.current = false;
    }
  }
  const handlers = useRef({ loadState, closeWindow, receiveCompare, requestCompareCancel });
  handlers.current = { loadState, closeWindow, receiveCompare, requestCompareCancel };
  const compareId = m.compareTask?.compareId;
  const comparing = !!m.compareTask && ['RUNNING', 'CANCELLING'].includes(m.compareTask.status);
  useEffect(() => {
    if (!comparing || !compareId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (compareStarting.current) {
        timer = setTimeout(poll, 1000);
        return;
      }
      try {
        const task = await api<CompareTask>('sync.compare.get', { compareId });
        if (active) {
          const retryCancellation =
            latest.current.compareTask?.status === 'CANCELLING' && task.status === 'RUNNING';
          handlers.current.receiveCompare(task);
          if (retryCancellation) await handlers.current.requestCompareCancel(compareId);
        }
      } catch (error) {
        if (active && latest.current.compareTask?.compareId === compareId) {
          set(
            'compareTransportError',
            `比较状态暂未确认：${error instanceof Error ? error.message : String(error)}`,
          );
          if (error instanceof Error && error.message.includes('超时')) {
            set('compareTask', { ...latest.current.compareTask, status: 'CANCELLING' });
            await handlers.current.requestCompareCancel(compareId);
          }
        }
      }
      if (active) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [compareId, comparing]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onEvent((event) => {
      if (event.event === 'window-close-request') void handlers.current.closeWindow();
      if (event.event === 'engine-error') {
        set('engineError', String(event.message));
        const task = latest.current.compareTask;
        if (task && ['RUNNING', 'CANCELLING'].includes(task.status))
          handlers.current.receiveCompare({
            ...task,
            status: 'FAILED',
            error: '引擎已退出，比较中断',
          });
      }
      if (event.event === 'compare-progress') {
        const current = latest.current.compareTask;
        if (current && event.compareId === current.compareId)
          handlers.current.receiveCompare({ ...current, ...event } as unknown as CompareTask);
      }
      if (event.event === 'job') {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          await handlers.current.loadState();
          const s = latest.current;
          if (s.page === 'record' && s.detail) {
            const id = s.detail.record.id;
            await action(async () => {
              const detail = await api<RecordDetail>('record.get', { id });
              if (active && latest.current.detail?.record.id === id) set('detail', detail);
            });
          }
        }, 300);
      }
    });
    windowAction('renderer-ready');
    void (async () => {
      await loadState();
      if (!active) return;
      if (preview) {
        const requested = new URLSearchParams(location.search).get('page') as Page | null;
        if (
          requested &&
          [
            'settings',
            'import',
            'connections',
            'workspaces',
            'history',
            'templates',
            'export',
            'scope',
          ].includes(requested)
        ) {
          navigate(requested);
          return;
        }
        set('sourceKey', 'test/shop_test');
        set(
          'targetKeys',
          dbOptions(latest.current)
            .filter((o) => !o.value.startsWith('test/'))
            .map((o) => o.value),
        );
        await loadScope();
        if (!active) return;
        commit((s) => ({
          ...s,
          scopeTables: s.scopeTables.map((t) =>
            ['sys_dict', 'sys_menu', 'sys_user'].includes(t.name)
              ? { ...t, structure: true, data: t.name !== 'sys_user', keyText: 'code' }
              : t,
          ),
        }));
        // The initial browser showcase is a static fixture, not a user-triggered comparison.
        const plan = copyModel(previewPlan);
        commit((s) => ({
          ...s,
          plan,
          page: 'diff',
          selectedIds: plan.targets
            .flatMap((t) => t.changes)
            .filter((x) => x.selected && !x.blocked)
            .map((x) => x.id),
        }));
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
      unsubscribe();
      clearTimeout(timer);
      requests.current.clear();
    };
  }, []);
  return {
    m,
    set,
    patch,
    commit,
    action,
    navigate,
    loadState,
    switchWorkspace,
    loadTree,
    openTable,
    refreshTable,
    beginSync,
    loadScope,
    toggleScope,
    updateScope,
    compare,
    startConfirmedCompare,
    dismissCompareConfirmation,
    stopCompare,
    applyStructureDefaults,
    toggleChanges,
    saveSync,
    editWorkspace,
    saveWorkspace,
    editConnection,
    closeConnection,
    saveConnection,
    testConnection,
    loadDatabaseOptions,
    refreshConnection,
    removeConnections,
    testImportConnection,
    chooseCertificate,
    removeEntity,
    readImport,
    loadImportExample,
    parseImport,
    updateImport,
    submitImport,
    editTemplate,
    templateSourceChanged,
    updateTemplateTable,
    saveTemplate,
    applyTemplate,
    openVersionDrawer,
    markVersion,
    editVersion,
    openRecord,
    changeRecordTab,
    selectFile,
    exportRecords,
    auditRecord,
    cancelTask,
    declareExternal,
    saveExternal,
    verifyExternal,
    beginRollback,
    toggleRecovery,
    executeRollback,
    beginExport,
    loadExport,
    updateExport,
    selectExport,
    setIncludeDrop,
    saveSql,
    saveSettings,
    cancelSettings,
    selectDirectory,
    backupLocal,
    restoreLocal,
    clearArchive,
    exportConfig,
    importConfig,
  };
}
export type Controller = ReturnType<typeof useBusinessController>;
const Context = createContext<Controller | null>(null);
export function BusinessProvider({ children }: { children: ReactNode }) {
  const controller = useBusinessController();
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useController() {
  const value = useContext(Context);
  if (!value) throw new Error('BusinessProvider missing');
  return value;
}
