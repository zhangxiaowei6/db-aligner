// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider, useAppearance } from './appearance';
import { BusinessProvider, useController, type Controller } from './controller';
import { dbOptions, initialModel, selection, type TreeNode } from './model';
import { previewPlan, previewTable } from './preview';
import { DiffPage, ScopePage } from './pages/Sync';
import { ConnectionsPage, ImportPage } from './pages/Management';
import { HistoryPage, RecordPage } from './pages/Records';
import type { Appearance, State, SyncTemplate } from './types';
import { CompareConfirmation } from './components/CompareConfirmation';
import { CompareProgressPanel } from './components/CompareProgress';
import { allStructureOptions } from './structure-options';
import { ConnectionOrganizationDialogs } from './components/ConnectionOrganization';
import { recordScriptFiles } from './sync-scripts';

// 真实 Ant Design 渲染的交互测试在本机可能超过默认 5 秒，统一放宽避免按环境速度抖动。
vi.setConfig({ testTimeout: 30_000 });

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  window: vi.fn(),
  listeners: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock('./api', () => ({
  preview: false,
  api: bridge.invoke,
  windowAction: bridge.window,
  onEvent: (fn: (event: Record<string, unknown>) => void) => {
    bridge.listeners.add(fn);
    return () => bridge.listeners.delete(fn);
  },
}));
let controller: Controller;
let appearanceControls: ReturnType<typeof useAppearance>;
let state: State;
function Probe() {
  controller = useController();
  appearanceControls = useAppearance();
  return <div data-testid="probe">{controller.m.workspaceId}</div>;
}
function mount(children?: React.ReactNode) {
  return render(
    <AppearanceProvider initial={{ themeMode: 'system', resolvedTheme: 'light' }}>
      <BusinessProvider>
        <Probe />
        {children}
      </BusinessProvider>
    </AppearanceProvider>,
  );
}
async function ready(children?: React.ReactNode) {
  const rendered = mount(children);
  await waitFor(() => expect(controller.m.loading).toBe(false));
  await waitFor(() => expect(Object.values(controller.m.dbLoading).some(Boolean)).toBe(false));
  return rendered;
}
function emit(event: Record<string, unknown>) {
  bridge.listeners.forEach((fn) => fn(event));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.window.mockReset();
  bridge.listeners.clear();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => original(element));
  state = initialModel().state;
  state.workspaces = [
    { id: 'default', name: '测试项目', description: '' },
    { id: 'second', name: '第二项目', description: '' },
  ];
  state.connections = [
    {
      id: 'source',
      name: '来源',
      host: '192.0.2.10',
      port: 3306,
      user: 'tester',
      group: '测试',
      databases: ['a', 'b'],
      workspaceIds: ['default'],
      ssl: false,
      ca: '',
      clientCert: '',
      hasPassword: false,
    },
  ];
  state.settings.archivePath = 'D:\\Test\\archives';
  state.templates = [
    {
      id: 'template',
      workspaceId: 'default',
      name: '模板',
      description: '',
      source: { connectionId: 'source', database: 'a' },
      targets: [{ connectionId: 'source', database: 'b' }],
      tables: [{ name: 'dict', structure: true, data: true, keyColumns: ['code'] }],
    },
  ];
  bridge.invoke.mockImplementation(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === 'state.load') return structuredClone(state);
    if (method === 'appearance.set') {
      const result: Appearance = {
        themeMode: params.themeMode as Appearance['themeMode'],
        resolvedTheme: params.themeMode === 'dark' ? 'dark' : 'light',
      };
      emit({ event: 'appearance-changed', appearance: result });
      return result;
    }
    if (method === 'tables.list') return [{ name: 'dict', comment: '字典' }];
    if (method === 'databases.list') return ['a', 'b'];
    if (method === 'table.get') return structuredClone(previewTable);
    if (method === 'entity.save') return { ok: true };
    throw new Error('Unexpected test API: ' + method);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('comparison confirmation and cancellation', () => {
  async function setup(data = true) {
    await ready(
      <>
        <ScopePage />
        <CompareConfirmation />
        <CompareProgressPanel />
      </>,
    );
    act(() =>
      controller.commit((s) => ({
        ...s,
        sourceKey: 'source/a',
        targetKeys: ['source/b'],
        tableSearch: 'dict',
        scopeTables: ['dict', 'hidden'].map((name) => ({
          name,
          comment: '',
          structure: true,
          data,
          keyColumns: [],
          keyText: '',
          structureOptions: { ...allStructureOptions },
        })),
      })),
    );
  }
  it('confirms all data across the unfiltered list and requires risk acknowledgement, with cancellation and one dialog', async () => {
    await setup();
    await act(async () => {
      await controller.compare();
      await controller.compare();
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText('已选择源库所有表的数据 · 1 个目标库')).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    const start = within(dialog).getByRole('button', { name: '确认并开始比较' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect((start as HTMLButtonElement).disabled).toBe(false);
    expect(within(dialog).getByText('hidden')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    expect(bridge.invoke.mock.calls.some(([method]) => method === 'sync.compare.start')).toBe(
      false,
    );
  }, 15000);
  it('dismisses stale confirmations and rejects empty structure selections', async () => {
    await setup(false);
    await act(async () => {
      await controller.compare();
    });
    const pending = controller.m.compareConfirmation!;
    expect(screen.queryByRole('checkbox', { name: /性能影响/ })).toBeNull();
    act(() => controller.updateScope('dict', { data: true }));
    expect(controller.m.compareConfirmation).toBeUndefined();
    await act(async () => {
      await controller.startConfirmedCompare(pending);
    });
    expect(bridge.invoke.mock.calls.some(([method]) => method === 'sync.compare.start')).toBe(
      false,
    );
    act(() =>
      controller.updateScope('dict', {
        structureOptions: {
          columns: false,
          columnOrder: false,
          tableComment: false,
          columnComments: false,
          indexes: false,
          foreignKeys: false,
          tableCollation: false,
        },
      }),
    );
    await act(async () => {
      await controller.compare();
    });
    expect(controller.m.compareConfirmation).toBeUndefined();
    expect(await screen.findByText('请选择结构细项：dict')).toBeTruthy();
  }, 15000);
  it('stops even during start, locks the range, ignores stale events and retains selections after cancellation', async () => {
    await setup(false);
    const start = deferred<{ compareId: string }>();
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (method, params) => {
      if (method === 'sync.compare.start') return start.promise;
      if (method === 'sync.compare.cancel') return { status: 'CANCELLING' };
      if (method === 'sync.compare.get')
        return { ...controller.m.compareTask, status: 'CANCELLING' };
      return original(method, params);
    });
    await act(async () => {
      await controller.compare();
    });
    let request!: Promise<void>;
    act(() => {
      request = controller.startConfirmedCompare(controller.m.compareConfirmation!);
    });
    const id = controller.m.compareTask!.compareId;
    const selected = structuredClone(controller.m.scopeTables);
    act(() => {
      controller.switchWorkspace('second');
      controller.set('targetKeys', []);
      controller.updateScope('dict', { data: true });
    });
    expect(controller.m.workspaceId).toBe('default');
    expect(controller.m.targetKeys).toEqual(['source/b']);
    expect(controller.m.scopeTables).toEqual(selected);
    await act(async () => {
      await controller.stopCompare();
    });
    expect(controller.m.compareTask?.status).toBe('CANCELLING');
    await act(async () => {
      start.resolve({ compareId: id });
      await request;
    });
    expect(bridge.invoke).toHaveBeenCalledWith('sync.compare.cancel', { compareId: id });
    act(() => emit({ event: 'compare-progress', compareId: 'stale', status: 'CANCELLED' }));
    expect(controller.m.compareTask?.status).toBe('CANCELLING');
    act(() =>
      emit({
        event: 'compare-progress',
        compareId: id,
        status: 'CANCELLED',
        progress: controller.m.compareTask!.progress,
      }),
    );
    expect(controller.m.compareTask?.status).toBe('CANCELLED');
    expect(controller.m.plan).toBeUndefined();
    expect(controller.m.scopeTables).toEqual(selected);
    expect(screen.getByText('比较已停止')).toBeTruthy();
    await act(async () => {
      await controller.compare();
    });
    expect(controller.m.compareConfirmation).toBeDefined();
  }, 15000);
  it('keeps comparisons running while hiding progress outside the comparison flow and includes them in close confirmation', async () => {
    await setup(false);
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (method, params) => {
      if (method === 'sync.compare.start') return { compareId: params.compareId };
      if (method === 'sync.compare.get')
        return {
          ...controller.m.compareTask,
          status: 'COMPLETED',
          plan: structuredClone(previewPlan),
        };
      return original(method, params);
    });
    await act(async () => {
      await controller.compare();
    });
    await act(async () => {
      await controller.startConfirmedCompare(controller.m.compareConfirmation!);
    });
    act(() => {
      controller.navigate('history');
      emit({ event: 'window-close-request' });
    });
    expect(
      await screen.findByText('有比较任务正在运行，关闭客户端会中断比较并丢弃本次结果。'),
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: '比较进度' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(controller.m.compareTask?.status).toBe('COMPLETED'), {
      timeout: 4000,
    });
    expect(controller.m.page).toBe('history');
    expect(controller.m.plan?.id).toBe(previewPlan.id);
    expect(screen.queryByRole('region', { name: '比较进度' })).toBeNull();
    act(() => controller.navigate('diff'));
    expect(screen.getByRole('region', { name: '比较进度' })).toBeTruthy();
    expect(screen.getByText('比较完成')).toBeTruthy();
  }, 15000);
  it('retries a cancellation whose transport failed while the engine still reports running', async () => {
    await setup(false);
    const original = bridge.invoke.getMockImplementation()!;
    let cancels = 0;
    bridge.invoke.mockImplementation(async (method, params) => {
      if (method === 'sync.compare.start') return { compareId: params.compareId };
      if (method === 'sync.compare.get') return { ...controller.m.compareTask, status: 'RUNNING' };
      if (method === 'sync.compare.cancel') {
        if (++cancels === 1) throw new Error('transport unavailable');
        emit({ event: 'compare-progress', ...controller.m.compareTask, status: 'CANCELLED' });
        return { status: 'CANCELLED' };
      }
      return original(method, params);
    });
    await act(async () => {
      await controller.compare();
    });
    await act(async () => {
      await controller.startConfirmedCompare(controller.m.compareConfirmation!);
    });
    await act(async () => {
      await controller.stopCompare();
    });
    expect(controller.m.compareTask?.status).toBe('CANCELLING');
    await waitFor(() => expect(controller.m.compareTask?.status).toBe('CANCELLED'), {
      timeout: 4000,
    });
    expect(cancels).toBe(2);
  }, 15000);
  it('normalizes legacy templates to full structure regardless of custom defaults', async () => {
    await setup(false);
    act(() =>
      controller.set('structureDefaults', {
        columns: false,
        columnOrder: false,
        tableComment: false,
        columnComments: false,
        indexes: false,
        foreignKeys: false,
        tableCollation: false,
      }),
    );
    await act(async () => {
      await controller.applyTemplate(state.templates[0]);
    });
    expect(controller.m.scopeTables[0].structureOptions).toEqual(allStructureOptions);
  }, 15000);
  it('clears an interrupted task on engine exit and preserves template structure choices', async () => {
    await setup(false);
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (method, params) =>
      method === 'sync.compare.start' ? { compareId: params.compareId } : original(method, params),
    );
    await act(async () => {
      await controller.compare();
    });
    await act(async () => {
      await controller.startConfirmedCompare(controller.m.compareConfirmation!);
    });
    act(() => emit({ event: 'engine-error', message: 'engine stopped' }));
    expect(controller.m.compareTask?.status).toBe('FAILED');
    expect(controller.m.plan).toBeUndefined();
    const options = { ...allStructureOptions, columns: false, indexes: false };
    act(() => {
      controller.updateScope('dict', { structureOptions: options });
      controller.editTemplate();
    });
    expect(
      controller.m.templateForm.tables.find((table) => table.name === 'dict')?.structureOptions,
    ).toEqual(options);
  }, 15000);
});

describe('React business state and protocol', () => {
  it('toggles structure and data independently and only changes the current filtered tables', async () => {
    await ready(<ScopePage />);
    act(() =>
      controller.commit((s) => ({
        ...s,
        tableSearch: 'visible',
        scopeTables: [
          {
            name: 'visible',
            comment: '',
            structure: false,
            data: false,
            keyText: '',
            keyColumns: [],
          },
          {
            name: 'hidden',
            comment: '',
            structure: true,
            data: false,
            keyText: '',
            keyColumns: [],
          },
        ],
      })),
    );
    await userEvent.click(screen.getByRole('button', { name: /结\s*构$/ }));
    expect(controller.m.scopeTables.map((table) => table.structure)).toEqual([true, true]);
    expect(controller.m.scopeTables.map((table) => table.data)).toEqual([false, false]);
    expect(screen.getByRole('button', { name: /结\s*构$/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: /结\s*构$/ }));
    expect(controller.m.scopeTables.map((table) => table.structure)).toEqual([false, true]);
    await userEvent.click(screen.getByRole('button', { name: /数\s*据$/ }));
    expect(controller.m.scopeTables.map((table) => table.data)).toEqual([true, false]);
  });
  it('assigns a stable id to a connection saved directly from the empty management page and invalidates old tree responses', async () => {
    await ready();
    act(() => controller.patch('connectionForm', { name: '新连接', user: 'qa' }));
    await act(async () => {
      await controller.saveConnection();
    });
    const id = controller.m.connectionForm.id;
    expect(id).not.toBe('');
    const old = deferred<string[]>();
    bridge.invoke.mockImplementationOnce(() => old.promise);
    let loading!: Promise<unknown>;
    act(() => {
      loading = controller.loadTree({
        key: id,
        title: '新连接',
        type: 'connection',
        connectionId: id,
      });
    });
    await act(async () => {
      await controller.saveConnection();
    });
    await act(async () => {
      old.resolve(['old_server_database']);
      await loading;
    });
    expect(controller.m.treeChildren[id]).toBeUndefined();
    const saves = bridge.invoke.mock.calls.filter(
      ([method, params]) => method === 'entity.save' && params.kind === 'connection',
    );
    expect(saves.map(([, params]) => params.value.id)).toEqual([id, id]);
  });
  it('keeps nested template drafts independent and preserves a draft after a failed save', async () => {
    await ready();
    act(() => {
      controller.editTemplate(state.templates[0]);
      controller.updateTemplateTable('dict', { keyText: 'code,type' });
      controller.patch('templateForm', { name: '修改后' });
    });
    expect(controller.m.state.templates[0].tables[0].keyColumns).toEqual(['code']);
    expect(controller.m.state.templates[0].name).toBe('模板');
    bridge.invoke.mockImplementationOnce(async () => {
      throw new Error('保存失败');
    });
    await act(async () => {
      await controller.saveTemplate();
    });
    expect(controller.m.templateForm.name).toBe('修改后');
    expect(controller.m.templateForm.tables[0].keyText).toBe('code,type');
    expect(controller.m.state.templates[0].name).toBe('模板');
  });
  it('does not overwrite dirty execution settings during task refresh and can cancel edits', async () => {
    await ready();
    act(() => controller.patch('settingsForm', { concurrency: 9 }));
    state.settings.concurrency = 5;
    await act(async () => {
      await controller.loadState();
    });
    expect(controller.m.settingsForm.concurrency).toBe(9);
    expect(controller.m.state.settings.concurrency).toBe(5);
    act(() => controller.cancelSettings());
    expect(controller.m.settingsForm.concurrency).toBe(5);
    expect(controller.m.settingsDirty).toBe(false);
  });
  it('ignores old source responses and responses from before leaving and returning to a workspace', async () => {
    await ready();
    const first = deferred<{ name: string; comment: string }[]>();
    const second = deferred<{ name: string; comment: string }[]>();
    bridge.invoke.mockImplementation((method: string, params: { ref?: { database: string } }) =>
      method === 'tables.list'
        ? params.ref?.database === 'a'
          ? first.promise
          : second.promise
        : Promise.resolve(structuredClone(state)),
    );
    let loadA!: Promise<unknown>;
    let loadB!: Promise<unknown>;
    act(() => {
      loadA = controller.loadScope('source/a');
      loadB = controller.loadScope('source/b');
    });
    await act(async () => {
      second.resolve([{ name: 'new', comment: '' }]);
      await loadB;
    });
    await act(async () => {
      first.resolve([{ name: 'old', comment: '' }]);
      await loadA;
    });
    expect(controller.m.sourceKey).toBe('source/b');
    expect(controller.m.scopeTables.map((t) => t.name)).toEqual(['new']);
    const prior = deferred<{ name: string; comment: string }[]>();
    const fresh = deferred<{ name: string; comment: string }[]>();
    bridge.invoke
      .mockImplementationOnce(() => prior.promise)
      .mockImplementationOnce(() => fresh.promise);
    act(() => {
      loadA = controller.loadScope('source/a');
      controller.switchWorkspace('second');
      controller.switchWorkspace('default');
      loadB = controller.loadScope('source/a');
    });
    await act(async () => {
      fresh.resolve([{ name: 'fresh', comment: '' }]);
      await loadB;
    });
    await act(async () => {
      prior.resolve([{ name: 'stale', comment: '' }]);
      await loadA;
    });
    expect(controller.m.scopeTables.map((t) => t.name)).toEqual(['fresh']);
  });
  it('loads database and table tree nodes through existing APIs and unsubscribes on unmount', async () => {
    const view = await ready();
    await act(async () => {
      await controller.loadTree({
        key: 'source',
        title: '来源',
        type: 'connection',
        connectionId: 'source',
      });
    });
    const database: TreeNode = controller.m.treeChildren.source[0];
    expect(database.ref).toEqual({ connectionId: 'source', database: 'a' });
    await act(async () => {
      await controller.loadTree(database);
    });
    expect(controller.m.treeChildren['source/a'][0].table).toBe('dict');
    expect(bridge.listeners.size).toBe(2);
    view.unmount();
    expect(bridge.listeners.size).toBe(0);
  });
  it('loads database choices for a newly imported connection without expanding the tree', async () => {
    state.connections[0].databases = [];
    await ready();
    expect(dbOptions(controller.m).map((option) => option.value)).toEqual(['source/a', 'source/b']);
    expect(controller.m.treeChildren).toEqual({});
    await act(async () => {
      await controller.beginSync();
    });
    expect(controller.m.sourceKey).toBe('');
    expect(controller.m.scopeTables).toEqual([]);
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'databases.list')).toHaveLength(
      1,
    );
  });
  it('replaces the current table when another table opens and ignores a refresh for the prior table', async () => {
    await ready();
    const node = (table: string): TreeNode => ({
      key: table,
      title: table,
      type: 'table',
      table,
      ref: { connectionId: 'source', database: 'a' },
    });
    await act(async () => {
      await controller.openTable(node('first'));
    });
    expect(controller.m.currentTable?.table).toBe('first');
    const old = deferred<typeof previewTable>();
    bridge.invoke.mockImplementationOnce(() => old.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = controller.refreshTable();
    });
    await act(async () => {
      await controller.openTable(node('second'));
    });
    await act(async () => {
      old.resolve({ ...previewTable, name: 'stale-first' });
      await refresh;
    });
    expect(controller.m.currentTable?.table).toBe('second');
  });
  it('keeps working database options when another connection fails and retries discovery', async () => {
    state.connections[0].databases = [];
    state.connections.push({ ...state.connections[0], id: 'failed', name: '故障连接' });
    const normal = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (method, params) => {
      if (method === 'databases.list' && params.connectionId === 'failed')
        throw new Error('Access denied');
      return normal(method, params);
    });
    await ready();
    expect(controller.m.dbCache.source).toEqual(['a', 'b']);
    expect(controller.m.dbErrors.failed).toBe('Access denied');
    bridge.invoke.mockImplementation(normal);
    await act(async () => {
      await controller.loadDatabaseOptions(true);
    });
    expect(controller.m.dbErrors.failed).toBe('');
    expect(controller.m.dbCache.failed).toEqual(['a', 'b']);
  });
  it('ignores database discovery from before a workspace switch', async () => {
    await ready();
    const old = deferred<string[]>();
    bridge.invoke.mockImplementationOnce(() => old.promise);
    let loading!: Promise<void>;
    act(() => {
      loading = controller.loadDatabaseOptions(true);
    });
    act(() => controller.switchWorkspace('second'));
    await act(async () => {
      old.resolve(['old_workspace']);
      await loading;
    });
    expect(controller.m.dbCache).toEqual({});
    expect(controller.m.dbLoading).toEqual({});
  });
  it('opens connection editing in a modal, discards cancellation, and keeps failed saves open', async () => {
    await ready(<ConnectionsPage />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('cell', { name: '来源' }));
    const dialog = await screen.findByRole('dialog', { name: '编辑连接' });
    expect(dialog.textContent).not.toContain('删除');
    await userEvent.clear(screen.getByLabelText('连接名称', { exact: true }));
    await userEvent.type(screen.getByLabelText('连接名称', { exact: true }), '未保存');
    await userEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(controller.m.connectionForm.password).toBe('');
    await userEvent.click(screen.getByRole('cell', { name: '来源' }));
    expect(screen.getByLabelText('连接名称', { exact: true }).getAttribute('value')).toBe('来源');
    bridge.invoke.mockRejectedValueOnce(new Error('save failed'));
    await userEvent.click(screen.getByRole('button', { name: '保存连接' }));
    expect(controller.m.connectionDialog).toBe(true);
  }, 15000);
  it('confirms bulk deletion once, deletes only selected connections, and cleans stale selections', async () => {
    state.connections.push({ ...state.connections[0], id: 'other', name: '保留连接' });
    const normal = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (method, params) => {
      if (method === 'entity.delete') {
        state.connections = state.connections.filter((connection) => connection.id !== params.id);
        return { ok: true };
      }
      return normal(method, params);
    });
    await ready(<ConnectionsPage />);
    act(() => {
      controller.set('sourceKey', 'source/a');
      controller.set('targetKeys', ['other/a']);
      controller.set('connectionSelection', ['source']);
    });
    await userEvent.click(screen.getByRole('button', { name: '批量删除（1）' }));
    expect(bridge.invoke.mock.calls.some(([method]) => method === 'entity.delete')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.connections).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: '批量删除（1）' }));
    await userEvent.click(
      screen.getByRole('dialog').querySelector('.ant-btn-dangerous') ||
        screen.getByRole('button', { name: /^删\s*除$/ }),
    );
    await waitFor(() => expect(controller.m.state.connections).toHaveLength(1));
    expect(controller.m.state.connections[0].id).toBe('other');
    expect(controller.m.connectionSelection).toEqual([]);
    expect(controller.m.sourceKey).toBe('');
    expect(controller.m.targetKeys).toEqual(['other/a']);
    expect(controller.m.dbCache.source).toBeUndefined();
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'entity.delete')).toEqual([
      ['entity.delete', { kind: 'connection', id: 'source' }],
    ]);
  });
  it('imports only eligible selected rows, retaining the temporary credential id', async () => {
    await ready();
    const imported = {
      ...state.connections[0],
      id: 'imported',
      name: '导入连接',
      credentialStatus: '需要密码',
      warning: undefined,
    };
    bridge.invoke.mockImplementationOnce(async () => [
      imported,
      { ...imported, id: 'blocked', warning: 'SSH 暂不支持' },
    ]);
    act(() => {
      controller.set('importText', 'sample');
      controller.set('importFileToken', 'file-token');
    });
    await act(async () => {
      await controller.parseImport();
    });
    expect(controller.m.importRows.map((r) => r.selected)).toEqual([true, false]);
    act(() => {
      controller.updateImport('imported', { password: 'fixture-only' });
      controller.set('duplicateMode', 'copy');
    });
    await act(async () => {
      await controller.submitImport();
    });
    const save = bridge.invoke.mock.calls.find(([method]) => method === 'entity.save');
    expect(save?.[1]).toMatchObject({
      kind: 'connection',
      value: {
        id: 'imported',
        importCredentialId: 'imported',
        password: 'fixture-only',
        workspaceIds: ['default'],
      },
    });
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'entity.save')).toHaveLength(1);
    expect(controller.m.importRows).toHaveLength(0);
  });
  it('tests an unsaved import with its entered password and displays success or failure in the row', async () => {
    await ready(<ImportPage />);
    act(() =>
      controller.set('importRows', [
        {
          ...state.connections[0],
          id: 'import-test',
          name: '待导入',
          password: 'entered-fixture',
          credentialStatus: '需要密码',
          selected: true,
        },
      ]),
    );
    const pending = deferred<{ serverVersion: string }>();
    bridge.invoke.mockImplementationOnce(() => pending.promise);
    await userEvent.click(screen.getByRole('button', { name: '测试 待导入 连接' }));
    expect(screen.getByRole('status').textContent).toContain('正在测试连接');
    expect(bridge.invoke).toHaveBeenLastCalledWith('connections.test', {
      config: expect.objectContaining({
        id: 'import-test',
        importCredentialId: 'import-test',
        password: 'entered-fixture',
        host: state.connections[0].host,
        port: 3306,
        user: 'tester',
      }),
    });
    await act(async () => pending.resolve({ serverVersion: '8.4' }));
    expect(screen.getByRole('status').textContent).toContain('连接成功 · 8.4');
    await userEvent.type(screen.getByLabelText('待导入 密码'), '-wrong');
    expect(screen.queryByRole('status')).toBeNull();
    bridge.invoke.mockRejectedValueOnce(new Error('Access denied'));
    await userEvent.click(screen.getByRole('button', { name: '测试 待导入 连接' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('连接失败 · Access denied'),
    );
    bridge.invoke.mockResolvedValueOnce({ serverVersion: '8.4 retry' });
    await userEvent.click(screen.getByRole('button', { name: '测试 待导入 连接' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('连接成功 · 8.4 retry'),
    );
    expect(bridge.invoke.mock.calls.some(([method]) => method === 'entity.save')).toBe(false);
  });
  it('ignores a stale connection test after the password changes and permits retesting with the new password', async () => {
    await ready();
    act(() =>
      controller.set('importRows', [
        {
          ...state.connections[0],
          id: 'import-test',
          credentialStatus: '需要密码',
          selected: true,
          password: 'old',
        },
      ]),
    );
    const old = deferred<{ serverVersion: string }>();
    bridge.invoke.mockImplementationOnce(() => old.promise);
    let first!: Promise<void>;
    act(() => {
      first = controller.testImportConnection('import-test');
    });
    await act(async () => {
      await controller.testImportConnection('import-test');
    });
    expect(
      bridge.invoke.mock.calls.filter(([method]) => method === 'connections.test'),
    ).toHaveLength(1);
    act(() => controller.updateImport('import-test', { password: 'new' }));
    bridge.invoke.mockResolvedValueOnce({ serverVersion: 'new server' });
    await act(async () => {
      await controller.testImportConnection('import-test');
    });
    await act(async () => {
      old.resolve({ serverVersion: 'old server' });
      await first;
    });
    expect(controller.m.importRows[0].connectionTest).toEqual({
      status: 'success',
      message: '连接成功 · new server',
    });
  });
  it('disables connection testing until required fields are complete and validates before saving', async () => {
    await ready(<ConnectionsPage />);
    act(() => controller.editConnection());
    const button = await screen.findByRole('button', { name: '测试连接' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await screen.findByText('请输入连接名称');
    expect(screen.getByText('请输入用户名')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      bridge.invoke.mock.calls.filter(([method]) => method === 'connections.test'),
    ).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('连接名称'), '新连接');
    await userEvent.type(screen.getByLabelText('用户名'), 'tester');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    bridge.invoke.mockResolvedValueOnce({ serverVersion: '8.4' });
    await userEvent.click(button);
    await screen.findByText('连接成功 · 8.4');
    await userEvent.clear(screen.getByLabelText('服务器地址'));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('keeps modal feedback near its footer and shows success or failure icons inside the test button', async () => {
    await ready(<ConnectionsPage />);
    act(() => controller.editConnection(state.connections[0]));
    bridge.invoke.mockResolvedValueOnce({ serverVersion: '8.4' });
    await act(async () => {
      await controller.testConnection();
    });
    expect(
      (await screen.findByText('连接成功 · 8.4')).closest('.connection-dialog-footer'),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: '测试连接' }).querySelector('[aria-label="check"]'),
    ).not.toBeNull();
    bridge.invoke.mockRejectedValueOnce(new Error('Access denied'));
    await act(async () => {
      await controller.testConnection();
    });
    expect(
      (await screen.findByText('连接失败 · Access denied')).closest('.connection-dialog-footer'),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: '测试连接' }).querySelector('[aria-label="close"]'),
    ).not.toBeNull();
    bridge.invoke.mockResolvedValueOnce({ serverVersion: '8.4 retry' });
    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await waitFor(() => expect(controller.m.connectionTest?.status).toBe('success'));
    expect(
      bridge.invoke.mock.calls.filter(([method]) => method === 'connections.test'),
    ).toHaveLength(3);
    act(() => controller.patch('connectionForm', { password: 'changed' }));
    expect(screen.getByRole('button', { name: '测试连接' }).querySelector('.anticon')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('tests a saved connection in its row without opening the editor and clears stale modal results', async () => {
    await ready(<ConnectionsPage />);
    bridge.invoke.mockResolvedValueOnce({ serverVersion: '8.4' });
    await userEvent.click(
      screen.getByRole('button', { name: `测试连接 ${state.connections[0].name}` }),
    );
    await waitFor(() =>
      expect(controller.m.connectionTests[state.connections[0].id]?.status).toBe('success'),
    );
    expect(controller.m.connectionDialog).toBe(false);
    expect(
      screen
        .getByRole('button', { name: `测试连接 ${state.connections[0].name}` })
        .querySelector('[aria-label="check"]'),
    ).not.toBeNull();
    act(() => controller.editConnection(state.connections[0]));
    const pending = deferred<{ serverVersion: string }>();
    bridge.invoke.mockImplementationOnce(() => pending.promise);
    let testing: Promise<void>;
    act(() => {
      testing = controller.testConnection();
    });
    act(() => controller.patch('connectionForm', { password: 'new-password' }));
    await act(async () => {
      pending.resolve({ serverVersion: 'old-server' });
      await testing!;
    });
    expect(controller.m.connectionTest).toBeUndefined();
  });
  it('renders half selection and disables blocked changes using the real Ant Design checkbox', async () => {
    await ready(<DiffPage />);
    const plan = structuredClone(previewPlan);
    plan.targets[0].changes.push({
      ...plan.targets[0].changes[0],
      id: 'blocked-fixture',
      blocked: true,
      reason: '后续变更冲突',
    });
    const candidates = plan.targets
      .flatMap((t) => t.changes)
      .filter((ch) => !ch.blocked && !ch.kind.endsWith('_ROW'));
    act(() =>
      controller.commit((s) => ({ ...s, plan, selectedIds: [candidates[0].id], page: 'diff' })),
    );
    await waitFor(() =>
      expect(document.querySelector('.ant-checkbox-indeterminate')).not.toBeNull(),
    );
    const checkbox = screen.getByRole('checkbox', { name: `选择 ${plan.targets[0].ref.database}` });
    await userEvent.click(checkbox);
    const eligible = plan.targets[0].changes
      .filter((ch) => !ch.blocked && !ch.kind.endsWith('_ROW'))
      .map((ch) => ch.id);
    expect(selection(controller.m.selectedIds, eligible).checked).toBe(true);
    expect(document.querySelector('input[type="checkbox"]:disabled')).not.toBeNull();
  });
  it('shows database and table summaries, highlights the inspected row and compares source first', async () => {
    await ready(<DiffPage />);
    const plan = structuredClone(previewPlan);
    act(() =>
      controller.commit((s) => ({
        ...s,
        plan,
        selectedIds: ['c1'],
        currentChangeId: 'c2',
        page: 'diff',
      })),
    );
    await screen.findByText('修改了：数据类型、注释');
    expect(screen.queryByText('变更内容', { selector: 'th' })).toBeNull();
    const modifiedRow = screen.getByRole('checkbox', { name: '选择 dict_name' }).closest('tr')!;
    const modifiedCell = within(modifiedRow).getByText('修改字段').closest('td')!;
    expect(within(modifiedCell).getByText('数据类型、注释')).toBeTruthy();
    const header = screen.getByText('源库定义', { selector: 'th' }).closest('tr')!;
    expect(
      within(header)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent!.replace(/调整.*宽度/, '')),
    ).toEqual(['属性', '源库定义', '目标库现状', '差异']);
    const row = screen.getByText('varchar(64)', { exact: true }).closest('tr')!;
    expect(row.classList.contains('difference-row')).toBe(true);
    const tableRow = screen.getByRole('checkbox', { name: '选择 sys_dict' }).closest('tr')!;
    fireEvent.click(within(tableRow).getByText('sys_dict'));
    await screen.findByRole('heading', { name: 'shop_a / sys_dict · 全部差异' });
    expect(tableRow.getAttribute('aria-selected')).toBe('true');
    expect(controller.m.selectedIds).toEqual(['c1']);
    // Table summary includes data changes while the main tree remains on the structure tab.
    expect(screen.getByText('code = ORDER_STATUS').closest('tr')!.textContent).toBeTruthy();
    const dbRow = screen.getByRole('checkbox', { name: '选择 shop_a' }).closest('tr')!;
    fireEvent.click(within(dbRow).getByText('shop_a'));
    await screen.findByRole('heading', { name: 'shop_a · 全部差异' });
    expect(dbRow.getAttribute('aria-selected')).toBe('true');
    expect(tableRow.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByText('code = ORDER_STATUS'));
    await screen.findByRole('heading', { name: 'shop_a / sys_dict / code = ORDER_STATUS' });
    expect(controller.m.diffTab).toBe('data');
    expect(document.querySelector('tr[aria-selected="true"]')?.textContent).toContain(
      'code = ORDER_STATUS',
    );
    expect(screen.queryByRole('button', { name: '新建同步' })).toBeNull();
    expect(screen.queryByRole('button', { name: /更\s*多/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(controller.m.page).toBe('scope');
  }, 15000);
  it('shows the effective planned definition for a comment-only change rather than unselected source attributes', async () => {
    await ready(<DiffPage />);
    const plan = structuredClone(previewPlan);
    const target = plan.targets[0];
    const change = target.changes.find((item) => item.id === 'c2')!;
    const original = target.before.sys_dict.columns.find((column) => column.name === 'dict_name')!;
    change.after = {
      column: {
        ...original,
        comment: '字典名称',
        definition: "`dict_name` varchar(64) NOT NULL COMMENT '字典名称'",
      },
    };
    change.changedParts = ['columnComments'];
    change.sql =
      "ALTER TABLE `shop_a`.`sys_dict` MODIFY COLUMN `dict_name` varchar(64) NOT NULL COMMENT '字典名称';";
    act(() => controller.commit((s) => ({ ...s, plan, currentChangeId: change.id, page: 'diff' })));
    await screen.findByText('修改了：注释');
    expect(screen.getByText('本次计划定义', { selector: 'th' })).toBeTruthy();
    const type = screen.getByText('数据类型', { selector: 'td' }).closest('tr')!;
    expect(within(type).getAllByText('varchar(64)')).toHaveLength(2);
    expect(type.classList.contains('difference-row')).toBe(false);
    expect(screen.queryByText('varchar(100)', { exact: true })).toBeNull();
  });
  it('keeps a missing-table blocker visible on the data tab and explains the create-table option', async () => {
    await ready(<DiffPage />);
    const plan = structuredClone(previewPlan);
    const target = plan.targets[2];
    const create = target.changes[0];
    act(() => controller.commit((s) => ({ ...s, plan, currentChangeId: create.id, page: 'diff' })));
    await screen.findByText('目标表不存在，将先创建表');
    const blocked = {
      ...create,
      id: 'missing-table',
      kind: 'BLOCKED',
      label: '目标表不存在',
      blocked: true,
      sql: '',
      reason: '请启用表结构同步或先创建目标表',
    };
    target.changes = [blocked];
    act(() =>
      controller.commit((s) => ({
        ...s,
        plan: structuredClone(plan),
        diffTab: 'data',
        currentChangeId: blocked.id,
      })),
    );
    await screen.findByText('请启用表结构同步或先创建目标表');
    expect(
      screen.getByRole('checkbox', { name: '选择 目标表不存在' }).getAttribute('disabled'),
    ).not.toBeNull();
  });
  it.each(['ADD_ROW', 'DELETE_ROW'])(
    'distinguishes a missing row from SQL NULL for %s',
    async (kind) => {
      await ready(<DiffPage />);
      const plan = structuredClone(previewPlan);
      const values = { code: 'NULL_FIXTURE', remark: null };
      const change = {
        ...plan.targets[0].changes[0],
        id: 'null-row',
        kind,
        label: 'NULL_FIXTURE',
        before: kind === 'DELETE_ROW' ? values : {},
        after: kind === 'ADD_ROW' ? values : {},
      };
      plan.targets[0].changes = [change];
      act(() =>
        controller.commit((s) => ({
          ...s,
          plan,
          currentChangeId: change.id,
          diffTab: 'data',
          page: 'diff',
        })),
      );
      const row = (await screen.findByText('remark', { exact: true })).closest('tr')!;
      const cells = within(row).getAllByRole('cell');
      expect(cells.slice(1, 3).map((cell) => cell.textContent)).toEqual(
        kind === 'ADD_ROW' ? ['NULL', '不存在该行'] : ['不存在该行', 'NULL'],
      );
      expect(row.classList.contains('difference-row')).toBe(true);
    },
  );
  it.each(['SAVE_ONLY', 'EXECUTE_AND_SAVE'])(
    'requires creating a missing table before confirming %s',
    async (mode) => {
      await ready();
      const plan = structuredClone(previewPlan);
      const target = plan.targets[2];
      const create = target.changes[0];
      const row = {
        ...create,
        id: 'missing-table-data',
        kind: 'ADD_ROW',
        label: 'id = 1',
        after: { id: 1 },
        sql: 'INSERT INTO `shop_c`.`sys_user` (`id`) VALUES (1);',
      };
      target.changes.push(row);
      act(() => controller.commit((s) => ({ ...s, plan, selectedIds: [row.id] })));
      await act(async () => {
        await controller.saveSync(mode);
      });
      await screen.findByText('目标库 shop_c 的 sys_user 不存在，请同时选中创建表操作');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(bridge.invoke.mock.calls.some(([method]) => method === 'sync.save')).toBe(false);
      act(() => controller.set('selectedIds', [row.id, create.id]));
      let pending!: Promise<void>;
      act(() => {
        pending = controller.saveSync(mode);
      });
      const dialog = await screen.findByRole('dialog');
      const sql = within(dialog).getByRole('region', { name: '本次执行脚本' }).textContent!;
      expect(sql.indexOf('CREATE TABLE')).toBeLessThan(sql.indexOf('INSERT INTO'));
      await userEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
      await act(async () => {
        await pending;
      });
      expect(bridge.invoke.mock.calls.some(([method]) => method === 'sync.save')).toBe(false);
    },
  );
  it('confirms source and selected target databases before execution, permits cancellation and prevents duplicate dialogs', async () => {
    await ready();
    const plan = structuredClone(previewPlan);
    plan.source = { connectionId: 'source', database: 'a' };
    plan.targets[0].ref = { connectionId: 'source', database: 'b' };
    act(() => controller.commit((s) => ({ ...s, plan, selectedIds: ['c1'] })));
    let pending!: Promise<void>;
    act(() => {
      pending = controller.saveSync('EXECUTE_AND_SAVE');
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('region', { name: '来源数据库' }).textContent).toContain(
      'a来源192.0.2.10:3306',
    );
    expect(within(dialog).getByRole('region', { name: '目标数据库' }).textContent).toContain(
      'b来源192.0.2.10:3306',
    );
    expect(within(dialog).getByText('其余 2 个目标库没有已选变更，本次不执行。')).toBeTruthy();
    await act(async () => {
      await controller.saveSync('EXECUTE_AND_SAVE');
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'sync.save')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    await act(async () => {
      await pending;
    });
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'sync.save')).toHaveLength(0);
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (method, params) =>
      method === 'sync.save'
        ? Promise.reject(new Error('execution fixture'))
        : original(method, params),
    );
    act(() => {
      pending = controller.saveSync('EXECUTE_AND_SAVE');
    });
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await act(async () => {
      await pending;
    });
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'sync.save')).toEqual([
      ['sync.save', { planId: plan.id, selectedIds: ['c1'], mode: 'EXECUTE_AND_SAVE', remark: '' }],
    ]);
  });
  it('previews scripts before saving only, permits cancellation and never requests execution', async () => {
    await ready();
    act(() =>
      controller.commit((s) => ({ ...s, plan: structuredClone(previewPlan), selectedIds: ['c1'] })),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = controller.saveSync('SAVE_ONLY');
    });
    const dialog = await screen.findByRole('dialog', { name: '预览并保存同步脚本' });
    expect(dialog.querySelector('code')!.textContent).toContain(
      previewPlan.targets[0].changes[0].sql,
    );
    expect(within(dialog).getByText(/本次不会执行数据库操作/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    await act(async () => {
      await pending;
    });
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'sync.save')).toHaveLength(0);
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (method, params) =>
      method === 'sync.save' ? Promise.reject(new Error('save fixture')) : original(method, params),
    );
    act(() => {
      pending = controller.saveSync('SAVE_ONLY');
    });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await act(async () => {
      await pending;
    });
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'sync.save')).toEqual([
      ['sync.save', { planId: previewPlan.id, selectedIds: ['c1'], mode: 'SAVE_ONLY', remark: '' }],
    ]);
  });
  it('directly displays the archived execution SQL and loads rollback SQL in its own tab', async () => {
    const original = bridge.invoke.getMockImplementation()!;
    const detail = {
      record: {
        id: 'record-sql',
        workspaceId: 'default',
        createdAt: '',
        mode: 'SAVE_ONLY',
        status: 'UNEXECUTED',
        remark: '',
        parentId: '',
        archivePath: '',
        plan: structuredClone(previewPlan),
        selectedIds: ['c1'],
        results: [],
      },
      files: [
        'README.txt',
        'hash-shop_a/target.json',
        'hash-shop_a/02_sync.sql',
        'hash-shop_a/04_rollback.sql',
      ],
      events: [],
      external: {},
    };
    bridge.invoke.mockImplementation(async (method, params) => {
      if (method === 'record.get') return structuredClone(detail);
      if (method === 'record.file') {
        if (String(params?.file).endsWith('target.json'))
          return JSON.stringify({ connectionId: 'source', database: 'shop_a' });
        return String(params?.file).endsWith('04_rollback.sql')
          ? 'ALTER TABLE t DROP COLUMN remark;'
          : 'ALTER TABLE t ADD COLUMN remark INT;';
      }
      return original(method, params);
    });
    await ready(<RecordPage />);
    await act(async () => {
      await controller.openRecord('record-sql');
    });
    const execution = screen.getByRole('region', { name: 'shop_a 执行脚本' });
    expect(execution.querySelector('code')!.textContent).toBe(
      'ALTER TABLE t ADD COLUMN remark INT;',
    );
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '执行脚本',
      '回滚脚本',
      '执行结果',
      '外部执行校验',
    ]);
    expect(screen.queryByText('README.txt')).toBeNull();
    expect(
      bridge.invoke.mock.calls
        .filter(([method]) => method === 'record.file')
        .map(([, params]) => params?.file),
    ).toEqual(['hash-shop_a/target.json', 'hash-shop_a/02_sync.sql']);
    fireEvent.click(screen.getByRole('tab', { name: '回滚脚本' }));
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'shop_a 回滚脚本' }).querySelector('code')!.textContent,
      ).toBe('ALTER TABLE t DROP COLUMN remark;'),
    );
    expect(screen.queryByRole('region', { name: 'shop_a 执行脚本' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '执行脚本' }));
    expect(
      screen.getByRole('region', { name: 'shop_a 执行脚本' }).querySelector('code')!.textContent,
    ).toBe('ALTER TABLE t ADD COLUMN remark INT;');
  });
  it('does not execute a plan when its selection changed during confirmation', async () => {
    await ready();
    act(() =>
      controller.commit((s) => ({ ...s, plan: structuredClone(previewPlan), selectedIds: ['c1'] })),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = controller.saveSync('EXECUTE_AND_SAVE');
    });
    await screen.findByRole('dialog');
    act(() => controller.set('selectedIds', ['c3']));
    await userEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await act(async () => {
      await pending;
    });
    await screen.findByText('同步范围已改变，请重新确认后执行');
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'sync.save')).toHaveLength(0);
  });
  it('updates all surfaces from appearance events without touching execution settings', async () => {
    await ready();
    const settings = controller.m.state.settings;
    await act(async () => {
      await appearanceControls.changeTheme('dark');
    });
    expect(document.querySelector('[data-theme]')?.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--surface')).not.toBe('');
    expect(controller.m.state.settings).toBe(settings);
    act(() =>
      emit({
        event: 'appearance-changed',
        appearance: { themeMode: 'system', resolvedTheme: 'light' },
      }),
    );
    expect(document.querySelector('[data-theme]')?.getAttribute('data-theme')).toBe('light');
  });
  it('shows one running-task close dialog and handles both cancel and confirm', async () => {
    await ready();
    state.records = [
      {
        id: 'running',
        workspaceId: 'default',
        createdAt: '',
        mode: 'EXECUTE_AND_SAVE',
        status: 'RUNNING',
        remark: '',
        parentId: '',
        archivePath: '',
        selectedIds: [],
        results: [],
      },
    ];
    act(() => {
      emit({ event: 'window-close-request' });
      emit({ event: 'window-close-request' });
    });
    await screen.findByText('有同步任务正在执行。关闭客户端会中断任务，重启后需要核验实际状态。');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(bridge.window).toHaveBeenCalledWith('close-cancelled'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => emit({ event: 'window-close-request' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: /^关\s*闭$/ }));
    await waitFor(() => expect(bridge.window).toHaveBeenCalledWith('close-confirmed'));
  });
});

