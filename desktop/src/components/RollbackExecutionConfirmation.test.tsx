// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from 'antd';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RollbackExecutionConfirmation } from './RollbackExecutionConfirmation';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

it('groups only selected eligible rollback items and copies all statements in preview order', () => {
  const sample = {
    id: 'first',
    targetKey: 'target/shop_a',
    table: 'dict',
    label: '恢复字段',
    reason: '',
    eligible: true,
    selected: true,
    sql: ['ALTER TABLE dict ADD COLUMN old INT;', 'UPDATE dict SET old = 1'],
  };
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
  render(
    <App>
      <RollbackExecutionConfirmation
        rollback={{
          id: 'rollback',
          recordId: 'original',
          items: [
            sample,
            { ...sample, id: 'second', sql: ['ALTER TABLE dict DROP COLUMN added;'] },
            { ...sample, id: 'other', targetKey: 'target/shop_b', sql: ['DELETE FROM other;'] },
            {
              ...sample,
              id: 'blocked',
              eligible: false,
              targetKey: 'target/shop_c',
              sql: ['NEVER BLOCKED'],
            },
            { ...sample, id: 'unselected', sql: ['NEVER UNSELECTED'] },
          ],
        }}
        selectedIds={['second', 'first', 'other', 'blocked']}
        connections={[]}
      />
    </App>,
  );
  expect(screen.getByRole('region', { name: '目标数据库' }).textContent).toContain(
    '回滚以下 2 个目标数据库',
  );
  expect(screen.getByText(/共恢复 3 项已选变更/)).toBeTruthy();
  expect(screen.getByText('原记录未保留来源数据库信息')).toBeTruthy();
  const script = screen.getByRole('region', { name: 'shop_a 执行脚本' });
  const sql = script.querySelector('code')!.textContent!;
  expect(sql.indexOf('ADD COLUMN')).toBeLessThan(sql.indexOf('UPDATE'));
  expect(sql.indexOf('UPDATE')).toBeLessThan(sql.indexOf('DROP COLUMN'));
  expect(sql).toContain('UPDATE dict SET old = 1;');
  expect(sql).not.toContain(';;');
  expect(sql).not.toContain('NEVER');
  fireEvent.click(within(script).getByRole('button', { name: '复制完整 SQL' }));
  expect(copy).toHaveBeenCalledWith(sql);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '执行脚本目标库' }));
  fireEvent.click(screen.getByText(/target \/ shop_b/));
  expect(screen.getByRole('region', { name: 'shop_b 执行脚本' }).textContent).toContain(
    'DELETE FROM other;',
  );
  expect(screen.queryByRole('region', { name: 'shop_a 执行脚本' })).toBeNull();
});
