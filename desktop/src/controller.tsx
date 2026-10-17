import { reconcileReferences, workspaceContents } from './resource-references';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { App, Form, Input, Radio } from 'antd';
import { mixedSyncModes, syncModeOf, tablesForMode, type SyncMode } from './sync-mode';
import { api, onEvent, preview, windowAction } from './api';
import { copyModel } from './copy';
import type { NavigationTarget, RecordOrigin } from './navigation';
import { connectionSaveError, connectionTestError } from './connection-validation';
import { versionNumberError } from './version-validation';
import {
  connectionGroupName,
  connectionSignature,
  discoverySignature,
  normalizeOrganization,
} from './connection-organization';
import { SyncExecutionConfirmation } from './components/SyncExecutionConfirmation';
import { RollbackExecutionConfirmation } from './components/RollbackExecutionConfirmation';
import { effectiveOptions } from './structure-options';
import { defaultScriptFile, recordScriptFiles } from './sync-scripts';
import {
  changesOf,
  statusLabel,
  connectionOwnsKey,
  dbOptions,
  emptyConnection,
  fromKey,
  initialModel,
  modelReducer,
  refKey,
  splitKeys,
  toggleIds,
  targetRefreshKey,
  recordRefreshKey,
  rollbackRefreshKey,
  scopeTableMatches,
  tableRefreshKey,
  type ConnectionTestResult,
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
  ConnectionGroup,
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

function scopeForMode(s: Model, mode: SyncMode): Model {
  if (s.scopeMode === mode) return s;
  const draft = s.scopeDrafts[mode];
  return {
    ...s,
    scopeDrafts: {
      ...s.scopeDrafts,
      [s.scopeMode]: {
        tables: copyModel(s.scopeTables),
        search: s.tableSearch,
        filter: s.scopeTableFilter,
      },
    },
    scopeMode: mode,
    scopeTables: draft
      ? copyModel(draft.tables)
      : s.scopeTables.map((table) => ({
          ...copyModel(table),
          structure: false,
          data: false,
          keyColumns: [],
          keyText: '',
          structureOptions: { ...s.structureDefaults },
        })),
    tableSearch: draft?.search || '',
    scopeTableFilter: draft?.filter || 'all',
  };
}

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
  const rollbackSubmitPending = useRef(false);
  const versionSubmitPending = useRef(false);
  const compareStarting = useRef(false);
  const compareCancelPending = useRef(false);
  const targetTableLoads = useRef(new Map<string, { signature: string; promise: Promise<void> }>());
  const connectionEditorGeneration = useRef(0);
  const recordRemarkGeneration = useRef(0);
  const groupSaving = useRef(false);
  const groupDeleting = useRef(false);
  const groupEditorGeneration = useRef(0);
  const workspaceEditorGeneration = useRef(0);
  const workspaceSaving = useRef(false);
  const templateEditorGeneration = useRef(0);
  const templateSaving = useRef(false);
  const refreshPending = useRef(new Set<string>());
  const treeTestsPending = useRef(new Map<string, ConnectionTestResult>());
  const exportGeneration = useRef<object | undefined>(undefined);
  const targetTableSets = useRef(new WeakMap<string[], Set<string>>());
  const comparisonActive = () =>
    !!latest.current.compareTask &&
    ['RUNNING', 'CANCELLING'].includes(latest.current.compareTask.status);
  // 已知表清单且不含该表的目标库才算“缺失”；加载失败或未加载完成的目标不参与标注。
  const missingTargetsOf = (s: Model, name: string) =>
    s.targetKeys.filter((key) => {
      const tables = s.targetTables[key];
      if (!Array.isArray(tables)) return false;
      let names = targetTableSets.current.get(tables);
      if (!names) {
        names = new Set(tables);
        targetTableSets.current.set(tables, names);
      }
      return !names.has(name);
    });
  const compareSelection = (s: Model): CompareSelection => ({
    workspaceId: s.workspaceId,
    sourceKey: s.sourceKey,
    targetKeys: s.targetKeys,
    tables: s.scopeTables.map((table) => ({
      ...table,
      missingTargets: missingTargetsOf(s, table.name),
      ...(s.sourceKey.startsWith('pg:')
        ? {
            structureOptions: {
              ...effectiveOptions(table.structureOptions),
              columnOrder: false,
              tableCollation: false,
            },
          }
        : {}),
    })),
    structureDefaults: s.sourceKey.startsWith('pg:')
      ? { ...s.structureDefaults, columnOrder: false, tableCollation: false }
      : s.structureDefaults,
  });
  const selectionSignature = (selection: CompareSelection) => JSON.stringify(selection);
  const commit = useCallback((update: (current: Model) => Model) => {
    if (!mounted.current) return;
    const current = latest.current;
    const next = update(current);
    const newEntry = current.pageEntry !== next.pageEntry;
    if (current.page !== next.page || current.workspaceId !== next.workspaceId || newEntry) {
      requests.current.delete('navigation');
      if (!newEntry) {
        next.entering = undefined;
        next.entryError = undefined;
      }
    }
    if (
      current.recordRemarkId !== next.recordRemarkId ||
      current.page !== next.page ||
      newEntry ||
      current.workspaceId !== next.workspaceId
    )
      recordRemarkGeneration.current += 1;
    if (current.workspaceId !== next.workspaceId || current.page !== next.page || newEntry) {
      next.deleteRequest = undefined;
      next.recordRemarkId = '';
    }
    if (
      current.connectionDialog !== next.connectionDialog ||
      current.connectionForm.id !== next.connectionForm.id ||
      discoverySignature(current.connectionForm) !== discoverySignature(next.connectionForm)
    ) {
      next.connectionDiscovery = undefined;
      requests.current.delete('connectionDiscovery');
    }
    if (next.sourceKey && next.sourceKey !== current.sourceKey)
      next.syncDatabaseType = next.sourceKey.startsWith('pg:') ? 'postgresql' : 'mysql';
    if (current.page !== next.page || current.workspaceId !== next.workspaceId)
      next.openingTable = undefined;
    if (
      current.page !== next.page ||
      newEntry ||
      (current.page === 'history' &&
        (current.historyTab !== next.historyTab ||
          current.currentVersionId !== next.currentVersionId))
    ) {
      requests.current.delete('table');
      requests.current.delete('record');
    }
    if (current.page !== next.page || current.recordView !== next.recordView)
      requests.current.delete('rollback');
    if (
      current.workspaceId !== next.workspaceId ||
      (current.page === 'workspaces' && (next.page !== 'workspaces' || newEntry))
    ) {
      workspaceEditorGeneration.current += 1;
      next.workspaceDialog = false;
      next.workspaceForm = { id: '', name: '', description: '', connectionIds: [] };
    }
    if (
      current.connectionDialog &&
      (current.workspaceId !== next.workspaceId || current.page !== next.page || newEntry)
    ) {
      connectionEditorGeneration.current += 1;
      next.connectionDialog = false;
      next.connectionTest = undefined;
      next.connectionForm = emptyConnection(next.workspaceId);
      next.databasesText = '';
    }
    if (current.workspaceId !== next.workspaceId) {
      groupEditorGeneration.current += 1;
      next.groupDialog = false;
      next.groupForm = undefined;
      next.groupName = '';
    }
    if (
      current.workspaceId !== next.workspaceId ||
      (current.templateDialog && (current.page !== next.page || newEntry))
    ) {
      templateEditorGeneration.current += 1;
      requests.current.delete('templateScope');
      next.templateDialog = false;
      next.templateForm = { ...initialModel().templateForm, workspaceId: next.workspaceId };
      next.templateSource = '';
      next.templateTargets = [];
    }
    if (
      current.workspaceId !== next.workspaceId ||
      current.page !== next.page ||
      current.sourceKey !== next.sourceKey ||
      JSON.stringify(current.targetKeys) !== JSON.stringify(next.targetKeys)
    ) {
      for (const key of Object.keys(current.refreshResults)) {
        if (
          key.startsWith('targetTables:') ||
          ((current.workspaceId !== next.workspaceId || current.page !== next.page) &&
            (key.startsWith('table:') ||
              key.startsWith('recordScripts:') ||
              key.startsWith('rollback:')))
        ) {
          requests.current.delete('refresh:' + key);
          next.refreshResults = Object.fromEntries(
            Object.entries(next.refreshResults).filter(([id]) => id !== key),
          );
          next.refreshing = Object.fromEntries(
            Object.entries(next.refreshing).filter(([id]) => id !== key),
          );
        }
      }
    }
    if (current.page === 'export' && next.page !== 'export') {
      next.exportSql = '';
      next.exportPreview = undefined;
      next.exportGenerating = false;
      requests.current.delete('exportSQL');
      requests.current.delete('exportScope');
    }
    if (current.compareTask && ['RUNNING', 'CANCELLING'].includes(current.compareTask.status)) {
      for (const key of [
        'workspaceId',
        'sourceKey',
        'targetKeys',
        'scopeTables',
        'scopeDrafts',
        'scopeMode',
        'structureDefaults',
        'targetTables',
      ] as const)
        Object.assign(next, { [key]: current[key] });
    }
    if (
      (next.page === 'scope' && current.page !== next.page) ||
      current.sourceKey !== next.sourceKey ||
      JSON.stringify(current.targetKeys) !== JSON.stringify(next.targetKeys)
    )
      next.scopeView = current.scopeView + 1;
    const scopeChanged =
      current.workspaceId !== next.workspaceId ||
      current.sourceKey !== next.sourceKey ||
      current.targetKeys !== next.targetKeys ||
      current.scopeTables !== next.scopeTables ||
      current.structureDefaults !== next.structureDefaults;
    if (
      next.compareConfirmation &&
      (scopeChanged ||
        current.targetTables !== next.targetTables ||
        current.compareConfirmation !== next.compareConfirmation) &&
      selectionSignature(compareSelection(next)) !== selectionSignature(next.compareConfirmation)
    )
      next.compareConfirmation = undefined;
    if (
      next.appliedTemplate === current.appliedTemplate &&
      scopeChanged &&
      (next.workspaceId !== current.workspaceId ||
        next.sourceKey !== current.sourceKey ||
        JSON.stringify(next.targetKeys) !== JSON.stringify(current.targetKeys) ||
        JSON.stringify(next.scopeTables) !== JSON.stringify(current.scopeTables) ||
        JSON.stringify(next.structureDefaults) !== JSON.stringify(current.structureDefaults))
    )
      next.appliedTemplate = undefined;
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
    const entry = latest.current.pageEntry;
    const pageRequest =
      /^(navigation|record|recordScripts|recordScript:.*|file|rollback|table|exportSQL|exportScope|import|importFile|importTest:.*|applyTemplate|beginSync)$/.test(
        name,
      );
    return () =>
      mounted.current &&
      requests.current.get(name) === id &&
      (!pageRequest || latest.current.pageEntry === entry) &&
      latest.current.workspaceId === workspace;
  }
  async function action<T>(fn: () => Promise<T>, silent = false): Promise<T | undefined> {
    commit((s) => ({ ...s, busy: s.busy + 1 }));
    try {
      return await fn();
    } catch (e) {
      if (mounted.current && !silent)
        void message.error(e instanceof Error ? e.message : String(e));
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
      const state = normalizeOrganization(await api<State>('state.load'));
      if (!valid()) return;
      const unchangedTarget = ([key]: [string, unknown]) => {
        const id = fromKey(key).connectionId;
        return (
          state.connections.some((c) => c.id === id) &&
          connectionSignature(latest.current.state.connections.find((c) => c.id === id)) ===
            connectionSignature(state.connections.find((c) => c.id === id))
        );
      };
      for (const key of targetTableLoads.current.keys()) {
        if (!unchangedTarget([key, undefined])) {
          requests.current.delete('targetTables:' + key);
          targetTableLoads.current.delete(key);
        }
      }
      const previous = latest.current;
      const references = reconcileReferences(previous, state);
      const cleared =
        (previous.connectionForm.group && references.connectionForm?.group === '') ||
        previous.connectionForm.workspaceIds.length >
          (references.connectionForm?.workspaceIds.length || 0) ||
        previous.importWorkspaceIds.length > (references.importWorkspaceIds?.length || 0) ||
        (previous.sourceKey && references.sourceKey === '') ||
        (previous.templateSource && references.templateSource === '') ||
        (previous.exportSource && references.exportSource === '');
      if (cleared && previous.state.workspaces.length)
        void message.info('关联资源已删除或解除关联，失效选择已清空，其他草稿保留');
      if (previous.templateSource && references.templateSource === '')
        requests.current.delete('templateScope');
      if (previous.exportSource && references.exportSource === '') {
        requests.current.delete('exportScope');
        requests.current.delete('exportSQL');
      }
      commit((s) => ({
        ...s,
        state,
        targetTables: Object.fromEntries(Object.entries(s.targetTables).filter(unchangedTarget)),
        targetTablesLoading: Object.fromEntries(
          Object.entries(s.targetTablesLoading).filter(unchangedTarget),
        ),
        targetTablesErrors: Object.fromEntries(
          Object.entries(s.targetTablesErrors).filter(unchangedTarget),
        ),
        dbCache: Object.fromEntries(
          Object.entries(s.dbCache).filter(
            ([id]) =>
              connectionSignature(s.state.connections.find((c) => c.id === id)) ===
                connectionSignature(state.connections.find((c) => c.id === id)) &&
              state.connections.some((c) => c.id === id),
          ),
        ),
        schemaCache: Object.fromEntries(
          Object.entries(s.schemaCache).filter(([key]) => unchangedTarget([key, undefined])),
        ),
        treeChildren: Object.fromEntries(
          Object.entries(s.treeChildren).filter(([key]) =>
            state.connections.some(
              (c) =>
                connectionOwnsKey(key, c.id) &&
                connectionSignature(c) ===
                  connectionSignature(s.state.connections.find((old) => old.id === c.id)),
            ),
          ),
        ),
        connectionSelection: s.connectionSelection.filter((id) =>
          state.connections.some((c) => c.id === id),
        ),
        connectionTests: Object.fromEntries(
          Object.entries(s.connectionTests).filter(([key]) => {
            const id = key.startsWith('tree:') ? key.slice(5) : key;
            return (
              state.connections.some((c) => c.id === id) &&
              connectionSignature(s.state.connections.find((c) => c.id === id)) ===
                connectionSignature(state.connections.find((c) => c.id === id))
            );
          }),
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
            : state.connectionGroups.some((group) => group.name === s.connectionForm.group)
              ? s.connectionForm
              : { ...s.connectionForm, group: '' },
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
        scopeDrafts:
          s.sourceKey && !state.connections.some((c) => c.id === fromKey(s.sourceKey).connectionId)
            ? {}
            : s.scopeDrafts,
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
        ...reconcileReferences(s, state),
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
    requests.current.delete('navigation');
    requests.current.delete('table');
    requests.current.delete('record');
    const previous = latest.current.page;
    commit((s) => ({
      ...s,
      page,
      openingTable: undefined,
      entering: undefined,
      entryError: undefined,
    }));
    if (page === 'scope' && previous !== 'scope' && latest.current.sourceKey && !comparisonActive())
      void loadTargetTables(true);
    if (preview && page === 'import' && !latest.current.importRows.length) void loadImportExample();
  }
  /** 显式首次进入；继续编辑、后台刷新和表单入口不调用这里。 */
  async function enterPage(target: NavigationTarget) {
    if (latest.current.entering && !latest.current.entryError) return;
    const initial = initialModel();
    const before = latest.current;
    commit((s) => ({
      ...s,
      page: target.page,
      pageEntry: s.pageEntry + 1,
      entering: target,
      entryError: undefined,
      externalDrawer: false,
      versionDrawer: false,
      cleanupDrawer: false,
      groupDialog: false,
      moveConnectionId: '',
      compareConfirmation: undefined,
      applyingTemplateId: '',
      ...(target.page === 'history'
        ? {
            historyTab: target.tab || 'records',
            currentVersionId: target.versionId || '',
            historySearch: '',
            historyFilter: '',
            historySelection: [],
          }
        : {}),
      ...(target.page === 'connections' ? { connectionSearch: '', connectionSelection: [] } : {}),
      ...(target.page === 'record'
        ? { detail: undefined, recordScripts: {}, recordScriptErrors: {}, fileSql: '' }
        : {}),
      ...(target.page === 'rollback'
        ? { rollback: undefined, rollbackIds: [], rollbackRemark: '', rollbackSql: '' }
        : {}),
      ...(target.page === 'table' ? { currentTable: undefined, structureTab: 'columns' } : {}),
      ...(target.page === 'record' || target.page === 'rollback'
        ? { recordOrigin: target.origin }
        : {}),
      ...(target.page === 'import'
        ? {
            importText: '',
            importRows: [],
            importName: '',
            importFileToken: '',
            importFormat: initial.importFormat,
            importWorkspaceIds: [s.workspaceId],
            importGroup: initial.importGroup,
            duplicateMode: initial.duplicateMode,
          }
        : {}),
      ...(target.page === 'export'
        ? { includeDrop: false, exportSql: '', exportPreview: undefined, exportGenerating: false }
        : {}),
    }));
    const valid = request('navigation');
    try {
      await loadState();
      if (!valid()) return;
      const s = latest.current;
      if (s.engineError) throw new Error(s.engineError);
      if (target.page === 'scope') {
        if (before.compareTask && ['RUNNING', 'CANCELLING'].includes(before.compareTask.status))
          navigate('scope');
        else await beginSync();
      } else if (target.page === 'record') await openRecord(target.recordId, target.origin);
      else if (target.page === 'rollback') {
        if (
          !s.state.records.some((r) => r.id === target.recordId && r.workspaceId === s.workspaceId)
        )
          throw new Error('同步记录已不存在，请返回同步记录列表');
        set('recordOrigin', target.origin);
        const view = s.rollbackView;
        await beginRollback(target.recordId);
        if (valid() && latest.current.rollbackView === view)
          throw new Error('回滚预览加载失败，请重试');
      } else if (target.page === 'table') {
        const view = s.tableView;
        await openTable({
          key: '',
          type: 'table',
          title: target.table,
          ref: target.ref,
          table: target.table,
        });
        if (valid() && latest.current.tableView === view) throw new Error('表结构加载失败，请重试');
      } else if (target.page === 'diff') {
        if (!s.plan) throw new Error('当前差异计划已失效，请重新开始同步');
        const changes = s.plan.targets.flatMap((t) => t.changes);
        commit((v) => ({
          ...v,
          diffSearch: '',
          diffTab: s.plan!.tables.some((t) => t.structure) ? 'structure' : 'data',
          selectedIds: changes.filter((ch) => ch.selected && !ch.blocked).map((ch) => ch.id),
          currentChangeId: changes.find((ch) => !ch.blocked)?.id || '',
        }));
      } else if (target.page === 'settings') {
        commit((v) => ({ ...v, settingsForm: copyModel(v.state.settings), settingsDirty: false }));
      } else if (target.page === 'export') {
        const source = s.exportSource || s.sourceKey || dbOptions(s)[0]?.value || '';
        await loadExport(source);
      }
      // beginSync 的普通导航会使 navigation 令牌失效，但同一进入轮次仍可完成。
      if (latest.current.pageEntry === before.pageEntry + 1 && latest.current.page === target.page)
        commit((v) => ({ ...v, entering: undefined, entryError: undefined }));
    } catch (error) {
      if (valid()) set('entryError', error instanceof Error ? error.message : String(error));
    }
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
    resetSync();
    commit((s) => ({
      ...s,
      workspaceId: id,
      page: 'scope',
      sourceKey: '',
      targetKeys: [],
      scopeTables: [],
      scopeDrafts: {},
      tableSearch: '',
      scopeTableFilter: 'all',
      scopeMode: 'structure',
      plan: undefined,
      selectedIds: [],
      currentChangeId: '',
      detail: undefined,
      rollback: undefined,
      currentTable: undefined,
      dbCache: {},
      dbLoading: {},
      dbErrors: {},
      refreshing: Object.fromEntries(
        [...refreshPending.current]
          .filter((key) => key.startsWith(id + '/'))
          .map((key) => key.slice(id.length + 1))
          .filter((key) => key.startsWith('connection:') || key.startsWith('database:'))
          .map((key) => [key, true]),
      ),
      refreshResults: {},
      scopeTemplateId: '',
      applyingTemplateId: '',
      appliedTemplate: undefined,
      templateApplyError: '',
      connectionSelection: [],
      connectionTest: undefined,
      connectionTests: Object.fromEntries(
        [...treeTestsPending.current]
          .filter(([key]) => key.startsWith(id + '/'))
          .map(([key, result]) => [key.slice(id.length + 1), result]),
      ),
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
  async function loadDatabaseOptions(
    force = false,
    onlyId?: string,
    databaseType?: 'mysql' | 'postgresql',
  ) {
    const s = latest.current;
    const connections = s.state.connections.filter(
      (c) =>
        c.workspaceIds.includes(s.workspaceId) &&
        (!onlyId || c.id === onlyId) &&
        (!databaseType || (c.databaseType || 'mysql') === databaseType),
    );
    await Promise.all(
      connections.map(async (connection) => {
        const id = connection.id;
        if (!force && latest.current.dbCache[id] !== undefined) return;
        const signature = connectionSignature(connection);
        const pending = databaseLoads.current.get(id);
        if (pending && pending.signature === signature && pending.workspace === s.workspaceId)
          return pending.promise;
        const valid = request('databases:' + id);
        const current = () =>
          valid() &&
          connectionSignature(latest.current.state.connections.find((c) => c.id === id)) ===
            signature;
        commit((v) => ({
          ...v,
          dbLoading: { ...v.dbLoading, [id]: true },
          dbErrors: { ...v.dbErrors, [id]: '' },
        }));
        const loading = (async () => {
          try {
            const databases = await api<string[]>('databases.list', { connectionId: id });
            const schemaEntries =
              connection.databaseType === 'postgresql'
                ? await Promise.all(
                    databases.map(
                      async (database) =>
                        [
                          refKey({ connectionId: id, database }),
                          await api<string[]>('schemas.list', {
                            ref: { connectionId: id, database },
                          }),
                        ] as const,
                    ),
                  )
                : [];
            if (current())
              commit((v) => ({
                ...v,
                dbCache: { ...v.dbCache, [id]: databases },
                schemaCache: { ...v.schemaCache, ...Object.fromEntries(schemaEntries) },
              }));
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
  async function loadTree(node: TreeNode, force = false) {
    if (!['connection', 'database', 'schema'].includes(node.type)) return;
    const connectionId = node.connectionId || node.ref?.connectionId;
    const signature = connectionSignature(
      latest.current.state.connections.find((connection) => connection.id === connectionId),
    );
    const requestValid = request('tree:' + node.key);
    const valid = () =>
      requestValid() &&
      connectionSignature(
        latest.current.state.connections.find((connection) => connection.id === connectionId),
      ) === signature;
    if (force) {
      for (const key of requests.current.keys()) {
        if (key.startsWith('tree:' + node.key + '/')) requests.current.delete(key);
      }
      commit((s) => ({
        ...s,
        treeChildren: Object.fromEntries(
          Object.entries(s.treeChildren).filter(
            ([key]) => key !== node.key && !key.startsWith(node.key + '/'),
          ),
        ),
      }));
    }
    await action(async () => {
      let children: TreeNode[];
      if (node.type === 'connection') {
        const databases =
          (!force ? latest.current.dbCache[node.connectionId!] : undefined) ??
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
      } else if (
        node.type === 'database' &&
        latest.current.state.connections.find((c) => c.id === connectionId)?.databaseType ===
          'postgresql'
      ) {
        const schemas = await api<string[]>('schemas.list', { ref: node.ref });
        if (!valid()) return;
        children = schemas.map((schema) => ({
          key: refKey({ ...node.ref!, schema }),
          title: schema,
          type: 'schema',
          ref: { ...node.ref!, schema },
          isLeaf: false,
        }));
        commit((s) => ({
          ...s,
          schemaCache: { ...s.schemaCache, [refKey(node.ref!)]: schemas },
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
    const viewValid = request('table');
    const modelValid = request('table:' + id);
    const valid = () => viewValid() && modelValid();
    set(
      'openingTable',
      node.ref.database + (node.ref.schema ? '/' + node.ref.schema : '') + '/' + node.table,
    );
    try {
      await action(async () => {
        const model = await api<Table>('table.get', { ref: node.ref, table: node.table });
        const tab = { id, ref: node.ref!, table: node.table!, model };
        if (
          valid() &&
          latest.current.state.connections.some(
            (connection) =>
              connection.id === node.ref!.connectionId &&
              connection.workspaceIds.includes(latest.current.workspaceId),
          )
        )
          commit((s) => ({
            ...s,
            currentTable: tab,
            tableView: s.tableView + 1,
            page: 'table',
            openingTable: undefined,
          }));
      });
    } finally {
      if (viewValid()) set('openingTable', undefined);
    }
  }
  const clearRefresh = useCallback(
    (key: string) => {
      requests.current.delete('refresh:' + key);
      commit((s) => ({
        ...s,
        refreshResults: Object.fromEntries(
          Object.entries(s.refreshResults).filter(([id]) => id !== key),
        ),
        refreshing: Object.fromEntries(Object.entries(s.refreshing).filter(([id]) => id !== key)),
      }));
    },
    [commit],
  );
  async function runRefresh(
    key: string,
    label: string,
    work: () => Promise<boolean | void>,
  ): Promise<ConnectionTestResult | undefined> {
    const workspace = latest.current.workspaceId;
    const pendingKey = workspace + '/' + key;
    if (refreshPending.current.has(pendingKey)) return;
    refreshPending.current.add(pendingKey);
    const valid = request('refresh:' + key);
    const startedAt = Date.now();
    const showLoading = () =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, 300 - (Date.now() - startedAt))),
      );
    commit((s) => ({
      ...s,
      refreshing: { ...s.refreshing, [key]: true },
      refreshResults: { ...s.refreshResults, [key]: { status: 'testing', message: `${label}中` } },
    }));
    try {
      const completed = await work();
      await showLoading();
      if (valid())
        commit((s) => ({
          ...s,
          refreshResults:
            completed === false
              ? Object.fromEntries(Object.entries(s.refreshResults).filter(([id]) => id !== key))
              : { ...s.refreshResults, [key]: { status: 'success', message: `${label}成功` } },
        }));
    } catch (error) {
      await showLoading();
      if (valid())
        commit((s) => ({
          ...s,
          refreshResults: {
            ...s.refreshResults,
            [key]: {
              status: 'error',
              message: `${label}失败：${error instanceof Error ? error.message : String(error)}`,
            },
          },
        }));
    } finally {
      refreshPending.current.delete(pendingKey);
      if (valid()) commit((s) => ({ ...s, refreshing: { ...s.refreshing, [key]: false } }));
      else if (
        latest.current.workspaceId === workspace &&
        (key.startsWith('connection:') || key.startsWith('database:'))
      )
        commit((s) => ({ ...s, refreshing: { ...s.refreshing, [key]: false } }));
    }
    return valid() ? latest.current.refreshResults[key] : undefined;
  }
  function databaseOptionsType(
    scope: string,
    s = latest.current,
  ): Model['syncDatabaseType'] | undefined {
    if (scope === 'sync') return s.syncDatabaseType;
    const source =
      scope === 'template' ? s.templateSource : scope === 'export' ? s.exportSource : '';
    return source ? (source.startsWith('pg:') ? 'postgresql' : 'mysql') : undefined;
  }
  async function refreshDatabaseOptions(feedbackKey: string) {
    const s = latest.current;
    const scope = feedbackKey.split(':', 1)[0];
    const databaseType = databaseOptionsType(scope, s);
    const ids = s.state.connections
      .filter(
        (c) =>
          c.workspaceIds.includes(s.workspaceId) &&
          (!databaseType || (c.databaseType || 'mysql') === databaseType),
      )
      .map((c) => c.id);
    if (!ids.length) return;
    return await runRefresh(feedbackKey, '刷新数据库', async () => {
      await loadDatabaseOptions(true, undefined, databaseType);
      if (
        latest.current.workspaceId !== s.workspaceId ||
        databaseOptionsType(scope) !== databaseType
      )
        return false;
      const errors = ids.map((id) => latest.current.dbErrors[id]).filter(Boolean);
      if (errors.length) throw new Error(errors.join('；'));
    });
  }
  async function refreshTargetTables(entry = 'main') {
    const s = latest.current;
    if (!s.targetKeys.length || comparisonActive()) return;
    await runRefresh(targetRefreshKey(s, entry), '刷新目标表清单', async () => {
      await loadTargetTables(true);
      if (
        latest.current.workspaceId !== s.workspaceId ||
        latest.current.sourceKey !== s.sourceKey ||
        JSON.stringify(latest.current.targetKeys) !== JSON.stringify(s.targetKeys)
      )
        return false;
      const errors = s.targetKeys
        .map((key) => latest.current.targetTablesErrors[key])
        .filter(Boolean);
      if (errors.length) throw new Error(errors.join('；'));
    });
  }
  async function refreshEngine() {
    await runRefresh('engine', '连接引擎', async () => {
      await loadState();
      if (latest.current.engineError) throw new Error(latest.current.engineError);
    });
  }
  async function refreshTable() {
    const tab = latest.current.currentTable;
    if (!tab) return;
    const valid = request('table:' + tab.id);
    await runRefresh(tableRefreshKey(latest.current), '刷新表结构', async () => {
      const model = await api<Table>('table.get', { ref: tab.ref, table: tab.table });
      if (valid() && latest.current.currentTable?.id === tab.id)
        commit((s) => ({
          ...s,
          currentTable: { ...tab, model },
        }));
      else return false;
    });
  }
  async function refreshDatabase(node: TreeNode) {
    if (node.type !== 'database' || !node.ref) return;
    const ref = copyModel(node.ref);
    const key = refKey(ref);
    const workspace = latest.current.workspaceId;
    const signature = connectionSignature(
      latest.current.state.connections.find((connection) => connection.id === ref.connectionId),
    );
    return await runRefresh('database:' + key, `刷新 ${ref.database} 数据表`, async () => {
      // Replace an older lazy load's request token so its late result cannot restore deleted tables.
      const requestValid = request('tree:' + key);
      const valid = () =>
        requestValid() &&
        latest.current.workspaceId === workspace &&
        connectionSignature(
          latest.current.state.connections.find((connection) => connection.id === ref.connectionId),
        ) === signature;
      const tab = latest.current.currentTable;
      const sameDatabase = tab && refKey(tab.ref) === key;
      const tableValid = sameDatabase ? request('table:' + tab.id) : undefined;
      try {
        const tables = await api<{ name: string; comment: string }[]>('tables.list', { ref });
        if (!valid()) return false;
        const exists = sameDatabase && tables.some((table) => table.name === tab.table);
        const model =
          exists && tableValid?.() && latest.current.currentTable?.id === tab.id
            ? await api<Table>('table.get', { ref, table: tab.table })
            : undefined;
        if (!valid()) return false;
        commit((s) => {
          const updateTable = sameDatabase && tableValid?.() && s.currentTable?.id === tab.id;
          return {
            ...s,
            treeChildren: {
              ...s.treeChildren,
              [key]: tables.map((table) => ({
                key: `${key}/${table.name}`,
                title: table.name,
                type: 'table',
                table: table.name,
                ref,
                isLeaf: true,
              })),
            },
            ...(updateTable && !exists
              ? { currentTable: undefined, page: s.page === 'table' ? 'connections' : s.page }
              : updateTable && model
                ? { currentTable: { ...tab, model } }
                : {}),
          };
        });
      } catch (error) {
        if (!valid()) return false;
        throw error;
      }
    });
  }
  async function loadScope(
    source = latest.current.sourceKey,
    preselect?: string,
    mode: 'structure' | 'data' = latest.current.scopeMode,
  ) {
    requests.current.delete('beginSync');
    commit((s) => ({
      ...s,
      sourceKey: source,
      syncDatabaseType: source
        ? source.startsWith('pg:')
          ? 'postgresql'
          : 'mysql'
        : s.syncDatabaseType,
      scopeTables: [],
      scopeDrafts: {},
      tableSearch: '',
      scopeTableFilter: 'all',
      scopeMode: mode,
      refreshResults: Object.fromEntries(
        Object.entries(s.refreshResults).filter(([key]) => !key.startsWith('targetTables:')),
      ),
    }));
    const valid = request('scope');
    if (!source) return false;
    return await action(async () => {
      const rows = await api<{ name: string; comment: string }[]>('tables.list', {
        ref: fromKey(source),
      });
      if (!valid() || latest.current.sourceKey !== source) return false;
      commit((s) => {
        const tables = rows.map((t) => ({
          ...t,
          structure: !!preselect && t.name === preselect && mode === 'structure',
          data: !!preselect && t.name === preselect && mode === 'data',
          keyColumns: [],
          keyText: '',
          structureOptions: { ...s.structureDefaults },
        }));
        return scopeForMode(
          {
            ...s,
            scopeMode: mode,
            scopeTables: tables,
            scopeDrafts: {},
            targetKeys: s.targetKeys.filter(
              (k) => k !== source && k.startsWith('pg:') === source.startsWith('pg:'),
            ),
          },
          s.scopeMode,
        );
      });
      await loadTargetTables();
      return true;
    });
  }
  async function loadTargetTables(force = false) {
    if (comparisonActive()) return;
    const s = latest.current;
    await Promise.all(
      s.targetKeys.map(async (key) => {
        const ref = fromKey(key);
        const connection = s.state.connections.find((item) => item.id === ref?.connectionId);
        const signature = connectionSignature(connection) + '/' + (ref?.database || '');
        const pending = targetTableLoads.current.get(key);
        if (pending?.signature === signature) return pending.promise;
        if (!force && s.targetTables[key] && !s.targetTablesErrors[key]) return;
        const valid = request('targetTables:' + key);
        const current = () =>
          valid() &&
          latest.current.workspaceId === s.workspaceId &&
          latest.current.targetKeys.includes(key) &&
          connectionSignature(
            latest.current.state.connections.find((item) => item.id === ref.connectionId),
          ) +
            '/' +
            ref.database ===
            signature;
        commit((v) => ({
          ...v,
          targetTables: Object.fromEntries(
            Object.entries(v.targetTables).filter(([id]) => id !== key),
          ),
          targetTablesLoading: { ...v.targetTablesLoading, [key]: true },
          targetTablesErrors: { ...v.targetTablesErrors, [key]: '' },
        }));
        let loading!: Promise<void>;
        loading = (async () => {
          try {
            const rows = await api<{ name: string }[]>('tables.list', { ref });
            if (current()) {
              commit((v) => ({
                ...v,
                targetTables: { ...v.targetTables, [key]: rows.map((row) => row.name) },
                targetTablesLoading: { ...v.targetTablesLoading, [key]: false },
              }));
            }
          } catch (error) {
            if (current())
              commit((v) => ({
                ...v,
                targetTablesLoading: { ...v.targetTablesLoading, [key]: false },
                targetTablesErrors: {
                  ...v.targetTablesErrors,
                  [key]: error instanceof Error ? error.message : String(error),
                },
              }));
          } finally {
            if (targetTableLoads.current.get(key)?.promise === loading)
              targetTableLoads.current.delete(key);
          }
        })();
        targetTableLoads.current.set(key, { signature, promise: loading });
        await loading;
      }),
    );
  }
  function switchDatabaseType(databaseType: 'mysql' | 'postgresql') {
    if (comparisonActive() || latest.current.syncDatabaseType === databaseType) return;
    requests.current.delete('scope');
    commit((s) => ({
      ...s,
      syncDatabaseType: databaseType,
      sourceKey: '',
      targetKeys: [],
      scopeTables: [],
      scopeDrafts: {},
      plan: undefined,
      selectedIds: [],
      tableSearch: '',
      scopeTableFilter: 'all',
    }));
  }
  async function setTargets(keys: string[]) {
    if (comparisonActive()) return;
    if (JSON.stringify(keys) !== JSON.stringify(latest.current.targetKeys)) {
      for (const key of latest.current.targetKeys)
        if (!keys.includes(key)) {
          requests.current.delete('targetTables:' + key);
          targetTableLoads.current.delete(key);
        }
    }
    set('targetKeys', keys);
    await loadTargetTables();
  }
  function resetSync() {
    for (const key of ['scope', 'beginSync', 'templateScope', 'applyTemplate'])
      requests.current.delete(key);
    targetTableLoads.current.clear();
    for (const key of requests.current.keys())
      if (
        key.startsWith('targetTables:') ||
        key.startsWith('refresh:targetTables:') ||
        key.startsWith('refresh:sync:databases:')
      )
        requests.current.delete(key);
    const initial = initialModel();
    commit((s) => ({
      ...s,
      scopeView: s.scopeView + 1,
      sourceKey: '',
      targetKeys: [],
      targetTables: {},
      targetTablesLoading: {},
      targetTablesErrors: {},
      scopeTables: [],
      scopeDrafts: {},
      scopeMode: 'structure',
      syncDatabaseType: initial.syncDatabaseType,
      structureDefaults: initial.structureDefaults,
      tableSearch: '',
      scopeTableFilter: 'all',
      scopeRemark: '',
      scopeTemplateId: '',
      applyingTemplateId: '',
      appliedTemplate: undefined,
      templateApplyError: '',
      refreshing: Object.fromEntries(
        Object.entries(s.refreshing).filter(
          ([key]) => !key.startsWith('targetTables:') && !key.startsWith('sync:databases:'),
        ),
      ),
      refreshResults: Object.fromEntries(
        Object.entries(s.refreshResults).filter(
          ([key]) => !key.startsWith('targetTables:') && !key.startsWith('sync:databases:'),
        ),
      ),
      plan: undefined,
      selectedIds: [],
      currentChangeId: '',
      diffSearch: '',
      diffTab: 'structure',
      compareConfirmation: undefined,
      compareScope: undefined,
      compareTask: undefined,
      compareStartedAt: 0,
      compareFinishedAt: 0,
      compareTransportError: '',
    }));
  }
  async function beginSync(node?: TreeNode, mode: 'structure' | 'data' = 'structure') {
    if (comparisonActive()) {
      if (!node) navigate('scope');
      return;
    }
    resetSync();
    navigate('scope');
    if (!node?.ref) return;
    const valid = request('beginSync');
    await loadDatabaseOptions();
    if (!valid() || latest.current.page !== 'scope') return;
    const source = refKey(node.ref);
    if (source) await loadScope(source, node?.table, mode);
  }
  function setScopeMode(mode: SyncMode) {
    if (comparisonActive()) return;
    commit((s) => scopeForMode(s, mode));
  }
  function toggleScope(type: SyncMode) {
    if (comparisonActive()) return;
    commit((current) => {
      const s = scopeForMode(current, type);
      const matches = (table: ScopeTable) =>
        scopeTableMatches(table, s.tableSearch) && (s.scopeTableFilter === 'all' || table[type]);
      const visible = s.scopeTables.filter(matches);
      if (!visible.length) return s;
      const selected = s.scopeMode !== type || !visible.every((table) => table[type]);
      return {
        ...s,
        scopeMode: type,
        scopeTables: s.scopeTables.map((table) =>
          matches(table) ? { ...table, [type]: selected } : table,
        ),
      };
    });
  }
  function updateScope(name: string, fields: Partial<ScopeTable>) {
    if (comparisonActive()) return;
    const mode = fields.data ? 'data' : fields.structure ? 'structure' : latest.current.scopeMode;
    commit((current) => {
      const s = scopeForMode(current, mode);
      return {
        ...s,
        scopeTables: s.scopeTables.map((t) =>
          t.name === name
            ? { ...t, ...fields, [mode === 'data' ? 'structure' : 'data']: false }
            : t,
        ),
      };
    });
  }
  const choices = (tables: TableChoice[], sourceKey = latest.current.sourceKey) =>
    tables
      .filter((t) => t.structure || t.data)
      .map((t) => ({
        name: t.name,
        structure: t.structure,
        data: t.data,
        keyColumns: t.keyText === undefined ? t.keyColumns : splitKeys(t.keyText),
        structureOptions: {
          ...effectiveOptions(t.structureOptions),
          ...(sourceKey.startsWith('pg:') ? { columnOrder: false, tableCollation: false } : {}),
        },
      }));
  async function compare() {
    if (comparisonActive() || latest.current.compareConfirmation || compareStarting.current) return;
    const s = latest.current;
    if (!s.sourceKey || !s.targetKeys.length || !choices(s.scopeTables).length) return;
    const typeOf = (key: string) =>
      s.state.connections.find((connection) => connection.id === fromKey(key).connectionId)
        ?.databaseType || 'mysql';
    if (s.targetKeys.some((key) => typeOf(key) !== typeOf(s.sourceKey))) {
      void message.warning('仅支持同类型数据库同步');
      return;
    }
    if (mixedSyncModes(s.scopeTables)) {
      void message.warning('每次只能同步结构或数据，请选择一种同步类型');
      return;
    }
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
      compareScope: copyModel(pending),
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
    const selectedIds = new Set(s.selectedIds);
    for (const target of s.plan.targets) {
      const selected = target.changes.filter((change) => selectedIds.has(change.id));
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
    set('syncSubmitting', mode);
    try {
      if (mode === 'EXECUTE_AND_SAVE' || mode === 'SAVE_ONLY') {
        const accepted = await modal.confirm({
          title:
            mode === 'SAVE_ONLY'
              ? '预览并保存同步脚本'
              : preview
                ? '确认模拟同步（不会连接数据库）'
                : '确认执行同步',
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
          okText: mode === 'SAVE_ONLY' ? '确认保存' : preview ? '确认模拟执行' : '确认执行',
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
        if (samePageSession(s)) await openRecord(r.id);
        void message.success(
          mode === 'SAVE_ONLY'
            ? '同步记录和脚本已保存，目标库未变更'
            : preview
              ? '虚构模拟已完成，未连接真实数据库'
              : '任务已创建，正在准备恢复资料',
        );
      });
    } finally {
      syncSubmitPending.current = false;
      set('syncSubmitting', undefined);
    }
  }
  function editWorkspace(w?: Workspace) {
    workspaceEditorGeneration.current += 1;
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
    set('workspaceDialog', true);
  }
  function closeWorkspace() {
    workspaceEditorGeneration.current += 1;
    commit((s) => ({
      ...s,
      workspaceDialog: false,
      workspaceForm: { id: '', name: '', description: '', connectionIds: [] },
    }));
  }
  async function saveWorkspace() {
    if (workspaceSaving.current) return;
    workspaceSaving.current = true;
    const s = latest.current;
    const generation = workspaceEditorGeneration.current;
    const form = { ...copyModel(s.workspaceForm), id: s.workspaceForm.id || crypto.randomUUID() };
    set('workspaceSubmitting', true);
    try {
      await action(async () => {
        if (!form.name.trim()) throw new Error('请输入工作区名称');
        await api('entity.save', { kind: 'workspace', value: form });
        if (latest.current.workspaceForm === s.workspaceForm)
          patch('workspaceForm', { id: form.id });
        await loadState();
        if (
          generation === workspaceEditorGeneration.current &&
          latest.current.workspaceId === s.workspaceId
        )
          closeWorkspace();
        void message.success('工作区已保存');
      });
    } finally {
      workspaceSaving.current = false;
      set('workspaceSubmitting', false);
    }
  }
  function editConnection(c?: ConnectionInfo, group?: string) {
    connectionEditorGeneration.current += 1;
    const form = c
      ? { ...copyModel(c), password: '', certificatePassword: '' }
      : {
          ...emptyConnection(latest.current.workspaceId),
          id: crypto.randomUUID(),
          group:
            latest.current.state.connectionGroups.find((value) => value.name === group)?.name ||
            latest.current.state.connectionGroups[0]?.name ||
            '',
        };
    commit((s) => ({
      ...s,
      connectionForm: form,
      connectionTest: undefined,
      connectionDialog: true,
      databasesText: form.databases.join(', '),
    }));
  }
  function closeConnection() {
    connectionEditorGeneration.current += 1;
    commit((s) => ({
      ...s,
      connectionDialog: false,
      connectionForm: emptyConnection(s.workspaceId),
      connectionTest: undefined,
      databasesText: '',
    }));
  }
  function editGroup(group?: ConnectionGroup) {
    groupEditorGeneration.current += 1;
    commit((s) => ({
      ...s,
      groupDialog: true,
      groupForm: group && { ...group },
      groupName: group?.name || '',
    }));
  }
  function closeGroup() {
    groupEditorGeneration.current += 1;
    commit((s) => ({ ...s, groupDialog: false, groupForm: undefined, groupName: '' }));
  }
  async function saveGroup() {
    if (groupSaving.current) return;
    groupSaving.current = true;
    const s = latest.current;
    const generation = groupEditorGeneration.current;
    const name = s.groupName.trim();
    set('groupSubmitting', true);
    try {
      await action(async () => {
        if (!name) throw new Error('请输入分组名称');
        const group = await api<ConnectionGroup>('connectionGroups.save', {
          id: s.groupForm?.id,
          name,
        });
        commit((v) => ({
          ...v,
          ...(generation === groupEditorGeneration.current && v.workspaceId === s.workspaceId
            ? { groupDialog: false, groupForm: undefined, groupName: '' }
            : {}),
        }));
        await loadState();
        void message.success('分组已保存');
      });
    } finally {
      groupSaving.current = false;
      set('groupSubmitting', false);
    }
  }
  async function addConnectionGroup(name: string) {
    if (groupSaving.current || !name.trim()) return false;
    groupSaving.current = true;
    const s = latest.current;
    const generation = connectionEditorGeneration.current;
    try {
      return !!(await action(async () => {
        const group = await api<ConnectionGroup>('connectionGroups.save', { name: name.trim() });
        await loadState();
        if (
          generation === connectionEditorGeneration.current &&
          latest.current.connectionDialog &&
          latest.current.connectionForm.id === s.connectionForm.id &&
          latest.current.connectionForm.group === s.connectionForm.group
        )
          patch('connectionForm', { group: group.name });
        return true;
      }));
    } finally {
      groupSaving.current = false;
    }
  }
  async function removeGroup(groupId: string) {
    if (groupDeleting.current || latest.current.organizationSaving) return;
    const group = latest.current.state.connectionGroups.find((value) => value.id === groupId);
    if (!group) return;
    if (
      latest.current.state.connections.some((value) => connectionGroupName(value) === group.name)
    ) {
      void message.error('该分组仍有连接，请先将连接移到其他分组');
      return;
    }
    groupDeleting.current = true;
    try {
      return await modal.confirm({
        title: '删除分组',
        content: `确认删除空分组“${group.name}”？此操作仅删除分组配置。`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          set('organizationSaving', true);
          try {
            await api('connectionGroups.delete', { groupId });
            await loadState();
            void message.success('分组已删除');
          } catch (error) {
            void message.error(error instanceof Error ? error.message : String(error));
            throw error;
          } finally {
            set('organizationSaving', false);
          }
        },
      });
    } finally {
      groupDeleting.current = false;
    }
  }
  function chooseConnectionGroup(connection: ConnectionInfo) {
    const group = latest.current.state.connectionGroups.find((g) => g.name === connection.group);
    commit((s) => ({ ...s, moveConnectionId: connection.id, moveGroupId: group?.id || '' }));
  }
  async function moveConnection(
    connectionId: string,
    groupId: string,
    placement: 'before' | 'after' | 'last',
    anchorConnectionId?: string,
    silent = false,
  ) {
    if (latest.current.organizationSaving) return;
    set('organizationSaving', true);
    try {
      await action(async () => {
        await api('connections.move', { connectionId, groupId, placement, anchorConnectionId });
        set('moveConnectionId', '');
        await loadState();
        if (!silent) void message.success('连接分组与顺序已保存');
      }, silent);
    } finally {
      set('organizationSaving', false);
    }
  }
  async function moveGroup(groupId: string, anchorGroupId: string, placement: 'before' | 'after') {
    if (latest.current.organizationSaving) return;
    set('organizationSaving', true);
    try {
      await action(async () => {
        await api('connectionGroups.move', { groupId, anchorGroupId, placement });
        await loadState();
      });
    } finally {
      set('organizationSaving', false);
    }
  }
  async function saveConnection() {
    const s = latest.current;
    const generation = connectionEditorGeneration.current;
    const form = {
      ...copyModel(s.connectionForm),
      id: s.connectionForm.id || crypto.randomUUID(),
      databases: splitKeys(s.databasesText),
    };
    await action(async () => {
      if (!form.name.trim() || !form.host.trim() || !form.user.trim() || !form.workspaceIds.length)
        throw new Error('请填写连接名称、服务器、用户并选择工作区');
      const validation = connectionSaveError(
        form,
        !!s.state.connections.find((item) => item.id === form.id)?.hasPassword,
      );
      if (validation) throw new Error(validation);
      if (!latest.current.state.connectionGroups.some((group) => group.name === form.group))
        throw new Error('请选择现有连接分组，或先新增分组');
      await api('entity.save', {
        kind: 'connection',
        value: form,
        groupId: latest.current.state.connectionGroups.find((group) => group.name === form.group)!
          .id,
      });
      if (
        generation === connectionEditorGeneration.current &&
        JSON.stringify(latest.current.connectionForm) === JSON.stringify(s.connectionForm) &&
        latest.current.databasesText === s.databasesText
      )
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
          Object.entries(v.treeChildren).filter(([key]) => !connectionOwnsKey(key, form.id)),
        ),
      }));
      await loadState();
      void message.success('连接已保存');
    });
  }
  async function discoverConnection(verify = true) {
    const s = latest.current;
    const generation = connectionEditorGeneration.current;
    const config = { ...copyModel(s.connectionForm), databases: splitKeys(s.databasesText) };
    if (!s.connectionDialog || connectionTestError(config) || !config.workspaceIds.length) return;
    const signature = discoverySignature(config);
    const requestValid = request('connectionDiscovery');
    const valid = () =>
      requestValid() &&
      latest.current.connectionDialog &&
      generation === connectionEditorGeneration.current &&
      latest.current.connectionForm.id === config.id &&
      discoverySignature(latest.current.connectionForm) === signature;
    set('connectionDiscovery', { status: 'loading', databases: [] });
    try {
      if (verify) await api('connections.test', { id: config.id, config });
      if (!valid()) return;
      const databases = await api<string[]>('databases.list', { config });
      if (valid()) set('connectionDiscovery', { status: 'success', databases });
    } catch (error) {
      if (valid())
        set('connectionDiscovery', {
          status: 'error',
          databases: [],
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }
  useEffect(() => {
    if (
      m.connectionDialog &&
      m.state.connections.some((connection) => connection.id === m.connectionForm.id)
    )
      void discoverConnection();
  }, [m.connectionDialog, m.connectionForm.id]);
  async function testConnection(
    connection?: ConnectionInfo,
    entry: 'list' | 'tree' = 'list',
  ): Promise<ConnectionTestResult | undefined> {
    const s = latest.current;
    const testKey = connection ? (entry === 'tree' ? 'tree:' + connection.id : connection.id) : '';
    const startedAt = Date.now();
    const previous = connection ? s.connectionTests[testKey] : s.connectionTest;
    const pendingKey = s.workspaceId + '/' + testKey;
    if (previous?.status === 'testing' || treeTestsPending.current.has(pendingKey)) return;
    const config = connection
      ? { ...connection }
      : { ...s.connectionForm, databases: splitKeys(s.databasesText) };
    const valid = request(connection ? 'connectionTest:' + testKey : 'connectionTest:form');
    const testing = { status: 'testing' as const, message: '正在测试连接' };
    if (connection && entry === 'tree') treeTestsPending.current.set(pendingKey, testing);
    commit((v) =>
      connection
        ? { ...v, connectionTests: { ...v.connectionTests, [testKey]: testing } }
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
    if (entry === 'tree')
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, 300 - (Date.now() - startedAt))),
      );
    if (connection && entry === 'tree') treeTestsPending.current.delete(pendingKey);
    if (!valid()) {
      if (
        connection &&
        entry === 'tree' &&
        latest.current.workspaceId === s.workspaceId &&
        latest.current.connectionTests[testKey] === testing
      )
        commit((v) => ({
          ...v,
          connectionTests: Object.fromEntries(
            Object.entries(v.connectionTests).filter(([key]) => key !== testKey),
          ),
        }));
      return;
    }
    const current = latest.current;
    if (connection) {
      if (
        current.connectionTests[testKey] !== testing ||
        JSON.stringify(current.state.connections.find((c) => c.id === connection.id)) !==
          JSON.stringify(connection)
      )
        return;
      commit((v) => ({ ...v, connectionTests: { ...v.connectionTests, [testKey]: result } }));
      return result;
    } else if (
      current.connectionTest === testing &&
      current.connectionForm.id === s.connectionForm.id &&
      discoverySignature(current.connectionForm) === discoverySignature(s.connectionForm) &&
      current.databasesText === s.databasesText
    ) {
      commit((v) => ({ ...v, connectionTest: result }));
      if (result.status === 'success') await discoverConnection(false);
      return result;
    }
  }
  async function chooseCertificate(field: 'ca' | 'clientCert') {
    const id = latest.current.connectionForm.id;
    const path = await action(() => api<string | null>('files.chooseCertificate'));
    if (path && latest.current.connectionForm.id === id) patch('connectionForm', { [field]: path });
  }
  async function removeEntity(kind: string, id: string) {
    if (kind === 'connection') return removeConnections([id]);
    if (kind === 'workspace') {
      const counts = workspaceContents(latest.current.state, id);
      if (Object.values(counts).some(Boolean)) {
        void message.error(
          `工作区仍有 ${counts.connections} 个连接、${counts.templates} 个模板、${counts.records} 条记录、${counts.versions} 个版本，请先处理关联内容`,
        );
        return;
      }
      if (latest.current.state.workspaces.length <= 1) {
        void message.error('至少保留一个工作区');
        return;
      }
    }
    const workspaceGeneration = workspaceEditorGeneration.current;
    const templateGeneration = templateEditorGeneration.current;
    if (!(await confirm('删除配置', '确认删除这项配置？已有同步记录会保留。', '删除'))) return;
    await action(async () => {
      await api('entity.delete', { kind, id });
      await loadState();
      if (
        kind === 'workspace' &&
        workspaceGeneration === workspaceEditorGeneration.current &&
        latest.current.workspaceForm.id === id
      )
        closeWorkspace();
      if (
        kind === 'template' &&
        templateGeneration === templateEditorGeneration.current &&
        latest.current.templateForm.id === id
      )
        closeTemplate();
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
    const workspace = latest.current.workspaceId;
    const connection = latest.current.state.connections.find((c) => c.id === id);
    if (!connection) return;
    const signature = connectionSignature(connection);
    return await runRefresh('connection:' + id, `刷新 ${connection.name} 数据库`, async () => {
      for (const key of requests.current.keys())
        if (key === 'tree:' + id || key.startsWith('tree:' + id + '/'))
          requests.current.delete(key);
      commit((s) => ({
        ...s,
        treeChildren: Object.fromEntries(
          Object.entries(s.treeChildren).filter(([key]) => !connectionOwnsKey(key, id)),
        ),
      }));
      await loadDatabaseOptions(true, id);
      if (latest.current.workspaceId !== workspace) return false;
      if (
        connectionSignature(latest.current.state.connections.find((c) => c.id === id)) !== signature
      )
        return false;
      if (latest.current.dbErrors[id]) throw new Error(latest.current.dbErrors[id]);
      await loadTree({ key: id, title: connection.name, type: 'connection', connectionId: id });
    });
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
      if (samePageSession(s))
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
    templateEditorGeneration.current += 1;
    requests.current.delete('templateScope');
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
    const mode = t ? syncModeOf(t.tables) : s.scopeMode;
    if (t && mixedSyncModes(t.tables))
      void message.info('旧模板包含结构和数据，当前按结构模式载入；可切换同步类型后保存');
    commit((v) => ({
      ...v,
      templateMode: mode,
      templateSearch: '',
      templateFilter: t ? 'selected' : 'all',
      templateDrafts: {},
      templateError: '',
      templateLoading: false,
      templateForm: {
        ...form,
        tables: form.tables.map((t) => ({
          ...t,
          structure: mode === 'structure' && t.structure,
          data: mode === 'data' && t.data,
          keyText: t.keyColumns.join(', '),
        })),
      },
      templateSource: form.source.connectionId ? refKey(form.source) : '',
      templateTargets: form.targets.map(refKey),
      templateDialog: true,
    }));
    if (form.source.connectionId) void loadTemplateTables();
  }
  function closeTemplate() {
    templateEditorGeneration.current += 1;
    requests.current.delete('templateScope');
    commit((s) => ({
      ...s,
      templateDialog: false,
      templateLoading: false,
      templateError: '',
      templateSearch: '',
      templateFilter: 'all',
      templateDrafts: {},
      templateForm: { ...initialModel().templateForm, workspaceId: s.workspaceId },
      templateSource: '',
      templateTargets: [],
    }));
  }
  async function templateSourceChanged(source: string) {
    commit((s) => ({
      ...s,
      templateSource: source,
      templateTargets: s.templateTargets.filter(
        (key) => key !== source && key.startsWith('pg:') === source.startsWith('pg:'),
      ),
      templateForm: { ...s.templateForm, tables: [] },
      templateDrafts: {},
      templateSearch: '',
      templateFilter: 'all',
    }));
    await loadTemplateTables();
  }
  async function loadTemplateTables() {
    const s = latest.current;
    if (!s.templateSource) return;
    const valid = request('templateScope');
    const generation = templateEditorGeneration.current;
    set('templateLoading', true);
    set('templateError', '');
    try {
      const rows = await api<{ name: string; comment?: string }[]>('tables.list', {
        ref: fromKey(s.templateSource),
      });
      if (
        !valid() ||
        generation !== templateEditorGeneration.current ||
        !latest.current.templateDialog ||
        latest.current.templateSource !== s.templateSource
      )
        return;
      commit((v) => ({
        ...v,
        templateForm: {
          ...v.templateForm,
          tables: [
            ...rows.map((row) => ({
              name: row.name,
              structure: false,
              data: false,
              keyColumns: [],
              keyText: '',
              structureOptions: { ...v.templateStructureDefaults },
              ...v.templateForm.tables.find((table) => table.name === row.name),
              comment: row.comment || '',
              sourceMissing: false,
            })),
            ...v.templateForm.tables
              .filter((table) => !rows.some((row) => row.name === table.name))
              .map((table) => ({ ...table, sourceMissing: true })),
          ],
        },
        templateLoading: false,
      }));
    } catch (error) {
      if (valid() && generation === templateEditorGeneration.current)
        commit((v) => ({
          ...v,
          templateLoading: false,
          templateError: error instanceof Error ? error.message : String(error),
        }));
    }
  }
  function setTemplateMode(mode: SyncMode) {
    commit((s) => {
      if (mode === s.templateMode) return s;
      const draft = s.templateDrafts[mode];
      return {
        ...s,
        templateMode: mode,
        templateDrafts: {
          ...s.templateDrafts,
          [s.templateMode]: {
            tables: copyModel(s.templateForm.tables),
            search: s.templateSearch,
            filter: s.templateFilter,
          },
        },
        templateForm: {
          ...s.templateForm,
          tables: draft
            ? copyModel(draft.tables)
            : s.templateForm.tables.map((table) => ({
                ...table,
                structure: false,
                data: false,
                keyColumns: [],
                keyText: '',
              })),
        },
        templateSearch: draft?.search || '',
        templateFilter: draft?.filter || 'all',
      };
    });
  }
  function updateTemplateTable(
    name: string,
    fields: Partial<Model['templateForm']['tables'][number]>,
  ) {
    commit((s) => ({
      ...s,
      templateForm: {
        ...s.templateForm,
        tables:
          fields.sourceMissing === false
            ? s.templateForm.tables.filter((table) => table.name !== name)
            : s.templateForm.tables.map((table) =>
                table.name === name
                  ? {
                      ...table,
                      ...fields,
                      [s.templateMode === 'data' ? 'structure' : 'data']: false,
                    }
                  : table,
              ),
      },
      templateDrafts:
        fields.sourceMissing === false
          ? Object.fromEntries(
              Object.entries(s.templateDrafts).map(([mode, draft]) => [
                mode,
                { ...draft, tables: draft!.tables.filter((table) => table.name !== name) },
              ]),
            )
          : s.templateDrafts,
    }));
  }
  function toggleTemplateTables() {
    commit((s) => {
      const matches = (table: Model['templateForm']['tables'][number]) =>
        scopeTableMatches({ ...table, comment: table.comment || '' }, s.templateSearch) &&
        (s.templateFilter === 'all' || table[s.templateMode]);
      const rows = s.templateForm.tables.filter(matches);
      const selected = !rows.every((table) => table[s.templateMode]);
      return {
        ...s,
        templateForm: {
          ...s.templateForm,
          tables: s.templateForm.tables.map((table) =>
            matches(table) ? { ...table, [s.templateMode]: selected } : table,
          ),
        },
      };
    });
  }
  async function saveTemplate() {
    if (templateSaving.current) return;
    templateSaving.current = true;
    const s = latest.current;
    const generation = templateEditorGeneration.current;
    set('templateSubmitting', true);
    try {
      await action(async () => {
        if (!s.templateForm.name.trim() || !s.templateSource || !s.templateTargets.length)
          throw new Error('请填写模板名称并选择来源与目标库');
        if (s.templateLoading || s.templateError) throw new Error('请先成功加载来源表清单');
        if (s.templateForm.tables.some((table) => table.sourceMissing))
          throw new Error('请先移除来源已缺失的表');
        if (mixedSyncModes(s.templateForm.tables))
          throw new Error('每次只能同步结构或数据，请选择一种同步类型');
        await api('entity.save', {
          kind: 'template',
          value: {
            ...s.templateForm,
            source: fromKey(s.templateSource),
            targets: s.templateTargets.map(fromKey),
            tables: choices(s.templateForm.tables, s.templateSource),
          },
        });
        await loadState();
        if (
          generation === templateEditorGeneration.current &&
          latest.current.workspaceId === s.workspaceId
        )
          closeTemplate();
        void message.success('模板已保存');
      });
    } finally {
      templateSaving.current = false;
      set('templateSubmitting', false);
    }
  }
  async function applyTemplate(t: SyncTemplate, chosenMode?: SyncMode) {
    if (
      comparisonActive() ||
      latest.current.applyingTemplateId ||
      t.workspaceId !== latest.current.workspaceId
    )
      return;
    if (mixedSyncModes(t.tables) && !chosenMode) {
      let mode: SyncMode = latest.current.scopeMode;
      const valid = request('applyTemplate');
      const signature = selectionSignature(compareSelection(latest.current));
      modal.confirm({
        title: '请选择旧模板的同步类型',
        content: (
          <div>
            <p>此模板同时包含结构和数据。本次只能使用一种类型，请确认选择。</p>
            <Radio.Group
              defaultValue={mode}
              onChange={(event) => {
                mode = event.target.value;
              }}
              options={[
                { label: '同步结构', value: 'structure' },
                { label: '同步数据', value: 'data' },
              ]}
            />
          </div>
        ),
        okText: '应用所选类型',
        cancelText: '取消',
        onOk: () => {
          if (!valid() || signature !== selectionSignature(compareSelection(latest.current))) {
            void message.warning('同步范围已改变，请重新应用模板');
            return;
          }
          return applyTemplate(t, mode);
        },
      });
      return;
    }
    const template = copyModel(t);
    const mode = chosenMode || syncModeOf(template.tables);
    template.tables = template.tables.map((table) => ({
      ...table,
      structure: mode === 'structure' && table.structure,
      data: mode === 'data' && table.data,
    }));
    resetSync();
    const valid = request('applyTemplate');
    commit((s) => ({
      ...s,
      scopeTemplateId: template.id,
      applyingTemplateId: template.id,
      templateApplyError: '',
      appliedTemplate: undefined,
    }));
    try {
      const source = refKey(template.source);
      set('sourceKey', source);
      set('targetKeys', template.targets.map(refKey));
      if (!(await loadScope(source, undefined, mode))) {
        if (valid()) set('templateApplyError', '模板应用失败，请检查来源数据库后重试');
        return;
      }
      if (
        !valid() ||
        latest.current.sourceKey !== source ||
        latest.current.workspaceId !== template.workspaceId
      )
        return;
      commit((s) => ({
        ...s,
        scopeTables: s.scopeTables.map((item) => {
          const saved = template.tables.find((c) => c.name === item.name);
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
      commit((s) => ({
        ...s,
        scopeTemplateId: template.id,
        appliedTemplate: { id: template.id, name: template.name },
        scopeTableFilter: 'selected',
      }));
    } finally {
      if (valid()) set('applyingTemplateId', '');
    }
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
    if (versionSubmitPending.current) return;
    versionSubmitPending.current = true;
    const s = latest.current;
    try {
      await action(async () => {
        const version =
          s.versionMode === 'append'
            ? s.state.versions.find((v) => v.id === s.versionForm.id)
            : s.versionForm;
        if (!version || !version.number.trim()) throw new Error('请填写版本号或选择已有版本');
        const validation = versionNumberError(
          version.number,
          s.state.versions,
          s.workspaceId,
          s.versionMode === 'append' ? version.id : '',
        );
        if (validation) throw new Error(validation);
        await api('version.save', {
          workspaceId: s.workspaceId,
          id: version.id,
          number: version.number.trim(),
          description: version.description,
          move: s.versionForm.move,
          recordIds: s.historySelection,
        });
        if (
          latest.current.workspaceId === s.workspaceId &&
          latest.current.versionForm === s.versionForm &&
          latest.current.versionMode === s.versionMode
        )
          set('versionDrawer', false);
        await loadState();
        void message.success('版本归档已更新');
      });
    } finally {
      versionSubmitPending.current = false;
    }
  }
  async function editVersion(id = latest.current.currentVersionId) {
    const s = latest.current;
    const version = s.state.versions.find((v) => v.id === id && v.workspaceId === s.workspaceId);
    if (!version) return;
    let description = version.description;
    await modal.confirm({
      title: '编辑版本',
      content: (
        <Form layout="vertical">
          <p>{version.number}</p>
          <Form.Item label="版本说明">
            <Input.TextArea
              placeholder="填写版本包含的变更与注意事项（选填）"
              defaultValue={description}
              onChange={(e) => {
                description = e.target.value;
              }}
              rows={4}
              aria-label="版本说明"
            />
          </Form.Item>
        </Form>
      ),
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        if (
          latest.current.workspaceId !== s.workspaceId ||
          !latest.current.state.versions.some((item) => item.id === id)
        )
          throw new Error('版本已失效，请重新打开编辑');
        try {
          await api('version.save', { ...version, recordIds: [], description });
          await loadState();
        } catch (error) {
          void message.error(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    });
  }
  function editRecordRemark(id: string) {
    recordRemarkGeneration.current += 1;
    const record = latest.current.state.records.find((record) => record.id === id);
    if (record)
      commit((s) => ({
        ...s,
        deleteRequest: undefined,
        recordRemarkId: id,
        recordRemarkText: record.remark || '',
      }));
  }
  async function saveRecordRemark() {
    const s = latest.current;
    const generation = recordRemarkGeneration.current;
    await api('record.updateRemark', { id: s.recordRemarkId, remark: s.recordRemarkText });
    await loadState();
    if (
      generation === recordRemarkGeneration.current &&
      latest.current.workspaceId === s.workspaceId &&
      latest.current.recordRemarkId === s.recordRemarkId
    )
      set('recordRemarkId', '');
    void message.success('备注已保存');
  }
  function requestHistoryDeletion(kind: 'record' | 'version', id: string) {
    const s = latest.current;
    const record = s.state.records.find((record) => record.id === id);
    const version = s.state.versions.find(
      (version) => version.id === (kind === 'version' ? id : s.state.versionLinks[id]),
    );
    if ((kind === 'record' && !record) || (kind === 'version' && !version)) return;
    const contextText = kind === 'record' ? record!.remark : version!.description;
    set('recordRemarkId', '');
    set('deleteRequest', {
      kind,
      id,
      label: kind === 'record' ? id : version!.number,
      context: contextText?.trim()
        ? { label: kind === 'record' ? '记录备注' : '版本说明', text: contextText }
        : undefined,
      description:
        kind === 'record'
          ? `状态：${statusLabel(record!.status)}；所属版本：${version?.number || '未标记'}。将永久删除该记录、SQL、日志和恢复资料，工具将无法再基于该记录恢复。有关联恢复证据时禁止删除；状态不明不代表执行成功。`
          : `将删除版本说明并解除 ${Object.values(s.state.versionLinks).filter((value) => value === id).length} 条记录的版本归属。同步记录及其 SQL、日志和恢复资料全部保留。`,
    });
  }
  async function deleteHistoryEntity(confirmation: string) {
    const s = latest.current;
    const request = s.deleteRequest;
    if (!request || confirmation !== request.label) throw new Error('确认标识不匹配');
    const result = await api<{ cleanupPending?: boolean; message?: string }>(
      request.kind + '.delete',
      { id: request.id, confirmation },
    );
    for (const key of requests.current.keys())
      if (
        key === 'record' ||
        key === 'file' ||
        key === 'rollback' ||
        key.startsWith('recordScript:')
      )
        requests.current.delete(key);
    await loadState();
    if (latest.current.deleteRequest === request) set('deleteRequest', undefined);
    if (result.cleanupPending)
      void message.warning('记录已删除，本地档案清理待重试：' + result.message);
    else
      void message.success(
        request.kind === 'record' ? '记录及本地资料已删除' : '版本已删除，相关同步记录保留',
      );
  }
  async function retryRecordDeletion(id: string) {
    await action(async () => {
      const result = await api<{ cleanupPending?: boolean; message?: string }>('record.delete', {
        id,
        confirmation: id,
      });
      await loadState();
      if (result.cleanupPending) throw new Error(result.message || '本地档案清理仍未完成');
      void message.success('本地档案处理已完成');
    });
  }
  async function openRecord(id: string, origin?: RecordOrigin) {
    const current = latest.current;
    const branch =
      origin ||
      (current.page === 'history'
        ? current.historyTab === 'versions' && current.currentVersionId
          ? { versionId: current.currentVersionId }
          : undefined
        : current.detail?.record.id === id || current.rollback?.recordId === id
          ? current.recordOrigin
          : undefined);
    const valid = request('record');
    const detail = await api<RecordDetail>('record.get', { id });
    if (!valid()) return;
    if (detail.record.workspaceId !== latest.current.workspaceId)
      throw new Error('同步记录已不存在或不属于当前工作区');
    const file = defaultScriptFile(detail.files, 'scripts');
    commit((s) => ({
      ...s,
      detail,
      recordOrigin:
        branch &&
        latest.current.state.versionLinks[id] === branch.versionId &&
        latest.current.state.versions.some(
          (v) => v.id === branch.versionId && v.workspaceId === latest.current.workspaceId,
        )
          ? branch
          : undefined,
      recordView: s.recordView + 1,
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
    await loadRecordScripts(latest.current.recordTab);
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
    clearRefresh(recordRefreshKey(latest.current));
    request('recordScripts');
    commit((s) => ({
      ...s,
      recordTab: tab,
      fileSelected: defaultScriptFile(s.detail?.files || [], tab),
      recordScripts: {},
      recordScriptErrors: {},
    }));
    await loadRecordScripts(tab);
  }
  async function refreshRecordScripts() {
    const s = latest.current;
    if (!s.detail) return;
    await runRefresh(recordRefreshKey(s), '重新加载脚本', async () => {
      await loadRecordScripts(s.recordTab, true);
      if (
        latest.current.detail?.record.id !== s.detail?.record.id ||
        latest.current.recordTab !== s.recordTab ||
        latest.current.recordView !== s.recordView
      )
        return false;
      const errors = Object.values(latest.current.recordScriptErrors).filter(Boolean);
      if (errors.length) throw new Error(errors.join('；'));
    });
  }
  async function loadRecordScripts(tab: string, force = false) {
    const s = latest.current;
    if (!s.detail || !['scripts', 'rollbackScripts'].includes(tab)) return;
    const id = s.detail.record.id;
    const files = recordScriptFiles(s.detail.files, tab);
    if (!files.length) return;
    const requestValid = request('recordScripts');
    const valid = () =>
      requestValid() &&
      latest.current.page === 'record' &&
      latest.current.recordView === s.recordView &&
      latest.current.detail?.record.id === id &&
      latest.current.recordTab === tab;
    // Target manifests identify the connection even when two connections use the same database name.
    const folders = new Set(
      files.map((file) => file.replaceAll('\\', '/').split('/').slice(0, -1).join('/')),
    );
    const manifests = s.detail.files.filter(
      (candidate) =>
        candidate.replaceAll('\\', '/').endsWith('/target.json') &&
        folders.has(candidate.replaceAll('\\', '/').slice(0, -'/target.json'.length)),
    );
    await Promise.all(
      manifests.map(async (file) => {
        const folder = file.replaceAll('\\', '/').slice(0, -'/target.json'.length);
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
    if (!valid()) return;
    await Promise.all(
      files.map(async (file) => {
        if (!force && s.recordScripts[file] !== undefined) return;
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
  function samePageSession(snapshot: Model) {
    const current = latest.current;
    return (
      current.page === snapshot.page &&
      current.workspaceId === snapshot.workspaceId &&
      current.pageEntry === snapshot.pageEntry
    );
  }
  function recordViewIsCurrent(snapshot: Model) {
    const current = latest.current;
    return (
      current.page === 'record' &&
      current.workspaceId === snapshot.workspaceId &&
      current.pageEntry === snapshot.pageEntry &&
      current.recordView === snapshot.recordView &&
      current.detail?.record.id === snapshot.detail?.record.id
    );
  }
  async function auditRecord() {
    const snapshot = latest.current;
    const id = snapshot.detail?.record.id;
    if (!id) return;
    await action(async () => {
      await api('record.verify', { id });
      await loadState();
      if (recordViewIsCurrent(snapshot)) {
        await openRecord(id);
        if (
          latest.current.page === 'record' &&
          latest.current.pageEntry === snapshot.pageEntry &&
          latest.current.detail?.record.id === id
        )
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
        backupCompleted: false,
        remark: s.externalRemark,
      });
      if (recordViewIsCurrent(s)) set('externalDrawer', false);
      await loadState();
      if (recordViewIsCurrent(s)) await openRecord(id);
      void message.success('外部执行已登记，待核验');
    });
  }
  async function verifyExternal() {
    const snapshot = latest.current;
    const id = snapshot.detail?.record.id;
    if (!id) return;
    await action(async () => {
      const result = await api<{ verified: boolean }>('external.verify', { id });
      await loadState();
      if (recordViewIsCurrent(snapshot)) await openRecord(id);
      void (result.verified
        ? message.success('执行状态与恢复资料已核验')
        : message.warning('未通过完整核验，请查看校验结果'));
    });
  }
  async function beginRollback(id: string, refresh = false) {
    if (refresh && latest.current.refreshing[rollbackRefreshKey(latest.current)]) return;
    const valid = request('rollback');
    const work = async () => {
      const rollback = await api<RollbackPlan>('rollback.preview', { id });
      if (valid())
        commit((s) => ({
          ...s,
          rollback,
          rollbackView: refresh ? s.rollbackView : s.rollbackView + 1,
          rollbackIds: rollback.items.filter((i) => i.eligible).map((i) => i.id),
          rollbackSql: rollback.items.find((i) => i.eligible)?.sql.join(';\n') || '',
          rollbackRemark: '',
          page: 'rollback',
        }));
      else return false;
    };
    if (refresh) await runRefresh(rollbackRefreshKey(latest.current), '重新校验', work);
    else await action(work);
  }
  function toggleRecovery(ids: string[], checked: boolean) {
    commit((s) => ({ ...s, rollbackIds: toggleIds(s.rollbackIds, ids, checked) }));
  }
  async function executeRollback() {
    const s = latest.current;
    if (!s.rollback || !s.rollbackIds.length || rollbackSubmitPending.current) return;
    const record =
      s.detail?.record.id === s.rollback.recordId
        ? s.detail.record
        : s.state.records.find((item) => item.id === s.rollback!.recordId);
    rollbackSubmitPending.current = true;
    set('rollbackSubmitting', s.rollback.recordId);
    try {
      const accepted = await modal.confirm({
        title: preview ? '模拟恢复（只修改内存示例）' : '执行回滚',
        centered: true,
        width: 960,
        content: (
          <RollbackExecutionConfirmation
            rollback={s.rollback}
            selectedIds={s.rollbackIds}
            source={record?.plan?.source || record?.source}
            connections={s.state.connections}
          />
        ),
        okText: '执行所选回滚',
        cancelText: '取消',
      });
      if (!accepted) return;
      const current = latest.current;
      if (
        current.workspaceId !== s.workspaceId ||
        current.rollback !== s.rollback ||
        current.rollbackView !== s.rollbackView ||
        current.page !== s.page ||
        JSON.stringify(current.rollbackIds) !== JSON.stringify(s.rollbackIds)
      ) {
        void message.info('回滚范围已改变，请重新确认后执行');
        return;
      }
      await action(async () => {
        const r = await api<SyncRecord>('rollback.execute', {
          id: s.rollback!.recordId,
          selectedIds: s.rollbackIds,
          remark: s.rollbackRemark,
        });
        await loadState();
        if (samePageSession(s)) await openRecord(r.id);
      });
    } finally {
      rollbackSubmitPending.current = false;
      set('rollbackSubmitting', undefined);
    }
  }
  async function beginExport(node?: TreeNode) {
    const s = latest.current;
    const source = node?.ref ? refKey(node.ref) : s.sourceKey || dbOptions(s)[0]?.value || '';
    commit((v) => ({
      ...v,
      page: 'export',
      includeDrop: v.page === 'export' ? v.includeDrop : false,
      exportSql: v.page === 'export' ? v.exportSql : '',
      exportPreview: v.page === 'export' ? v.exportPreview : undefined,
      exportSource: source,
    }));
    await loadExport(source, node?.table);
  }
  async function loadExport(source = latest.current.exportSource, preselect?: string) {
    request('exportSQL'); // 来源切换使进行中的生成响应失效
    commit((s) => ({
      ...s,
      exportSource: source,
      exportTables: [],
      exportSql: '',
      exportPreview: undefined,
    }));
    const valid = request('exportScope');
    if (!source) return;
    await action(async () => {
      const rows = await api<{ name: string; comment: string }[]>('tables.list', {
        ref: fromKey(source),
      });
      // 过期响应由 request 令牌与 exportSource 比对丢弃；离开导出页时 commit 统一清空导出状态。
      if (!valid() || latest.current.exportSource !== source) return;
      commit((s) => ({
        ...s,
        exportTables: rows.map((t) => ({ ...t, selected: !!preselect && t.name === preselect })),
        exportFilename: fromKey(source).database + '_schema.sql',
      }));
    });
  }
  async function updateExport() {
    const s = latest.current;
    const tables = s.exportTables.filter((t) => t.selected).map((t) => t.name);
    if (s.loading || s.exportGenerating || !s.exportSource || !tables.length) return;
    const generation = {};
    exportGeneration.current = generation;
    invalidateExportPreview(); // 重新生成前清空旧预览并作废旧请求
    const valid = request('exportSQL');
    commit((v) => ({ ...v, exportGenerating: true }));
    try {
      await action(async () => {
        const result = await api<{ sql: string }>('schema.export', {
          source: fromKey(s.exportSource),
          tables,
          includeDrop: s.includeDrop,
        });
        if (valid())
          commit((v) => ({
            ...v,
            exportSql: result.sql,
            exportPreview: { source: s.exportSource, tables, includeDrop: s.includeDrop },
          }));
      });
    } finally {
      if (exportGeneration.current === generation) {
        exportGeneration.current = undefined;
        set('exportGenerating', false);
      }
    }
  }
  function selectExport(names: string[]) {
    const selected = new Set(names);
    commit((s) => ({
      ...s,
      exportTables: s.exportTables.map((t) => ({ ...t, selected: selected.has(t.name) })),
    }));
    invalidateExportPreview();
  }
  function setIncludeDrop(value: boolean) {
    if (value === latest.current.includeDrop) return;
    commit((s) => ({ ...s, includeDrop: value }));
    invalidateExportPreview();
  }
  /** 选择、范围或来源变化后，清空当前预览并作废进行中的生成请求。 */
  function invalidateExportPreview() {
    request('exportSQL');
    commit((s) =>
      s.exportSql || s.exportPreview ? { ...s, exportSql: '', exportPreview: undefined } : s,
    );
  }
  async function saveSql() {
    const s = latest.current;
    if (s.exportSql)
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
        name: 'db-aligner-config.json',
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
              if (active && recordViewIsCurrent(s)) set('detail', detail);
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
              ? { ...t, structure: true, data: false, keyText: 'code' }
              : t,
          ),
        }));
        // Generate the showcase through the same bridge and current scope as a fresh comparison.
        const scope = latest.current;
        const startedAt = Date.now();
        const plan = await api<SyncPlan>('sync.compare', {
          workspaceId: scope.workspaceId,
          source: fromKey(scope.sourceKey),
          targets: scope.targetKeys.map(fromKey),
          tables: choices(scope.scopeTables),
        });
        if (!active) return;
        commit((s) => ({
          ...s,
          plan,
          page: 'diff',
          compareScope: copyModel(compareSelection(s)),
          compareStartedAt: startedAt,
          compareFinishedAt: Date.now(),
          compareTask: {
            compareId: 'PREVIEW-SHOWCASE',
            status: 'COMPLETED',
            progress: {
              table: '',
              phase: '',
              rows: 0,
              completed: plan.tables.length * (1 + plan.targets.length),
              total: plan.tables.length * (1 + plan.targets.length),
            },
          },
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
    enterPage,
    loadState,
    switchWorkspace,
    loadTree,
    switchDatabaseType,
    openTable,
    refreshTable,
    refreshDatabase,
    clearRefresh,
    databaseOptionsType,
    refreshDatabaseOptions,
    refreshTargetTables,
    refreshEngine,
    refreshRecordScripts,
    beginSync,
    loadScope,
    setTargets,
    loadTargetTables,
    missingTargets: (name: string) => missingTargetsOf(latest.current, name),
    setScopeMode,
    setTemplateMode,
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
    closeWorkspace,
    saveWorkspace,
    editConnection,
    editGroup,
    closeGroup,
    saveGroup,
    removeGroup,
    addConnectionGroup,
    chooseConnectionGroup,
    moveConnection,
    moveGroup,
    closeConnection,
    saveConnection,
    testConnection,
    discoverConnection,
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
    closeTemplate,
    templateSourceChanged,
    updateTemplateTable,
    toggleTemplateTables,
    loadTemplateTables,
    saveTemplate,
    applyTemplate,
    openVersionDrawer,
    markVersion,
    editVersion,
    openRecord,
    editRecordRemark,
    saveRecordRemark,
    requestHistoryDeletion,
    deleteHistoryEntity,
    retryRecordDeletion,
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