describe('new sync sessions and progress summaries', () => {
  it('resets temporary state without removing saved history and ignores old scope responses', async () => {
    await ready();
    const delayed = deferred<{ name: string; comment: string }[]>();
    bridge.invoke.mockImplementationOnce(() => delayed.promise);
    let loading!: Promise<boolean | undefined>;
    act(() => {
      loading = controller.loadScope('source/a');
    });
    act(() =>
      controller.commit((s) => ({
        ...s,
        targetKeys: ['source/b'],
        plan: structuredClone(previewPlan),
        selectedIds: ['c1'],
        scopeRemark: 'old',
        tableSearch: 'old',
        diffSearch: 'old',
        currentChangeId: 'c1',
        compareTask: {
          compareId: 'old',
          status: 'COMPLETED',
          progress: { table: 'old', phase: '生成差异', completed: 2, total: 2, rows: 0 },
        },
      })),
    );
    const history = controller.m.state.records;
    await act(async () => {
      await controller.beginSync();
    });
    await act(async () => {
      delayed.resolve([{ name: 'stale', comment: '' }]);
      await loading;
    });
    expect(controller.m.sourceKey).toBe('');
    expect(controller.m.targetKeys).toEqual([]);
    expect(controller.m.scopeTables).toEqual([]);
    expect(controller.m.plan).toBeUndefined();
    expect(controller.m.compareTask).toBeUndefined();
    expect(controller.m.scopeRemark).toBe('');
    expect(controller.m.diffSearch).toBe('');
    expect(controller.m.state.records).toEqual(history);
  });
  it('starts contextual sync fresh and loads only the requested table mode', async () => {
    await ready();
    act(() => controller.set('targetKeys', ['source/a']));
    await act(async () => {
      await controller.beginSync(
        {
          key: 'source/b/dict',
          title: 'dict',
          type: 'table',
          ref: { connectionId: 'source', database: 'b' },
          table: 'dict',
        },
        'data',
      );
    });
    expect(controller.m.sourceKey).toBe('source/b');
    expect(controller.m.targetKeys).toEqual([]);
    expect(controller.m.scopeTables[0]).toMatchObject({
      name: 'dict',
      structure: false,
      data: true,
    });
  });
  it('renders whole-comparison results instead of the last processed table', async () => {
    await ready(<CompareProgressPanel />);
    const plan = structuredClone(previewPlan);
    act(() =>
      controller.commit((s) => ({
        ...s,
        page: 'diff',
        plan,
        compareStartedAt: Date.now() - 2000,
        compareFinishedAt: Date.now(),
        compareTask: {
          compareId: 'done',
          status: 'COMPLETED',
          progress: {
            table: 'last_table_sentinel',
            phase: '生成差异',
            ref: plan.targets[0].ref,
            completed: 12,
            total: 12,
            rows: 0,
          },
        },
      })),
    );
    expect(screen.getByText('比较完成')).toBeTruthy();
    const panel = screen.getByRole('region', { name: '比较进度' });
    expect(panel.textContent).toContain('已比较 3 张表');
    expect(panel.textContent).not.toContain('last_table_sentinel');
    expect(panel.textContent).not.toContain('读取 0 行');
    act(() =>
      controller.commit((s) => ({
        ...s,
        plan: {
          ...plan,
          targets: plan.targets.map((target, i) =>
            i === 0 ? { ...target, error: 'offline', changes: [] } : target,
          ),
        },
      })),
    );
    expect(screen.getByText('比较结束，部分目标库失败')).toBeTruthy();
  });
  it('labels the current source database and hides row counters for structure reads', async () => {
    await ready(<CompareProgressPanel />);
    act(() =>
      controller.commit((s) => ({
        ...s,
        compareScope: {
          workspaceId: 'default',
          sourceKey: 'source/a',
          targetKeys: ['source/b'],
          tables: [{ name: 'dict', structure: true, data: false, comment: '', keyColumns: [] }],
          structureDefaults: allStructureOptions,
        },
        compareTask: {
          compareId: 'running',
          status: 'RUNNING',
          progress: {
            table: 'dict',
            phase: '读取源表结构',
            ref: { connectionId: 'source', database: 'a' },
            completed: 0,
            total: 2,
            rows: 0,
          },
        },
      })),
    );
    expect(screen.getByText(/当前处理：源库 来源 \/ a \/ dict/)).toBeTruthy();
    expect(screen.queryByText(/当前阶段已读取/)).toBeNull();
  });
});

