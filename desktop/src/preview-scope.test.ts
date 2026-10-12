import { expect, it, vi } from 'vitest';
import { buildPreviewPlan, previewBridge, previewPlan } from './preview';
import type {
  State,
  ConnectionGroup,
  SyncPlan,
  SyncRecord,
  Table,
  CompareTask,
  RollbackPlan,
} from './types';
import { defaultStructureOptions } from './structure-options';
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
  const missingMenu = buildPreviewPlan(
    previewPlan.source,
    [previewPlan.targets[1].ref],
    [{ name: 'sys_menu', structure: true, data: false, keyColumns: [] }],
  );
  expect(missingMenu.targets[0].changes).toEqual([
    expect.objectContaining({
      kind: 'CREATE_TABLE',
      sql: expect.stringContaining('CREATE TABLE `shop_b`.`sys_menu`'),
    }),
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
    [previewPlan.targets[1].ref],
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
  expect(saved.workspaceId).toBe(plan.workspaceId);
  expect(saved.recoveryFormat).toBe('LOCAL_V1');
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
  expect(
    (await previewBridge.invoke<RollbackPlan>('rollback.preview', { id: saved.id })).items,
  ).toEqual([]);
});

it('derives fictional rollback items from the requested record and its completed selected steps', async () => {
  const state = await previewBridge.invoke<State>('state.load');
  const record = state.records.find((item) => item.id === 'PREVIEW-EXECUTED-007')!;
  const rollback = await previewBridge.invoke<RollbackPlan>('rollback.preview', { id: record.id });
  expect(rollback.items).toEqual([
    expect.objectContaining({
      id: 'c3',
      targetKey: 'target0/shop_a',
      table: 'sys_menu',
      sql: record.plan!.targets[0].changes.find((change) => change.id === 'c3')!.rollbackSql,
    }),
  ]);
  const unexecuted = await previewBridge.invoke<RollbackPlan>('rollback.preview', {
    id: 'SYNC-1008-008',
  });
  expect(unexecuted.items).toEqual([]);
});

it('uses current defaults and keeps the old mixed fixture only for historical compatibility', () => {
  const plan = buildPreviewPlan(
    previewPlan.source,
    previewPlan.targets.map((target) => target.ref),
    previewPlan.tables.map((table) => ({
      ...table,
      data: false,
      structureOptions: { ...defaultStructureOptions },
    })),
    'another-workspace',
  );
  expect(plan.workspaceId).toBe('another-workspace');
  expect(plan.tables.every((table) => table.structure && !table.data)).toBe(true);
  expect(
    plan.targets
      .flatMap((target) => target.changes)
      .some((change) => change.kind.endsWith('_ROW') || change.kind.includes('INDEX')),
  ).toBe(false);
  expect(plan.targets[2].changes).toEqual([
    expect.objectContaining({ kind: 'BLOCKED', selected: false }),
  ]);
  expect(previewPlan.tables.some((table) => table.structure && table.data)).toBe(true);
});

it('uses the same missing tables and definitions in browsing, export and comparison', async () => {
  for (const target of previewPlan.targets) {
    const list = await previewBridge.invoke<{ name: string }[]>('tables.list', { ref: target.ref });
    const plan = buildPreviewPlan(
      previewPlan.source,
      [target.ref],
      previewPlan.tables.map((table) => ({ ...table, structure: false, data: true })),
    );
    for (const choice of plan.tables) {
      const table = await previewBridge.invoke<Table>('table.get', {
        ref: target.ref,
        table: choice.name,
      });
      expect(table.exists).toBe(list.some((item) => item.name === choice.name));
      expect(plan.targets[0].before[choice.name]).toEqual(table);
      expect(plan.targets[0].skippedTables?.includes(choice.name)).toBe(!table.exists);
    }
  }
  const source = await previewBridge.invoke<Table>('table.get', {
    ref: previewPlan.source,
    table: 'sys_user',
  });
  const exported = await previewBridge.invoke<{ sql: string }>('schema.export', {
    source: previewPlan.source,
    tables: ['sys_user'],
    includeDrop: false,
  });
  expect(source.createSql).toContain('`sys_user`');
  expect(source.createSql).not.toContain('`sys_dict`');
  expect(exported.sql).toContain(source.createSql);
});

