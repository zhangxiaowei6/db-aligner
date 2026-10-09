// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider, useAppearance } from './appearance';
import { BusinessProvider, useController, type Controller } from './controller';
import { initialModel, selection, type TreeNode } from './model';
import { previewPlan, previewTable } from './preview';
import { DiffPage } from './pages/Sync';
import type { Appearance, State, SyncTemplate } from './types';

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

describe('React business state and protocol', () => {
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