describe('connection port input', () => {
  it('preserves out-of-range raw text on blur and Enter and prevents testing and saving', async () => {
    await ready(<ConnectionsPage />);
    await userEvent.click(screen.getByRole('cell', { name: '来源' }));
    const port = screen.getByLabelText('端口') as HTMLInputElement;
    expect(port.value).toBe('3306');
    await userEvent.clear(port);
    await userEvent.type(port, '33063306');
    await userEvent.keyboard('{Enter}{Tab}');
    expect(port.value).toBe('33063306');
    expect(controller.m.connectionForm.port).toBe(0);
    expect(await screen.findByText('请输入 1–65535 的整数端口')).toBeTruthy();
    expect(screen.getByRole('button', { name: '测试连接' }).hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '保存连接' }));
    expect(bridge.invoke.mock.calls.some(([method]) => method === 'entity.save')).toBe(false);
    await userEvent.clear(port);
    await userEvent.type(port, '13306');
    await userEvent.tab();
    await userEvent.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() =>
      expect(
        bridge.invoke.mock.calls.find(([method]) => method === 'entity.save')?.[1],
      ).toMatchObject({ value: { port: 13306 } }),
    );
    expect(controller.m.state.connections[0].port).toBe(3306);
  }, 15000);
  it('reinitializes canceled edits and new connections without clamping valid 65535', async () => {
    await ready(<ConnectionsPage />);
    act(() => controller.editConnection({ ...controller.m.state.connections[0], port: 65535 }));
    expect(((await screen.findByLabelText('端口')) as HTMLInputElement).value).toBe('65535');
    await userEvent.clear(screen.getByLabelText('端口'));
    await userEvent.type(screen.getByLabelText('端口'), '12345');
    await userEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => controller.editConnection());
    expect(((await screen.findByLabelText('端口')) as HTMLInputElement).value).toBe('3306');
  }, 15000);
});

