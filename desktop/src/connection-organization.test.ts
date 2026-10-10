import { expect, it } from 'vitest';
import {
  connectionSignature,
  groupDropPlacement,
  dropPlacement,
  normalizeOrganization,
  orderedConnections,
  portFromText,
} from './connection-organization';
import { initialModel, emptyConnection, dbOptions } from './model';

it('orders database options by group then member without mutating saved arrays', () => {
  const m = initialModel();
  m.state.connectionGroups = [
    { id: 'a', name: 'A', sortOrder: 1 },
    { id: 'b', name: 'B', sortOrder: 0 },
  ];
  m.state.connections = [
    { ...emptyConnection('default'), id: 'a', group: 'A', sortOrder: 0, databases: ['db'] },
    { ...emptyConnection('default'), id: 'b2', group: 'B', sortOrder: 1, databases: ['two'] },
    { ...emptyConnection('other'), id: 'hidden', group: 'B', sortOrder: 0, databases: ['hidden'] },
    { ...emptyConnection('default'), id: 'b1', group: 'B', sortOrder: 0, databases: ['one'] },
  ];
  m.dbCache.b1 = ['one', 'discovered'];
  const snapshot = JSON.stringify(m.state);
  expect(dbOptions(m).map((option) => option.value)).toEqual([
    'b1/one',
    'b1/discovered',
    'b2/two',
    'a/db',
  ]);
  expect(JSON.stringify(m.state)).toBe(snapshot);
});

it('accepts only sibling group gaps and rejects nesting, self drops and pending moves', () => {
  const input = {
    organizationSaving: false,
    dragNode: { type: 'group', groupId: 'b' },
    dropNode: { type: 'group', groupId: 'a', pos: '0-0' },
    dropToGap: true,
    dropPosition: -1,
  };
  expect(groupDropPlacement(input)).toEqual({
    groupId: 'b',
    anchorGroupId: 'a',
    placement: 'before',
  });
  expect(groupDropPlacement({ ...input, dropPosition: 1 })?.placement).toBe('after');
  expect(groupDropPlacement({ ...input, dropToGap: false })).toBeNull();
  expect(groupDropPlacement({ ...input, organizationSaving: true })).toBeNull();
  expect(
    groupDropPlacement({ ...input, dropNode: { ...input.dropNode, groupId: 'b' } }),
  ).toBeNull();
  expect(
    groupDropPlacement({ ...input, dropNode: { ...input.dropNode, type: 'connection' } }),
  ).toBeNull();
});

it('keeps discovery signatures across organization changes but detects server changes', () => {
  const connection = emptyConnection('default');
  expect(connectionSignature({ ...connection, name: 'renamed', group: 'new', sortOrder: 9 })).toBe(
    connectionSignature(connection),
  );
  expect(connectionSignature({ ...connection, port: 3307 })).not.toBe(
    connectionSignature(connection),
  );
});
it('normalizes legacy groups and sorts a filtered workspace without losing global order', () => {
  const state = initialModel().state;
  state.connections = [3, 1, 2].map((sortOrder) => ({
    ...emptyConnection('default'),
    id: String(sortOrder),
    sortOrder,
  }));
  expect(normalizeOrganization(state).connectionGroups.map((g) => g.name)).toEqual(['数据库连接']);
  expect(
    orderedConnections(state.connections.filter((c) => c.id !== '2')).map((c) => c.id),
  ).toEqual(['1', '3']);
});
it.each(['', '0', '65536', '33063306', '3.5', '-1', '1e3', 'abc', ' 3306'])(
  'rejects invalid port text %j without clamping',
  (text) => {
    expect(portFromText(text)).toBe(0);
  },
);
it.each(['1', '3306', '13306', '65535'])('accepts valid port %s exactly', (text) => {
  expect(portFromText(text)).toBe(Number(text));
});

const base = {
  organizationSaving: false,
  dragNode: { type: 'connection', connectionId: 'c1' },
  hovered: undefined as { connectionId?: string; groupId?: string } | undefined,
  hoveredBeforeMiddle: true,
  dropNode: {} as { type?: string; groupId?: string; connectionId?: string; pos?: string },
  dropToGap: false,
  dropPosition: 0,
};

it('resolves anchor drops from the actual hovered row using pointer position', () => {
  expect(
    dropPlacement({
      ...base,
      hovered: { connectionId: 'c2', groupId: 'g1' },
      hoveredBeforeMiddle: true,
    }),
  ).toEqual({
    connectionId: 'c1',
    groupId: 'g1',
    placement: 'before',
    anchorConnectionId: 'c2',
  });
  expect(
    dropPlacement({
      ...base,
      hovered: { connectionId: 'c2', groupId: 'g1' },
      hoveredBeforeMiddle: false,
    })?.placement,
  ).toBe('after');
  // 悬停行是拖动节点自身时，不能按锚点处理。
  expect(dropPlacement({ ...base, hovered: { connectionId: 'c1', groupId: 'g1' } })).toBeNull();
});

it('drops into a group row or group node at the end of that group', () => {
  expect(dropPlacement({ ...base, hovered: { groupId: 'g1' } })).toEqual({
    connectionId: 'c1',
    groupId: 'g1',
    placement: 'last',
  });
  expect(dropPlacement({ ...base, dropNode: { type: 'group', groupId: 'g2' } })).toEqual({
    connectionId: 'c1',
    groupId: 'g2',
    placement: 'last',
  });
  // 拖动分组本身不产生移动。
  expect(
    dropPlacement({
      ...base,
      dragNode: { type: 'group' },
      dropNode: { type: 'group', groupId: 'g2' },
    }),
  ).toBeNull();
});

it('resolves gap drops relative to the reported drop position', () => {
  expect(
    dropPlacement({
      ...base,
      dropNode: { type: 'connection', groupId: 'g1', connectionId: 'c3', pos: '0-0-1' },
      dropToGap: true,
      dropPosition: 0,
    }),
  ).toEqual({
    connectionId: 'c1',
    groupId: 'g1',
    placement: 'before',
    anchorConnectionId: 'c3',
  });
  expect(
    dropPlacement({
      ...base,
      dropNode: { type: 'connection', groupId: 'g1', connectionId: 'c3', pos: '0-0-1' },
      dropToGap: true,
      dropPosition: 2,
    })?.placement,
  ).toBe('after');
  // 非间隙落点（放入连接行内部）不被接受。
  expect(
    dropPlacement({
      ...base,
      dropNode: { type: 'connection', groupId: 'g1', connectionId: 'c3', pos: '0-0-1' },
      dropToGap: false,
      dropPosition: 1,
    }),
  ).toBeNull();
});

it('rejects drops while organization saving or without a valid group target', () => {
  expect(dropPlacement({ ...base, organizationSaving: true })).toBeNull();
  expect(dropPlacement(base)).toBeNull();
  expect(
    dropPlacement({
      ...base,
      dropNode: { type: 'connection', groupId: 'g1', connectionId: 'c3', pos: '0-0-1' },
      dropToGap: true,
      dropPosition: 2,
      hovered: { groupId: 'g1' },
    }),
  ).toEqual({ connectionId: 'c1', groupId: 'g1', placement: 'last' });
});
