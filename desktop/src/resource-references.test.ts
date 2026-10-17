import { expect, it } from 'vitest';
import { initialModel } from './model';
import { reconcileReferences, workspaceContents } from './resource-references';

it('follows stable group renames in unsaved references and clears deleted selections only', () => {
  const m = initialModel();
  m.state.workspaces = [
    { id: 'default', name: '项目', description: '' },
    { id: 'gone', name: '待删', description: '' },
  ];
  m.state.connectionGroups = [{ id: 'g', name: '旧名称', sortOrder: 0 }];
  m.connectionForm = {
    ...m.connectionForm,
    name: '未保存名称',
    group: '旧名称',
    workspaceIds: ['default', 'gone'],
  };
  m.importGroup = '旧名称';
  m.importWorkspaceIds = ['gone'];
  m.moveGroupId = 'g';
  m.scopeRemark = '未保存业务备注';
  const state = structuredClone(m.state);
  state.connectionGroups[0].name = '新名称';
  state.workspaces = state.workspaces.slice(0, 1);
  const renamed = { ...m, ...reconcileReferences(m, state), state };
  expect(renamed.connectionForm.group).toBe('新名称');
  expect(renamed.importGroup).toBe('新名称');
  expect(renamed.connectionForm.workspaceIds).toEqual(['default']);
  expect(renamed.importWorkspaceIds).toEqual([]);
  const removedState = structuredClone(state);
  removedState.connectionGroups = [];
  const deleted = { ...renamed, ...reconcileReferences(renamed, removedState) };
  expect(deleted.connectionForm.group).toBe('');
  expect(deleted.importGroup).toBe('');
  expect(deleted.moveGroupId).toBe('');
  expect(deleted.connectionForm.name).toBe('未保存名称');
  expect(deleted.scopeRemark).toBe('未保存业务备注');
  expect(workspaceContents(state, 'default')).toEqual({
    connections: 0,
    templates: 0,
    records: 0,
    versions: 0,
  });
});