it('renders one version empty state and links to saved synchronization records', async () => {
  await ready(<HistoryPage />);
  act(() => controller.set('historyTab', 'versions'));
  expect(screen.getByText('暂无版本')).toBeTruthy();
  expect(document.querySelectorAll('.ant-empty')).toHaveLength(1);
  expect(screen.queryByText('选择版本查看详情')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '前往同步记录' }));
  expect(controller.m.historyTab).toBe('records');
});

it('silently saves drag moves and retains the existing order when a drag save fails', async () => {
  await ready();
  const groupId = controller.m.state.connectionGroups[0].id;
  const originalConnections = structuredClone(controller.m.state.connections);
  bridge.invoke.mockResolvedValueOnce({ ok: true });
  await act(async () => controller.moveConnection('source', groupId, 'last', undefined, true));
  expect(bridge.invoke).toHaveBeenCalledWith('connections.move', {
    connectionId: 'source',
    groupId,
    placement: 'last',
    anchorConnectionId: undefined,
  });
  expect(document.querySelector('.ant-message-notice')).toBeNull();
  bridge.invoke.mockRejectedValueOnce(new Error('拖拽保存失败'));
  await act(async () => controller.moveConnection('source', groupId, 'last', undefined, true));
  expect(document.querySelector('.ant-message-notice')).toBeNull();
  expect(controller.m.state.connections).toEqual(originalConnections);
  expect(controller.m.organizationSaving).toBe(false);
});

