import type { Key } from 'react';
import type { TreeNode } from './model';

/** Forget this branch's expansion without discarding its loaded metadata. */
export function collapseTreeBranch(keys: Key[], node: TreeNode): Key[] {
  const collapsed = new Set<Key>();
  function visit(branch: TreeNode) {
    collapsed.add(branch.key);
    branch.children?.forEach(visit);
  }
  visit(node);
  return keys.filter((key) => !collapsed.has(key));
}
