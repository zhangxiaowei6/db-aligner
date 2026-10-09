// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from 'antd';
import { afterEach, expect, it, vi } from 'vitest';
import { SyncExecutionConfirmation } from './SyncExecutionConfirmation';
import { previewPlan } from '../preview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows and copies every selected SQL statement per target, with table creation first', async () => {
  const plan = structuredClone(previewPlan);
  const change = plan.targets[0].changes[0];
  const statements = Array.from({ length: 80 }, (_, i) => ({
    ...change,
    id: `row-${i}`,
    kind: 'INSERT_ROW',
    label: `row ${i}`,
    sql: `INSERT INTO t VALUES (${i})`,
  }));
  const create = { ...change, id: 'create', kind: 'CREATE_TABLE', sql: 'CREATE TABLE t (id INT);' };
  const blocked = { ...change, id: 'blocked', blocked: true, sql: 'NEVER EXECUTE BLOCKED' };
  plan.targets[0].changes = [
    ...statements,
    create,
    blocked,
    { ...change, id: 'unselected', sql: 'NEVER EXECUTE UNSELECTED' },
  ];
  const second = plan.targets[1].changes[0];
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
  render(
    <App>
      <SyncExecutionConfirmation
        plan={plan}
        connections={[]}
        selectedIds={[...statements.map((item) => item.id), create.id, blocked.id, second.id]}
      />
    </App>,
  );
  const script = screen.getByRole('region', { name: 'shop_a 执行脚本' });
  const sql = script.querySelector('code')!.textContent!;
  expect(sql.indexOf('CREATE TABLE')).toBeLessThan(sql.indexOf('INSERT INTO'));
  expect(sql).toContain('INSERT INTO t VALUES (79);');
  expect(sql).not.toContain('NEVER EXECUTE');
  expect(sql).not.toContain(';;');
  expect(screen.getByRole('region', { name: 'shop_b 执行脚本' }).textContent).toContain(second.sql);
  expect(screen.queryByRole('region', { name: 'shop_c 执行脚本' })).toBeNull();
  fireEvent.click(within(script).getByRole('button', { name: '复制 SQL' }));
  expect(copy).toHaveBeenCalledWith(sql);
});