describe('export preview retention', () => {
  const exportNode: TreeNode = {
    key: 'source/a/dict',
    title: 'dict',
    type: 'table',
    ref: { connectionId: 'source', database: 'a' },
    table: 'dict',
  };
  it('clears generated SQL when options, selection or source change, and replaces it after regeneration', async () => {
    await ready();
    await act(async () => controller.beginExport(exportNode));
    bridge.invoke.mockResolvedValueOnce({ sql: 'CREATE TABLE `dict` (`id` int);' });
    await act(async () => controller.updateExport());
    expect(controller.m.exportSql).not.toBe('');
    act(() => {
      controller.setIncludeDrop(true);
      controller.selectExport([]);
    });
    expect(controller.m.exportSql).toBe('');
    expect(controller.m.exportPreview).toBeUndefined();
    await act(async () => controller.loadExport('source/b', 'dict'));
    expect(controller.m.exportSql).toBe('');
    const replacement = deferred<{ sql: string }>();
    bridge.invoke.mockReturnValueOnce(replacement.promise);
    let generating!: Promise<void>;
    act(() => {
      generating = controller.updateExport();
    });
    expect(controller.m.exportSql).toBe('');
    await act(async () => {
      replacement.resolve({ sql: 'DROP TABLE `dict`; CREATE TABLE `dict` (`id` bigint);' });
      await generating;
    });
    expect(controller.m.exportSql).toContain('DROP TABLE');
    expect(controller.m.exportPreview).toEqual({
      source: 'source/b',
      tables: ['dict'],
      includeDrop: true,
    });
    act(() => controller.navigate('history'));
    expect(controller.m.exportSql).toBe('');
    expect(controller.m.exportPreview).toBeUndefined();
  });
  it('discards an in-flight result after leaving and reentering the export page', async () => {
    await ready();
    await act(async () => controller.beginExport(exportNode));
    const pending = deferred<{ sql: string }>();
    bridge.invoke.mockReturnValueOnce(pending.promise);
    let generating!: Promise<void>;
    act(() => {
      generating = controller.updateExport();
    });
    act(() => controller.navigate('history'));
    await act(async () => controller.beginExport(exportNode));
    await act(async () => {
      pending.resolve({ sql: 'STALE SQL' });
      await generating;
    });
    expect(controller.m.exportSql).toBe('');
    expect(controller.m.exportGenerating).toBe(false);
  });
});

