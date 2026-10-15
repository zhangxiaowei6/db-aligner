import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { State, SyncPlan, SyncRecord, Table, DriverState, RollbackPlan } from './types';

beforeEach(() => vi.resetModules());
afterEach(() => vi.useRealTimers());
const source = { connectionId: 'pg-source', database: 'demo_pg', schema: 'public' };
const target = { connectionId: 'pg-target', database: 'demo_pg_target', schema: 'reference' };
async function bridge() {
  const { previewBridge } = await import('./preview');
  vi.useFakeTimers();
  const install = previewBridge.invoke('drivers.install', { driverId: 'postgresql' });
  await vi.advanceTimersByTimeAsync(750);
  await install;
  vi.useRealTimers();
  return previewBridge;
}

it('simulates missing drivers, failure, cancellation and retry without network', async () => {
  const { previewBridge } = await import('./preview');
  expect(
    (await previewBridge.invoke<DriverState>('drivers.get', { driverId: 'postgresql' })).status,
  ).toBe('missing');
  await expect(previewBridge.invoke('schemas.list', { ref: source })).rejects.toThrow('请先');
  vi.useFakeTimers();
  const failed = previewBridge.invoke<DriverState>('drivers.install', {
    driverId: 'postgresql',
    simulateFailure: true,
  });
  expect(
    (await previewBridge.invoke<DriverState>('drivers.get', { driverId: 'postgresql' })).status,
  ).toBe('downloading');
  await vi.advanceTimersByTimeAsync(750);
  expect((await failed).status).toBe('error');
  const cancelled = previewBridge.invoke<DriverState>('drivers.install', {
    driverId: 'postgresql',
  });
  await previewBridge.invoke('drivers.cancel', { driverId: 'postgresql' });
  await vi.advanceTimersByTimeAsync(750);
  expect((await cancelled).status).toBe('cancelled');
  const installed = previewBridge.invoke<DriverState>('drivers.install', {
    driverId: 'postgresql',
  });
  await vi.advanceTimersByTimeAsync(750);
  expect((await installed).status).toBe('installed');
  expect(await previewBridge.invoke('schemas.list', { ref: source })).toEqual([
    'public',
    'reference',
  ]);
});

it('exposes both database families and keeps schema, SQL and risk behavior distinct', async () => {
  const api = await bridge();
  const state = await api.invoke<State>('state.load');
  expect(state.connections.some((connection) => connection.databaseType === 'postgresql')).toBe(
    true,
  );
  expect(
    state.connections.some(
      (connection) => !connection.databaseType || connection.databaseType === 'mysql',
    ),
  ).toBe(true);
  const plan = await api.invoke<SyncPlan>('sync.compare', {
    source,
    targets: [{ ...target, schema: 'public' }],
    tables: [{ name: 'sys_dict', structure: true, data: false, keyColumns: [] }],
  });
  expect(plan.targets[0].changes.some((change) => change.kind === 'MODIFY_COLUMN')).toBe(true);
  expect(plan.targets[0].changes.every((change) => !change.sql.includes('`'))).toBe(true);
  expect(
    plan.targets[0].changes.filter((change) => change.risk).every((change) => !change.selected),
  ).toBe(true);
  expect(plan.targets[0].changes.some((change) => change.sql.includes('ALTER COLUMN'))).toBe(true);
  await expect(
    api.invoke('sync.compare', {
      source,
      targets: [{ connectionId: 'target0', database: 'shop_a' }],
      tables: [{ name: 'sys_dict', structure: true, data: false, keyColumns: [] }],
    }),
  ).rejects.toThrow('同类型');
  const missing = await api.invoke<SyncPlan>('sync.compare', {
    source,
    targets: [target],
    tables: [{ name: 'sys_user', structure: false, data: true, keyColumns: [] }],
  });
  expect(missing.targets[0].skippedTables).toEqual(['sys_user']);
  expect(missing.targets[0].changes).toEqual([]);
  const blocked = await api.invoke<SyncPlan>('sync.compare', {
    source,
    targets: [target],
    tables: [{ name: 'audit_identity', structure: true, data: false, keyColumns: [] }],
  });
  expect(blocked.targets[0].changes[0].blocked).toBe(true);
});

