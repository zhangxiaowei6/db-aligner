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
import { copyModel } from './copy';
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
  type ImportRow,
  type Model,
  type Page,
  type RecordDetail,
  type ScopeTable,
  type TreeNode,
} from './model';
import type {
  ConnectionInfo,
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
  const [m, dispatch] = useReducer(modelReducer, undefined, initialModel);
  const latest = useRef(m);
  const mounted = useRef(true);
  const requests = useRef(new Map<string, number>());
  const requestSerial = useRef(0);
  const { message, modal } = App.useApp();
  const closePending = useRef(false);
  const commit = useCallback((update: (current: Model) => Model) => {
    if (!mounted.current) return;
    const next = update(latest.current);
    latest.current = next;
    dispatch({ type: 'replace', value: next });
  }, []);
  const set = useCallback(
    <K extends keyof Model>(key: K, value: Model[K]) => commit((s) => ({ ...s, [key]: value })),
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
  }
  function switchWorkspace(id: string) {
    requests.current.clear();
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
      tableTabs: [],
      activeTableTab: '',
      dbCache: {},
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
  async function loadTree(node: TreeNode) {
    if (!['connection', 'database'].includes(node.type)) return;
    const valid = request('tree:' + node.key);
    await action(async () => {
      let children: TreeNode[];
      if (node.type === 'connection') {
        const databases = await api<string[]>('databases.list', {
          connectionId: node.connectionId,
        });
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
      let tab = latest.current.tableTabs.find((t) => t.id === id);
      if (!tab) {
        const model = await api<Table>('table.get', { ref: node.ref, table: node.table });
        tab = { id, ref: node.ref!, table: node.table!, model };
      }
      if (valid())
        commit((s) => ({
          ...s,
          tableTabs: s.tableTabs.some((t) => t.id === id) ? s.tableTabs : [...s.tableTabs, tab!],
          activeTableTab: id,
          page: 'table',
        }));
    });
  }
  async function refreshTable() {
    const tab = latest.current.tableTabs.find((t) => t.id === latest.current.activeTableTab);
    if (!tab) return;
    const valid = request('table:' + tab.id);
    await action(async () => {
      const model = await api<Table>('table.get', { ref: tab.ref, table: tab.table });
      if (valid())
        commit((s) => ({
          ...s,
          tableTabs: s.tableTabs.map((t) => (t.id === tab.id ? { ...t, model } : t)),
        }));
    });
  }
  function closeTable(id: string) {
    commit((s) => {
      const tabs = s.tableTabs.filter((t) => t.id !== id);
      const active = s.activeTableTab === id ? tabs[0]?.id || '' : s.activeTableTab;
      return {
        ...s,
        tableTabs: tabs,
        activeTableTab: active,
        page: s.page === 'table' && !active ? (s.plan ? 'diff' : 'scope') : s.page,
      };
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
        })),
        targetKeys: s.targetKeys.filter((k) => k !== source),
      }));
      return true;
    });
  }
  async function beginSync(node?: TreeNode, mode: 'structure' | 'data' = 'structure') {
    navigate('scope');
    const source = node?.ref
      ? refKey(node.ref)
      : latest.current.sourceKey || dbOptions(latest.current)[0]?.value || '';
    if (source) await loadScope(source, node?.table, mode);
  }
  function setScopeAll(on: boolean, type: 'structure' | 'data') {
    commit((s) => ({
      ...s,
      scopeTables: s.scopeTables.map((t) =>
        t.name.toLowerCase().includes(s.tableSearch.toLowerCase()) ? { ...t, [type]: on } : t,
      ),
    }));
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
        keyColumns: splitKeys(t.keyText || ''),
      }));
  async function compare() {
    const s = latest.current;
    const valid = request('compare');
    await action(async () => {
      const plan = await api<SyncPlan>('sync.compare', {
        workspaceId: s.workspaceId,
        source: fromKey(s.sourceKey),
        targets: s.targetKeys.map(fromKey),
        tables: choices(s.scopeTables),
      });
      if (
        !valid() ||
        latest.current.sourceKey !== s.sourceKey ||
        latest.current.targetKeys !== s.targetKeys ||
        latest.current.scopeTables !== s.scopeTables
      )
        return;
      const changes = plan.targets.flatMap((t) => t.changes);
      commit((v) => ({
        ...v,
        plan,
        selectedIds: changes.filter((c) => c.selected && !c.blocked).map((c) => c.id),
        currentChangeId: changes.find((c) => !c.blocked)?.id || '',
        diffTab: s.scopeTables.some((t) => t.structure) ? 'structure' : 'data',
        page: 'diff',
      }));
    });
  }
  function toggleChanges(ids: string[], checked: boolean) {
    commit((s) => ({ ...s, selectedIds: toggleIds(s.selectedIds, ids, checked) }));
  }
  async function saveSync(mode: string) {
    const s = latest.current;
    if (!s.plan) return;
    if (
      mode === 'EXECUTE_AND_SAVE' &&
      !(await confirm(
        '执行同步',
        `将执行已选的 ${s.selectedIds.length} 项变更，并保存同步记录与恢复资料。请确认目标数据库。`,
        '执行并保存',
      ))
    )
      return;
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
      databasesText: form.databases.join(', '),
      page: 'connections',
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
        patch('connectionForm', { id: form.id, password: '', certificatePassword: '' });
      for (const key of requests.current.keys())
        if (key === 'tree:' + form.id || key.startsWith('tree:' + form.id + '/'))
          requests.current.delete(key);
      commit((v) => ({
        ...v,
        dbCache: Object.fromEntries(Object.entries(v.dbCache).filter(([key]) => key !== form.id)),
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
  async function testConnection() {
    const s = latest.current;
    const config = { ...s.connectionForm, databases: splitKeys(s.databasesText) };
    await action(async () => {
      const result = await api<{ serverVersion: string }>('connections.test', {
        id: config.id,
        config,
      });
      void message.success('连接成功 · ' + result.serverVersion);
    });
  }
  async function chooseCertificate(field: 'ca' | 'clientCert') {
    const id = latest.current.connectionForm.id;
    const path = await action(() => api<string | null>('files.chooseCertificate'));
    if (path && latest.current.connectionForm.id === id) patch('connectionForm', { [field]: path });
  }
  async function removeEntity(kind: string, id: string) {
    if (!(await confirm('删除配置', '确认删除这项配置？已有同步记录会保留。', '删除'))) return;
    await action(async () => {
      await api('entity.delete', { kind, id });
      await loadState();
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
    commit((s) => ({
      ...s,
      importRows: s.importRows.map((r) => (r.id === id ? { ...r, ...fields } : r)),
    }));
  }
  async function submitImport() {
    const s = latest.current;
    await action(async () => {
      if (!s.importWorkspaceIds.length) throw new Error('请选择导入工作区');
      for (const row of s.importRows.filter((r) => r.selected && !r.warning)) {
        const existing = s.state.connections.find(
          (c) => c.host === row.host && c.port === row.port && c.user === row.user,
        );
        if (existing && s.duplicateMode === 'skip') continue;
        await api('entity.save', {
          kind: 'connection',
          value: {
            ...row,
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
          ? { ...item, ...copyModel(saved), keyText: saved.keyColumns.join(', ') }
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
    const file = detail.files.find((f) => f.endsWith('02_sync.sql')) || detail.files[0] || '';
    commit((s) => ({
      ...s,
      detail,
      fileSelected: file,
      fileSql: '',
      recordTab:
        detail.record.mode === 'EXECUTE_AND_SAVE' &&
        ['RUNNING', 'QUEUED'].includes(detail.record.status)
          ? 'results'
          : 'scripts',
      page: 'record',
    }));
    if (file) await selectFile(file);
  }
  async function selectFile(file: string) {
    const id = latest.current.detail?.record.id;
    if (!id) return;
    set('fileSelected', file);
    const valid = request('file');
    const sql = await api<string>('record.file', { id, file });
    if (valid() && latest.current.detail?.record.id === id && latest.current.fileSelected === file)
      set('fileSql', sql);
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
    set('exportSource', source);
    const valid = request('exportScope');
    if (!source) {
      set('exportTables', []);
      set('exportSql', '');
      return;
    }
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
      if (preselect) await updateExport();
    });
  }
  async function updateExport() {
    const s = latest.current;
    const tables = s.exportTables.filter((t) => t.selected).map((t) => t.name);
    const valid = request('exportSQL');
    if (!tables.length) {
      set('exportSql', '');
      return;
    }
    await action(async () => {
      const result = await api<{ sql: string }>('schema.export', {
        source: fromKey(s.exportSource),
        tables,
        includeDrop: s.includeDrop,
      });
      if (valid() && latest.current.exportSource === s.exportSource) set('exportSql', result.sql);
    });
  }
  function selectExport(names: string[]) {
    commit((s) => ({
      ...s,
      exportTables: s.exportTables.map((t) => ({ ...t, selected: names.includes(t.name) })),
    }));
    void updateExport();
  }
  function setIncludeDrop(value: boolean) {
    set('includeDrop', value);
    void updateExport();
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
        state.records.some((r) => ['RUNNING', 'QUEUED'].includes(r.status)) &&
        !(await confirm(
          '关闭客户端',
          '有同步任务正在执行。关闭客户端会中断任务，重启后需要核验实际状态。',
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
  const handlers = useRef({ loadState, closeWindow });
  handlers.current = { loadState, closeWindow };
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onEvent((event) => {
      if (event.event === 'window-close-request') void handlers.current.closeWindow();
      if (event.event === 'engine-error') set('engineError', String(event.message));
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
          if (requested === 'connections') editConnection(latest.current.state.connections[0]);
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
        await compare();
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
    closeTable,
    beginSync,
    loadScope,
    setScopeAll,
    updateScope,
    compare,
    toggleChanges,
    saveSync,
    editWorkspace,
    saveWorkspace,
    editConnection,
    saveConnection,
    testConnection,
    chooseCertificate,
    removeEntity,
    readImport,
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