describe('missing target tables in the sync scope', () => {
  async function scope() {
    await ready(
      <>
        <ScopePage />
        <CompareConfirmation />
      </>,
    );
    act(() =>
      controller.commit((s) => ({
        ...s,
        sourceKey: 'source/a',
        scopeTables: ['dict', 'orders'].map((name) => ({
          name,
          comment: '',
          structure: false,
          data: false,
          keyColumns: [],
          keyText: '',
          structureOptions: { ...allStructureOptions },
        })),
      })),
    );
  }

  it('completes partial structure only for newly enabled data and preserves later overrides', async () => {
    await scope();
    await act(async () => controller.setTargets(['source/b']));
    act(() =>
      controller.updateScope('orders', {
        structure: true,
        structureOptions: { ...allStructureOptions, indexes: false },
      }),
    );
    act(() => controller.updateScope('orders', { data: true }));
    expect(controller.m.scopeTables[1].structureOptions).toEqual(allStructureOptions);
    act(() => controller.updateScope('orders', { structure: false }));
    act(() => controller.updateScope('dict', { data: true }));
    await act(async () => controller.loadTargetTables(true));
    expect(controller.m.scopeTables[1].structure).toBe(false);
    await act(async () => controller.compare());
    expect(screen.getByText(/仅数据同步无法写入/)).toBeTruthy();
  });

  it('deduplicates target reads and ignores completion after scope reset', async () => {
    await scope();
    const pending = deferred<{ name: string }[]>();
    bridge.invoke.mockReturnValueOnce(pending.promise);
    let first!: Promise<void>, second!: Promise<void>;
    act(() => {
      first = controller.setTargets(['source/b']);
      second = controller.setTargets(['source/b']);
    });
    expect(bridge.invoke.mock.calls.filter(([method]) => method === 'tables.list')).toHaveLength(1);
    await act(async () => controller.beginSync());
    await act(async () => {
      pending.resolve([]);
      await Promise.all([first, second]);
    });
    expect(controller.m.targetTables).toEqual({});
    expect(controller.m.targetTablesLoading).toEqual({});
  });

  it('keeps manual structure edits made during an in-flight target read', async () => {
    await scope();
    const pending = deferred<{ name: string }[]>();
    bridge.invoke.mockReturnValueOnce(pending.promise);
    let loading!: Promise<void>;
    act(() => {
      loading = controller.setTargets(['source/b']);
      controller.updateScope('orders', { data: true });
    });
    act(() => controller.updateScope('orders', { structure: false }));
    await act(async () => {
      pending.resolve([]);
      await loading;
    });
    expect(controller.m.scopeTables[1].structure).toBe(false);
    expect(controller.missingTargets('orders')).toEqual(['source/b']);
  });

  it('clears failed refresh data, exposes retry, and invalidates changed connections', async () => {
    await scope();
    await act(async () => controller.setTargets(['source/b']));
    expect(controller.missingTargets('orders')).toEqual(['source/b']);
    bridge.invoke.mockRejectedValueOnce(new Error('目标不可达'));
    await act(async () => controller.loadTargetTables(true));
    expect(controller.missingTargets('orders')).toEqual([]);
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.getByText('来源 / b：目标不可达')).toBeTruthy();
    await act(async () => controller.loadTargetTables(true));
    expect(controller.missingTargets('orders')).toEqual(['source/b']);
    state.connections[0].port = 13306;
    await act(async () => controller.loadState());
    expect(controller.missingTargets('orders')).toEqual([]);
  });

  it('clears an obsolete loading state on configuration change and rejects its late response', async () => {
    await scope();
    const pending = deferred<{ name: string }[]>();
    bridge.invoke.mockReturnValueOnce(pending.promise);
    let loading!: Promise<void>;
    act(() => {
      loading = controller.setTargets(['source/b']);
    });
    expect(controller.m.targetTablesLoading['source/b']).toBe(true);
    state.connections[0].port = 13306;
    await act(async () => controller.loadState());
    expect(controller.m.targetTablesLoading['source/b']).toBeUndefined();
    await act(async () => controller.loadTargetTables(true));
    await act(async () => {
      pending.resolve([{ name: 'orders' }]);
      await loading;
    });
    expect(controller.missingTargets('orders')).toEqual(['source/b']);
    expect(controller.m.targetTablesLoading['source/b']).toBe(false);
  });

  it('normalizes missing data tables from templates and distinguishes structure-only and partial selections', async () => {
    await scope();
    await act(async () =>
      controller.applyTemplate({
        ...state.templates[0],
        tables: [
          {
            name: 'dict',
            data: true,
            structure: true,
            keyColumns: [],
            structureOptions: { ...allStructureOptions, columns: false },
          },
        ],
      }),
    );
    expect(controller.m.scopeTables[0].structureOptions?.columns).toBe(false); // Existing target table.
    bridge.invoke.mockResolvedValueOnce([]);
    await act(async () => controller.loadTargetTables(true));
    expect(controller.m.scopeTables[0].structureOptions).toEqual(allStructureOptions);
    act(() => {
      controller.updateScope('dict', { data: false });
      controller.compare();
    });
    expect(screen.getByText(/将创建表$/)).toBeTruthy();
    act(() => {
      controller.dismissCompareConfirmation();
      controller.updateScope('dict', {
        structureOptions: { ...allStructureOptions, columns: false },
      });
      controller.compare();
    });
    expect(screen.getByText(/结构细项不足/)).toBeTruthy();
  });
  it('flags tables missing in targets, auto-enables full structure for data sync, and annotates the confirmation', async () => {
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (method, params) => {
      if (method === 'tables.list') {
        const database = (params as { ref?: { database?: string } }).ref?.database;
        return database === 'b'
          ? [{ name: 'dict', comment: '' }]
          : [
              { name: 'dict', comment: '' },
              { name: 'orders', comment: '' },
            ];
      }
      return original(method, params);
    });
    await ready(
      <>
        <ScopePage />
        <CompareConfirmation />
      </>,
    );
    act(() =>
      controller.commit((s) => ({
        ...s,
        sourceKey: 'source/a',
        scopeTables: ['dict', 'orders'].map((name) => ({
          name,
          comment: '',
          structure: false,
          data: false,
          keyColumns: [],
          keyText: '',
          structureOptions: { ...allStructureOptions },
        })),
      })),
    );
    await act(async () => {
      await controller.setTargets(['source/b']);
    });
    expect(controller.missingTargets('orders')).toEqual(['source/b']);
    expect(controller.missingTargets('dict')).toEqual([]);
    await act(async () => {
      controller.updateScope('orders', { data: true });
    });
    const orders = controller.m.scopeTables.find((t) => t.name === 'orders')!;
    expect(orders.structure).toBe(true);
    expect(orders.structureOptions).toEqual(allStructureOptions);
    // 目标库存在该表时不自动扩展范围。
    await act(async () => {
      controller.updateScope('dict', { data: true });
    });
    expect(controller.m.scopeTables.find((t) => t.name === 'dict')!.structure).toBe(false);
    // 用户随后手动取消结构不被回改；引擎与确认弹窗仍按缺表规则提示。
    await act(async () => {
      controller.updateScope('orders', { structure: false });
    });
    expect(controller.m.scopeTables.find((t) => t.name === 'orders')!.structure).toBe(false);
    await act(async () => {
      controller.updateScope('orders', { structure: true });
      controller.compare();
    });
    const pending = controller.m.compareConfirmation!;
    expect(pending.tables.find((t) => t.name === 'orders')?.missingTargets).toEqual(['source/b']);
    expect(pending.tables.find((t) => t.name === 'dict')?.missingTargets).toEqual([]);
    expect(await screen.findByText(/将创建表并复制全部数据/)).toBeTruthy();
    expect(screen.queryByText(/仅数据同步无法写入/)).toBeNull();
  });
});