it('blocks data differences when source columns or matching keys are unavailable', () => {
  const choice = { name: 'sys_dict', structure: false, data: true, keyColumns: ['code'] };
  const blocked = buildPreviewPlan(previewPlan.source, [previewPlan.targets[0].ref], [choice]);
  expect(blocked.targets[0].changes).toEqual([
    expect.objectContaining({
      kind: 'BLOCKED',
      blocked: true,
      selected: false,
      reason: '目标表缺少源字段，请先同步结构',
    }),
  ]);
  const invalid = buildPreviewPlan(
    previewPlan.source,
    [previewPlan.targets[1].ref],
    [{ ...choice, keyColumns: ['missing_key'] }],
  );
  expect(invalid.targets[0].changes).toEqual([
    expect.objectContaining({ kind: 'BLOCKED', reason: '匹配键包含不存在的字段：missing_key' }),
  ]);
});

it('keeps connection credentials private and preserves blank-password edits and clear-password behavior', async () => {
  const before = await previewBridge.invoke<State>('state.load');
  const value = {
    ...before.connections[0],
    id: 'credential-preview-test',
    password: 'preview-fail',
    certificatePassword: 'fictional-secret',
  };
  const saved = await previewBridge.invoke('entity.save', { kind: 'connection', value });
  expect(saved).toMatchObject({ hasPassword: true });
  expect(JSON.stringify(saved)).not.toContain('password');
  expect(value.password).toBe('preview-fail');
  await expect(previewBridge.invoke('connections.test', { id: value.id })).rejects.toThrow(
    '密码验证失败',
  );
  await previewBridge.invoke('entity.save', {
    kind: 'connection',
    value: { ...value, password: '', certificatePassword: '' },
  });
  await expect(previewBridge.invoke('connections.test', { id: value.id })).rejects.toThrow(
    '密码验证失败',
  );
  await previewBridge.invoke('entity.save', {
    kind: 'connection',
    value: { ...value, password: '', clearPassword: true },
  });
  const after = await previewBridge.invoke<State>('state.load');
  expect(after.connections.find((connection) => connection.id === value.id)?.hasPassword).toBe(
    false,
  );
  expect(JSON.stringify(after.connections)).not.toContain('fictional-secret');
  await expect(previewBridge.invoke('connections.test', { id: value.id })).resolves.toMatchObject({
    serverVersion: expect.any(String),
  });
  await previewBridge.invoke('entity.delete', { kind: 'connection', id: value.id });
});

it('publishes a failed terminal state for invalid async comparisons and releases the active task', async () => {
  vi.useFakeTimers();
  try {
    const params = {
      source: previewPlan.source,
      targets: [previewPlan.targets[0].ref],
      tables: previewPlan.tables,
    };
    const { compareId } = await previewBridge.invoke<{ compareId: string }>(
      'sync.compare.start',
      params,
    );
    await vi.advanceTimersByTimeAsync(2500);
    const task = await previewBridge.invoke<CompareTask>('sync.compare.get', { compareId });
    expect(task.status).toBe('FAILED');
    expect(task.error).toContain('每次只能同步结构或数据');
    expect(task.plan).toBeUndefined();
    const next = await previewBridge.invoke<{ compareId: string }>('sync.compare.start', {
      ...params,
      tables: [{ name: 'sys_user', structure: true, data: false, keyColumns: [] }],
    });
    await previewBridge.invoke('sync.compare.cancel', next);
    await vi.advanceTimersByTimeAsync(400);
    expect((await previewBridge.invoke<CompareTask>('sync.compare.get', next)).status).toBe(
      'CANCELLED',
    );
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
