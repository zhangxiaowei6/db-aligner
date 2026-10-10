import type { ConnectionInfo, State } from './types';

export const connectionGroupName = (connection: ConnectionInfo) =>
  connection.group?.trim() || '数据库连接';
export const orderedConnections = (connections: ConnectionInfo[]) =>
  [...connections].sort(
    (a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER),
  );

// Organization changes do not invalidate database discovery or connection tests.
export function connectionSignature(connection?: ConnectionInfo) {
  if (!connection) return '';
  const { name, group, sortOrder, workspaceIds, ...parameters } = connection;
  return JSON.stringify(parameters);
}

export function normalizeOrganization(state: State): State {
  const groups = [...(state.connectionGroups || [])];
  for (const connection of state.connections) {
    const name = connectionGroupName(connection);
    if (!groups.some((group) => group.name === name))
      groups.push({ id: `legacy-${encodeURIComponent(name)}`, name, sortOrder: groups.length });
  }
  return { ...state, connectionGroups: groups.sort((a, b) => a.sortOrder - b.sortOrder) };
}

export function portFromText(text: string): number {
  if (!/^\d+$/.test(text)) return 0;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : 0;
}

export interface DropPlacementInput {
  organizationSaving: boolean;
  dragNode: { type?: string; connectionId?: string };
  /** 事件实际悬停行标签上的 dataset（rc-tree 会把分组首子节点的上半映射为父节点）。 */
  hovered?: { connectionId?: string; groupId?: string };
  /** 悬停行内指针是否位于垂直中点之上。 */
  hoveredBeforeMiddle: boolean;
  dropNode: { type?: string; groupId?: string; connectionId?: string; pos?: string };
  dropToGap: boolean;
  dropPosition: number;
}

export interface ConnectionDrop {
  connectionId: string;
  groupId: string;
  placement: 'before' | 'after' | 'last';
  anchorConnectionId?: string;
}

/** 把一次树拖放解析为 connections.move 参数；不满足拖动规则时返回 null。 */
export function dropPlacement(input: DropPlacementInput): ConnectionDrop | null {
  const { organizationSaving, dragNode, hovered, hoveredBeforeMiddle, dropNode, dropToGap } = input;
  if (organizationSaving || dragNode.type !== 'connection' || !dragNode.connectionId) return null;
  if (hovered?.connectionId && hovered.groupId && hovered.connectionId !== dragNode.connectionId)
    return {
      connectionId: dragNode.connectionId,
      groupId: hovered.groupId,
      placement: hoveredBeforeMiddle ? 'before' : 'after',
      anchorConnectionId: hovered.connectionId,
    };
  if (hovered?.groupId && !hovered.connectionId)
    return { connectionId: dragNode.connectionId, groupId: hovered.groupId, placement: 'last' };
  const groupId = dropNode.groupId;
  if (!groupId) return null;
  if (dropNode.type === 'group')
    return { connectionId: dragNode.connectionId, groupId, placement: 'last' };
  if (dropNode.type === 'connection' && dropToGap && dropNode.connectionId) {
    const position = input.dropPosition - Number((dropNode.pos || '').split('-').at(-1));
    return {
      connectionId: dragNode.connectionId,
      groupId,
      placement: position < 0 ? 'before' : 'after',
      anchorConnectionId: dropNode.connectionId,
    };
  }
  return null;
}