describe('group editing and creation', () => {
  it('opens editing first and offers creation inside the group dialog', async () => {
    await ready(
      <>
        <ConnectionsPage />
        <ConnectionOrganizationDialogs />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: '编辑分组' }));
    expect(controller.m.groupForm?.name).toBe('测试');
    expect(document.querySelector('.anticon-edit')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '新增分组' }));
    expect(controller.m.groupForm).toBeUndefined();
    expect((screen.getByLabelText('分组名称') as HTMLInputElement).value).toBe('');
  });

  it('creates from the group dropdown, preserves connection fields and keeps failed input for retry', async () => {
    const original = bridge.invoke.getMockImplementation()!;
    let attempts = 0;
    bridge.invoke.mockImplementation(async (method, params) => {
      if (method === 'connectionGroups.save') {
        if (++attempts === 1) throw new Error('分组保存失败');
        const group = { id: 'created', name: (params as { name: string }).name, sortOrder: 1 };
        state.connectionGroups.push(group);
        return group;
      }
      return original(method, params);
    });
    await ready(<ConnectionsPage />);
    act(() => {
      controller.editConnection(state.connections[0]);
      controller.patch('connectionForm', { password: 'draft-password', host: '192.0.2.99' });
    });
    expect(screen.queryByRole('button', { name: '新增分组' })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '连接分组' }));
    await userEvent.type(await screen.findByLabelText('新增连接分组名称'), '新测试组');
    await userEvent.click(screen.getByRole('button', { name: /^新增$/ }));
    await screen.findByText('分组保存失败');
    expect((screen.getByLabelText('新增连接分组名称') as HTMLInputElement).value).toBe('新测试组');
    await userEvent.click(screen.getByRole('button', { name: /^新增$/ }));
    await waitFor(() => expect(controller.m.connectionForm.group).toBe('新测试组'));
    expect(controller.m.connectionForm).toMatchObject({
      host: '192.0.2.99',
      password: 'draft-password',
    });
    expect(state.connections[0].group).toBe('测试');
  });

  it('ignores late selection updates after reopening a connection and prevents duplicate creation', async () => {
    await ready();
    act(() => controller.editConnection(state.connections[0]));
    const pending = deferred<{ id: string; name: string; sortOrder: number }>();
    bridge.invoke.mockReturnValueOnce(pending.promise);
    let creating!: Promise<boolean>;
    act(() => {
      creating = controller.addConnectionGroup('新组');
    });
    await act(async () => {
      expect(await controller.addConnectionGroup('重复')).toBe(false);
      controller.closeConnection();
      controller.editConnection(state.connections[0]);
    });
    await act(async () => {
      pending.resolve({ id: 'new', name: '新组', sortOrder: 1 });
      await creating;
    });
    expect(controller.m.connectionForm.group).toBe('测试');
    expect(
      bridge.invoke.mock.calls.filter(([method]) => method === 'connectionGroups.save'),
    ).toHaveLength(1);
  });
});

it('prefers local rollback scripts independently for each target and retains legacy fallback', () => {
  expect(
    recordScriptFiles(
      ['a/04_rollback.sql', 'a/05_rollback_local.sql', 'b/04_rollback.sql', 'a/02_sync.sql'],
      'rollbackScripts',
    ),
  ).toEqual(['a/05_rollback_local.sql', 'b/04_rollback.sql']);
});
