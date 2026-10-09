// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider } from './appearance';
import { BusinessProvider, useController, type Controller } from './controller';
import { initialModel } from './model';
import { ExportPage } from './pages/SettingsExport';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./api', () => ({
  preview: false,
  api: bridge.invoke,
  windowAction: vi.fn(),
  onEvent: () => () => {},
}));
let controller: Controller;
const rows = [
  { name: 'dict', comment: '字典' },
  { name: 'menu', comment: '菜单' },
];
const sql = 'CREATE TABLE `dict` (`id` int);';
function Probe() {
  controller = useController();
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function ready() {
  render(
    <AppearanceProvider initial={{ themeMode: 'light', resolvedTheme: 'light' }}>
      <BusinessProvider>
        <Probe />
        <div id="page-footer" />
        <ExportPage />
      </BusinessProvider>
    </AppearanceProvider>,
  );
  await waitFor(() => expect(controller.m.loading).toBe(false));
  await waitFor(() => expect(controller.m.busy).toBe(0));
  await act(async () => {
    await controller.loadExport('source/a');
  });
}
beforeEach(() => {
  bridge.invoke.mockReset();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
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
  const state = initialModel().state;
  state.workspaces = [
    { id: 'default', name: '默认', description: '' },
    { id: 'second', name: '第二', description: '' },
  ];
  state.connections = [
    {
      id: 'source',
      name: '来源',
      host: '192.0.2.10',
      port: 3306,
      user: 'tester',
      group: '',
      databases: ['a', 'b'],
      workspaceIds: ['default'],
      ssl: false,
      ca: '',
      clientCert: '',
      hasPassword: false,
    },
  ];
  bridge.invoke.mockImplementation(async (method: string) => {
    if (method === 'state.load') return structuredClone(state);
    if (method === 'databases.list') return ['a', 'b'];
    if (method === 'tables.list') return rows;
    if (method === 'schema.export') return { sql };
    if (method === 'files.save') return true;
    throw new Error('Unexpected API: ' + method);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const requests = () => bridge.invoke.mock.calls.filter(([method]) => method === 'schema.export');
const generate = () => screen.getByRole('button', { name: /生成预览 SQL/ });
const save = () => screen.getByRole('button', { name: /导出 .sql/ });

describe('manual schema export', () => {
  it('selects all pages and preserves other pages when a row is unchecked', async () => {
    await ready();
    const manyRows = Array.from({ length: 32 }, (_, i) => ({
      name: `table_${i + 1}`,
      comment: '',
    }));
    bridge.invoke.mockResolvedValueOnce(manyRows);
    await act(async () => {
      await controller.loadExport('source/a');
    });
    await userEvent.click(screen.getByRole('button', { name: /全\s*选/ }));
    expect(controller.m.exportTables.filter((t) => t.selected)).toHaveLength(32);
    await userEvent.click(screen.getByTitle('2'));
    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(controller.m.exportTables.filter((t) => t.selected)).toHaveLength(31);
    expect(controller.m.exportTables.find((t) => t.name === 'table_21')?.selected).toBe(false);
    expect(controller.m.exportTables.slice(0, 20).every((t) => t.selected)).toBe(true);
    expect(requests()).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: /全\s*选/ }));
    await userEvent.click(generate());
    expect(requests()[0][1].tables).toEqual(manyRows.map((t) => t.name));
  }, 15000);

  it('only generates on demand, including single-table entry and bulk selection', async () => {
    await ready();
    expect((generate() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      await controller.beginExport({
        key: 'dict',
        title: 'dict',
        type: 'table',
        table: 'dict',
        ref: { connectionId: 'source', database: 'a' },
      });
    });
    expect(controller.m.exportTables.filter((t) => t.selected).map((t) => t.name)).toEqual([
      'dict',
    ]);
    await userEvent.click(screen.getByRole('button', { name: /全\s*选/ }));
    expect(controller.m.exportTables.every((t) => t.selected)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /全\s*选/ }));
    expect(controller.m.exportTables.every((t) => !t.selected)).toBe(true);
    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    await userEvent.click(screen.getByText('包含 DROP TABLE'));
    expect(requests()).toHaveLength(0);
    await userEvent.click(generate());
    await waitFor(() => expect(controller.m.exportSql).toBe(sql));
    expect(requests()).toEqual([
      [
        'schema.export',
        {
          source: { connectionId: 'source', database: 'a' },
          tables: ['dict'],
          includeDrop: true,
        },
      ],
    ]);
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole('textbox', { name: '文件名' }), {
      target: { value: 'custom.sql' },
    });
    expect(controller.m.exportSql).toBe(sql);
    await userEvent.click(save());
    expect(bridge.invoke).toHaveBeenCalledWith('files.save', { name: 'custom.sql', content: sql });
    await userEvent.click(screen.getByText('仅 CREATE TABLE'));
    expect(controller.m.exportSql).toBe('');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(generate());
    await userEvent.click(screen.getByRole('button', { name: /全\s*选/ }));
    expect(controller.m.exportSql).toBe('');
    expect(requests()).toHaveLength(2);
  }, 15000);

  it.each(['selection', 'drop', 'source', 'workspace'] as const)(
    'discards an in-flight SQL response after changing %s',
    async (change) => {
      await ready();
      act(() => controller.selectExport(['dict']));
      const pending = deferred<{ sql: string }>();
      const original = bridge.invoke.getMockImplementation()!;
      bridge.invoke.mockImplementation((method, ...args) =>
        method === 'schema.export' ? pending.promise : original(method, ...args),
      );
      let operation!: Promise<void>;
      act(() => {
        operation = controller.updateExport();
        void controller.updateExport();
      });
      expect(requests()).toHaveLength(1);
      expect(controller.m.exportGenerating).toBe(true);
      expect((generate() as HTMLButtonElement).disabled).toBe(true);
      expect(generate().textContent).toContain('正在生成');
      expect(screen.getByRole('status').textContent).toContain('正在读取所选表结构并生成 SQL');
      expect(screen.getByRole('region', { name: 'SQL 预览' }).getAttribute('aria-busy')).toBe(
        'true',
      );
      if (change === 'selection')
        act(() => {
          controller.selectExport(['menu']);
          controller.selectExport(['dict']);
        });
      if (change === 'drop')
        act(() => {
          controller.setIncludeDrop(true);
          controller.setIncludeDrop(false);
        });
      if (change === 'source')
        await act(async () => {
          await controller.loadExport('source/b');
        });
      if (change === 'workspace') act(() => controller.switchWorkspace('second'));
      await act(async () => {
        pending.resolve({ sql });
        await operation;
      });
      expect(controller.m.exportSql).toBe('');
      expect(controller.m.exportGenerating).toBe(false);
      expect(screen.queryByRole('status')).toBeNull();
      expect((save() as HTMLButtonElement).disabled).toBe(true);
    },
  );

  it('clears old tables and SQL immediately and ignores an older source load', async () => {
    await ready();
    act(() => controller.selectExport(['dict']));
    await act(async () => {
      await controller.updateExport();
    });
    const pending = deferred<typeof rows>();
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((method, params) =>
      method === 'tables.list' && params.ref.database === 'b'
        ? pending.promise
        : original(method, params),
    );
    let operation!: Promise<void>;
    act(() => {
      operation = controller.loadExport('source/b');
    });
    expect(controller.m.exportTables).toEqual([]);
    expect(controller.m.exportSql).toBe('');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      await controller.loadExport('source/a');
    });
    await act(async () => {
      pending.resolve([{ name: 'wrong', comment: '' }]);
      await operation;
    });
    expect(controller.m.exportTables.map((t) => t.name)).toEqual(['dict', 'menu']);
  });

  it('clears a previous preview before regeneration and allows retry after failure', async () => {
    await ready();
    act(() => controller.selectExport(['dict']));
    await userEvent.click(generate());
    const pending = deferred<{ sql: string }>();
    bridge.invoke.mockReturnValueOnce(pending.promise);
    let operation!: Promise<void>;
    act(() => {
      operation = controller.updateExport();
    });
    expect(controller.m.exportSql).toBe('');
    await act(async () => {
      pending.resolve({ sql });
      await operation;
    });
    bridge.invoke.mockRejectedValueOnce(new Error('无法读取表结构'));
    await userEvent.click(generate());
    expect(await screen.findByText('无法读取表结构')).toBeTruthy();
    expect(controller.m.exportSql).toBe('');
    expect(controller.m.exportGenerating).toBe(false);
    await userEvent.click(generate());
    await waitFor(() => expect(controller.m.exportSql).toBe(sql));
  });
});
