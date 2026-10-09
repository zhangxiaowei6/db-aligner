import { expect, it } from 'vitest';
import { buildPreviewPlan, previewBridge, previewPlan } from './preview';
import type { SyncPlan, SyncRecord } from './types';
import { recordScriptFiles } from './sync-scripts';

it('compares only the selected source, targets, tables and change types in the preview', () => {
  const source = { connectionId: 'target1', database: 'shop_b' };
  const target = previewPlan.targets[0].ref;
  const tables = [{ name: 'sys_dict', structure: true, data: false, keyColumns: [] }];
  const result = buildPreviewPlan(source, [target], tables);
  expect(result.source).toEqual(source);
  expect(result.targets.map((item) => item.ref)).toEqual([target]);
  expect(result.tables).toEqual(tables);
  expect(result.targets[0].changes.length).toBeGreaterThan(0);
  expect(
    result.targets[0].changes.every(
      (item) => item.table === 'sys_dict' && !item.kind.endsWith('_ROW'),
    ),
  ).toBe(true);
  expect(Object.keys(result.sourceSnapshot)).toEqual(['sys_dict']);
});

it('shows a missing table as blocked for data only and creates it when structure is selected', () => {
  const target = previewPlan.targets[2].ref;
  const dataOnly = buildPreviewPlan(
    previewPlan.source,
    [target],
    [{ name: 'sys_user', structure: false, data: true, keyColumns: [] }],
  );
  expect(dataOnly.targets[0].changes).toEqual([
    expect.objectContaining({
      kind: 'BLOCKED',
      blocked: true,
      reason: '请启用表结构同步或先创建目标表',
    }),
  ]);
  const withStructure = buildPreviewPlan(
    previewPlan.source,
    [target],
    [{ name: 'sys_user', structure: true, data: false, keyColumns: [] }],
  );
  expect(withStructure.targets[0].changes).toEqual([
    expect.objectContaining({ kind: 'CREATE_TABLE', blocked: false }),
  ]);
});

it('requires a separate data comparison after changing existing fields, without blocking other tables', () => {
  const result = buildPreviewPlan(
    previewPlan.source,
    [previewPlan.targets[0].ref],
    [
      { name: 'sys_dict', structure: true, data: true, keyColumns: ['code'] },
      { name: 'sys_menu', structure: true, data: false, keyColumns: [] },
    ],
  );
  const changes = result.targets[0].changes;
  expect(changes.some((item) => item.kind === 'ADD_COLUMN')).toBe(true);
  expect(changes.some((item) => item.kind.endsWith('_ROW'))).toBe(false);
  expect(changes.filter((item) => item.blocked)).toEqual([
    expect.objectContaining({
      table: 'sys_dict',
      kind: 'BLOCKED',
      selected: false,
      reason: '该表字段定义发生变化，请先同步结构，再重新比较基础数据',
    }),
  ]);
  expect(
    changes.some((item) => item.table === 'sys_menu' && item.kind === 'ADD_INDEX' && !item.blocked),
  ).toBe(true);
  const dataOnly = buildPreviewPlan(
    previewPlan.source,
    [previewPlan.targets[0].ref],
    [{ name: 'sys_dict', structure: false, data: true, keyColumns: ['code'] }],
  );
  expect(dataOnly.targets[0].changes.map((item) => item.kind)).toEqual([
    'UPDATE_ROW',
    'ADD_ROW',
    'DELETE_ROW',
  ]);
  expect(dataOnly.targets[0].changes[1].after).toEqual({
    code: 'PAYMENT_TYPE',
    dict_name: '支付方式',
  });
  expect(dataOnly.targets[0].changes[2].before).toEqual({
    code: 'LEGACY_FLAG',
    dict_name: '旧标记',
  });
});

it('saves the actual compared plan and exposes only its selected SQL in record previews', async () => {
  const plan = await previewBridge.invoke<SyncPlan>('sync.compare', {
    source: previewPlan.source,
    targets: [previewPlan.targets[1].ref],
    tables: [{ name: 'sys_user', structure: true, data: false, keyColumns: [] }],
  });
  const change = plan.targets[0].changes[0];
  const saved = await previewBridge.invoke<SyncRecord>('sync.save', {
    planId: plan.id,
    selectedIds: [change.id],
    mode: 'SAVE_ONLY',
    remark: 'scope fixture',
  });
  expect(saved.plan?.id).toBe(plan.id);
  expect(saved.plan?.targets.map((target) => target.ref)).toEqual([previewPlan.targets[1].ref]);
  const detail = await previewBridge.invoke<{ files: string[] }>('record.get', { id: saved.id });
  expect(recordScriptFiles(detail.files, 'scripts')).toEqual(['shop_b/02_sync.sql']);
  expect(recordScriptFiles(detail.files, 'rollbackScripts')).toEqual(['shop_b/04_rollback.sql']);
  const sql = await previewBridge.invoke<string>('record.file', {
    id: saved.id,
    file: 'shop_b/02_sync.sql',
  });
  expect(sql).toContain(change.sql);
  expect(sql).not.toContain('`shop_a`');
  const rollback = await previewBridge.invoke<string>('record.file', {
    id: saved.id,
    file: 'shop_b/04_rollback.sql',
  });
  expect(rollback).toContain(change.rollbackSql[0]);
});
