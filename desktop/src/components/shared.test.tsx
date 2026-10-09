// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataTable, SelectionToggle } from './shared';

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
