// @vitest-environment jsdom
import { MenuOperationFeedback } from './MenuOperationFeedback';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataTable, SelectionToggle } from './shared';
import { AsyncButton, RefreshButton } from './AsyncButton';
import { App } from 'antd';

it('keeps an asynchronous action loading until completion and blocks duplicate clicks', async () => {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const handler = vi.fn(() => promise);
  render(
    <App>
      <AsyncButton onClick={handler}>导出配置</AsyncButton>
    </App>,
  );
  const button = screen.getByRole('button', { name: '导出配置' });
  await userEvent.click(button);
  expect(button.className).toContain('ant-btn-loading');
  fireEvent.click(button);
  expect(handler).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(button.className).not.toContain('ant-btn-loading'));
});

it('shows refresh failure and complete details on keyboard focus, keeping retry available', async () => {
  const retry = vi.fn();
  render(
    <App>
      <RefreshButton result={{ status: 'error', message: '连接超时，请检查地址' }} onClick={retry}>
        刷新数据库
      </RefreshButton>
    </App>,
  );
  const button = screen.getByRole('button', { name: '刷新数据库' });
  expect(button.className).toContain('test-error');
  expect(button.querySelector('.anticon-close')).toBeTruthy();
  await userEvent.tab();
  expect(await screen.findByRole('tooltip')).toHaveProperty(
    'textContent',
    '连接超时，请检查地址 · 点击再次刷新',
  );
  await userEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(1);
});

const rows = Array.from({ length: 32 }, (_, index) => ({
  id: String(index),
  name: `Row ${index}`,
}));
function Fixture() {
  const [selected, setSelected] = useState<React.Key[]>([]);
  return (
    <DataTable
      rowKey="id"
      dataSource={rows}
      rowSelection={{
        selectedRowKeys: selected,
        preserveSelectedRowKeys: true,
        onChange: setSelected,
      }}
      columns={[{ title: 'Name', dataIndex: 'name', width: 180 }]}
    />
  );
}
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
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
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('uses one selection button for all, none and partial selection', async () => {
  function ToggleFixture() {
    const [selected, setSelected] = useState(1);
    return (
      <SelectionToggle
        total={3}
        selected={selected}
        onToggle={(checked) => setSelected(checked ? 3 : 0)}
      >
        全选
      </SelectionToggle>
    );
  }
  render(<ToggleFixture />);
  const button = screen.getByRole('button', { name: /全选/ });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.querySelector('[aria-label="minus"]')).not.toBeNull();
  await userEvent.click(button);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  await userEvent.click(button);
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.querySelector('.anticon')).toBeNull();
});
it('changes page size, keeps the size picker available on one page, and preserves selected rows', async () => {
  render(<Fixture />);
  const count = () => document.querySelectorAll('.ant-table-tbody tr[data-row-key]').length;
  expect(count()).toBe(20);
  await userEvent.click(screen.getByRole('row', { name: /Row 0$/ }).querySelector('input')!);
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByText('50 / page'));
  await waitFor(() => expect(count()).toBe(32));
  expect(screen.getByRole('combobox')).toBeTruthy();
  expect(
    (screen.getByRole('row', { name: /Row 0$/ }).querySelector('input') as HTMLInputElement)
      .checked,
  ).toBe(true);
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByText('10 / page'));
  await waitFor(() => expect(count()).toBe(10));
}, 15000);
it('fills its container, keeps selection narrow, and redistributes space when a column is resized', async () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('data-table-host'))
      return { ...originalRect.call(this), width: 800 };
    return originalRect.call(this);
  });
  render(
    <DataTable
      rowKey="id"
      dataSource={rows}
      rowSelection={{}}
      pagination={false}
      columns={[
        { title: 'Name', dataIndex: 'name', width: 180 },
        { title: 'ID', dataIndex: 'id', width: 180 },
      ]}
    />,
  );
  const name = screen.getByRole('separator', { name: '调整Name宽度' });
  const id = screen.getByRole('separator', { name: '调整ID宽度' });
  expect(name.getAttribute('aria-valuenow')).toBe('375');
  expect(id.getAttribute('aria-valuenow')).toBe('375');
  expect(document.querySelector('col')?.getAttribute('style')).toContain('48px');
  fireEvent.keyDown(name, { key: 'ArrowRight' });
  expect(name.getAttribute('aria-valuenow')).toBe('391');
  expect(id.getAttribute('aria-valuenow')).toBe('359');
  fireEvent.keyDown(id, { key: 'ArrowLeft' });
  expect(id.getAttribute('aria-valuenow')).toBe('343');
  expect(name.getAttribute('aria-valuenow')).toBe('407');
  expect(
    (document.querySelector('.resizable-data-table') as HTMLElement).style.getPropertyValue(
      '--data-table-width',
    ),
  ).toBe('798px');
});

it('shows no tooltip on untouched refresh controls or menu actions', async () => {
  const rendered = render(
    <App>
      <RefreshButton>刷新数据库</RefreshButton>
      <MenuOperationFeedback label="测试连接" retry="点击再次测试" />
    </App>,
  );
  await userEvent.hover(screen.getByRole('button', { name: '刷新数据库' }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(screen.queryByRole('tooltip')).toBeNull();
  await userEvent.hover(screen.getByText('测试连接'));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(screen.queryByRole('tooltip')).toBeNull();
  rendered.rerender(
    <App>
      <MenuOperationFeedback
        label="测试连接"
        retry="点击再次测试"
        result={{ status: 'success', message: '连接成功 · 8.4' }}
      />
    </App>,
  );
  await userEvent.hover(screen.getByText('测试连接'));
  expect(await screen.findByRole('tooltip')).toHaveProperty(
    'textContent',
    '连接成功 · 8.4 · 点击再次测试',
  );
  rendered.rerender(
    <App>
      <MenuOperationFeedback label="测试连接" retry="点击再次测试" />
    </App>,
  );
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});

it('shows menu result details when the menu row receives keyboard focus', async () => {
  render(
    <ul role="menu">
      <li role="menuitem" tabIndex={0}>
        <MenuOperationFeedback
          label="测试连接"
          retry="点击再次测试"
          result={{ status: 'success', message: '连接成功 · 8.4' }}
        />
      </li>
    </ul>,
  );
  fireEvent.focusIn(screen.getByRole('menuitem'));
  expect(await screen.findByRole('tooltip')).toHaveProperty(
    'textContent',
    '连接成功 · 8.4 · 点击再次测试',
  );
  fireEvent.focusOut(screen.getByRole('menuitem'), { relatedTarget: document.body });
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});
