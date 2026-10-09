import { expect, it } from 'vitest';
import {
  connectionSignature,
  normalizeOrganization,
  orderedConnections,
  portFromText,
} from './connection-organization';
import { initialModel, emptyConnection } from './model';

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
