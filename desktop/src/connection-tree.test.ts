import { expect, it } from 'vitest';
import { collapseTreeBranch } from './connection-tree';
import type { TreeNode } from './model';

const database: TreeNode = {
  key: 'connection/db',
  title: 'db',
  type: 'database',
  children: [{ key: 'connection/db/table', title: 'table', type: 'table', isLeaf: true }],
};
const connection: TreeNode = {
  key: 'connection',
  title: 'connection',
  type: 'connection',
  children: [database],
};
const group: TreeNode = {
  key: 'group:id',
  title: 'group',
  type: 'group',
  children: [connection],
};

it('collapses every descendant while preserving siblings and the cached tree', () => {
  const keys = ['group:id', 'connection', 'connection/db', 'connection/db_other', 'other'];
  const before = structuredClone(group);
  expect(collapseTreeBranch(keys, connection)).toEqual([
    'group:id',
    'connection/db_other',
    'other',
  ]);
  expect(collapseTreeBranch(keys, group)).toEqual(['connection/db_other', 'other']);
  expect(keys).toHaveLength(5);
  expect(group).toEqual(before);
});

it('reopening a collapsed ancestor does not restore nested expansion', () => {
  const keys = collapseTreeBranch(['group:id', 'connection', 'connection/db'], group);
  keys.push('group:id');
  expect(keys).toEqual(['group:id']);
  keys.push('connection');
  expect(keys).toEqual(['group:id', 'connection']);
});
