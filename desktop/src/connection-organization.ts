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
