import { expect, it } from 'vitest';
import { buildPreviewPlan, previewBridge, previewPlan } from './preview';
import type { State, ConnectionGroup, SyncPlan, SyncRecord } from './types';
import { recordScriptFiles } from './sync-scripts';

it('deletes only empty preview groups and preserves connections and remaining order', async () => {
  const before = (await previewBridge.invoke('state.load')) as State;
  const group = (await previewBridge.invoke('connectionGroups.save', {
    name: '删除测试空分组',
  })) as ConnectionGroup;
  await expect(previewBridge.invoke('connectionGroups.delete', { groupId: '' })).rejects.toThrow(
    '请选择要删除的分组',
  );
  await expect(
    previewBridge.invoke('connectionGroups.delete', { groupId: 'missing' }),
  ).rejects.toThrow('分组不存在');
  const occupied = before.connectionGroups.find((value) =>
    before.connections.some((connection) => connection.group === value.name),
  )!;
  await expect(
    previewBridge.invoke('connectionGroups.delete', { groupId: occupied.id }),
  ).rejects.toThrow('该分组仍有连接');
  expect(await previewBridge.invoke('connectionGroups.delete', { groupId: group.id })).toEqual({
    ok: true,
  });
  const after = (await previewBridge.invoke('state.load')) as State;
  expect(after.connections).toEqual(before.connections);
  expect(after.connectionGroups.some((value) => value.id === group.id)).toBe(false);
  expect(after.connectionGroups.map((value) => value.sortOrder)).toEqual(
    after.connectionGroups.map((_, index) => index),
  );
});

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

it('skips missing data tables and creates them only in a separate structure comparison', () => {
  const target = previewPlan.targets[2].ref;
  const dataOnly = buildPreviewPlan(
    previewPlan.source,
    [target],
    [{ name: 'sys_user', structure: false, data: true, keyColumns: [] }],
  );
  expect(dataOnly.targets[0].changes).toEqual([]);
  expect(dataOnly.targets[0].skippedTables).toEqual(['sys_user']);
  const withStructure = buildPreviewPlan(
    previewPlan.source,
    [target],
    [{ name: 'sys_user', structure: true, data: false, keyColumns: [] }],
  );
  expect(withStructure.targets[0].changes).toEqual([
    expect.objectContaining({ kind: 'CREATE_TABLE', blocked: false }),
  ]);
});

it('rejects mixing structure and data across the selected tables', () => {
  for (const tables of [
    [{ name: 'sys_dict', structure: true, data: true, keyColumns: [] }],
    [
      { name: 'sys_dict', structure: true, data: false, keyColumns: [] },
      { name: 'sys_menu', structure: false, data: true, keyColumns: [] },
    ],
  ])
    expect(() =>
      buildPreviewPlan(previewPlan.source, [previewPlan.targets[0].ref], tables),
    ).toThrow('每次只能同步结构或数据');
});

it('compares structure and data in separate plans', () => {
  const result = buildPreviewPlan(
    previewPlan.source,
    [previewPlan.targets[0].ref],
    [
      { name: 'sys_dict', structure: true, data: false, keyColumns: ['code'] },
      { name: 'sys_menu', structure: true, data: false, keyColumns: [] },
    ],
  );
  const changes = result.targets[0].changes;
  expect(changes.some((item) => item.kind === 'ADD_COLUMN')).toBe(true);
  expect(changes.some((item) => item.kind.endsWith('_ROW'))).toBe(false);
  expect(changes.filter((item) => item.blocked)).toEqual([]);
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