it('simulates selected data execution, verification and linked recovery only in memory', async () => {
  const api = await bridge();
  const ref = { ...source, schema: 'reference' };
  const before = await api.invoke<Table>('table.get', { ref: target, table: 'sys_dict' });
  const plan = await api.invoke<SyncPlan>('sync.compare', {
    source: ref,
    targets: [target],
    tables: [{ name: 'sys_dict', structure: false, data: true, keyColumns: ['code'] }],
  });
  expect(plan.targets[0].changes.map((change) => change.kind).sort()).toEqual([
    'ADD_ROW',
    'DELETE_ROW',
    'UPDATE_ROW',
  ]);
  expect(plan.targets[0].changes.find((change) => change.kind === 'UPDATE_ROW')?.after.id).toBe(
    8007,
  );
  const selectedIds = plan.targets[0].changes.map((change) => change.id);
  const saved = await api.invoke<SyncRecord>('sync.save', {
    planId: plan.id,
    selectedIds,
    mode: 'SAVE_ONLY',
  });
  expect(saved.status).toBe('UNEXECUTED');
  expect((await api.invoke<Table>('table.get', { ref: target, table: 'sys_dict' })).rows).toEqual(
    before.rows,
  );
  const executed = await api.invoke<SyncRecord>('sync.save', {
    planId: plan.id,
    selectedIds,
    mode: 'EXECUTE_AND_SAVE',
  });
  expect(executed.status).toBe('SUCCESS');
  expect(executed.remark).toContain('虚构');
  expect(
    (await api.invoke<Table>('table.get', { ref: target, table: 'sys_dict' })).rows
      .map((row) => row.code)
      .sort(),
  ).toEqual(['ORDER_STATUS', 'PAYMENT_TYPE']);
  const second = await api.invoke<SyncPlan>('sync.compare', {
    source: ref,
    targets: [target],
    tables: plan.tables,
  });
  expect(second.targets[0].changes).toEqual([]);
  await api.invoke('record.verify', { id: executed.id });
  const rollback = await api.invoke<RollbackPlan>('rollback.preview', { id: executed.id });
  expect(rollback.items).toHaveLength(3);
  const restored = await api.invoke<SyncRecord>('rollback.execute', {
    id: executed.id,
    selectedIds,
  });
  expect(restored.parentId).toBe(executed.id);
  expect(restored.mode).toBe('ROLLBACK');
  const after = await api.invoke<Table>('table.get', { ref: target, table: 'sys_dict' });
  expect(after.rows.sort((a, b) => String(a.code).localeCompare(String(b.code)))).toEqual(
    before.rows.sort((a, b) => String(a.code).localeCompare(String(b.code))),
  );
  expect((await api.invoke<RollbackPlan>('rollback.preview', { id: executed.id })).items).toEqual(
    [],
  );
});

it('also completes MySQL data simulation, recomparison and recovery with its own SQL', async () => {
  const api = await bridge();
  const source = { connectionId: 'test', database: 'shop_test' };
  const target = { connectionId: 'target1', database: 'shop_b' };
  const tables = [{ name: 'sys_dict', structure: false, data: true, keyColumns: ['code'] }];
  const before = await api.invoke<Table>('table.get', { ref: target, table: 'sys_dict' });
  const plan = await api.invoke<SyncPlan>('sync.compare', { source, targets: [target], tables });
  expect(plan.targets[0].changes.map((change) => change.kind).sort()).toEqual([
    'ADD_ROW',
    'DELETE_ROW',
    'UPDATE_ROW',
  ]);
  expect(plan.targets[0].changes.find((change) => change.kind === 'UPDATE_ROW')?.after.id).toBe(
    8007,
  );
  expect(
    plan.targets[0].changes.every((change) => change.sql.includes('`shop_b`.`sys_dict`')),
  ).toBe(true);
  const selectedIds = plan.targets[0].changes.map((change) => change.id);
  const executed = await api.invoke<SyncRecord>('sync.save', {
    planId: plan.id,
    selectedIds,
    mode: 'EXECUTE_AND_SAVE',
  });
  const second = await api.invoke<SyncPlan>('sync.compare', { source, targets: [target], tables });
  expect(second.targets[0].changes).toEqual([]);
  await api.invoke('rollback.execute', { id: executed.id, selectedIds });
  const after = await api.invoke<Table>('table.get', { ref: target, table: 'sys_dict' });
  const sorted = (table: Table) =>
    table.rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  expect(sorted(after)).toEqual(sorted(before));
});
