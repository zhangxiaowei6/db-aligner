import { useCallback, useEffect, useRef, useState, type Key } from 'react';
import type { TreeNode } from '../model';
import { motion, useReducedMotion } from '../motion';

/** 每个分支单独持有反馈；收起、重开和工作区切换立即使旧反馈失效。 */
export function useTreeExpansion(workspaceId: string) {
  const [loadingKeys, setLoadingKeys] = useState<Key[]>([]);
  const operations = useRef(new Map<Key, { timer?: ReturnType<typeof setTimeout> }>());
  const reduced = useReducedMotion();
  const clear = useCallback((node?: TreeNode) => {
    const keys = new Set<Key>();
    const visit = (branch: TreeNode) => {
      keys.add(branch.key);
      branch.children?.forEach(visit);
    };
    if (node) visit(node);
    for (const [key, operation] of operations.current) {
      if (!node || keys.has(key)) {
        clearTimeout(operation.timer);
        operations.current.delete(key);
      }
    }
    setLoadingKeys((current) => (node ? current.filter((key) => !keys.has(key)) : []));
  }, []);
  useEffect(() => {
    clear();
    const pending = operations.current;
    return () => {
      for (const operation of pending.values()) clearTimeout(operation.timer);
      pending.clear();
    };
  }, [workspaceId, clear]);
  useEffect(() => {
    if (reduced) {
      // 请求反馈继续保留，仅结束纯本地的分组展开反馈。
      for (const key of operations.current.keys()) {
        if (String(key).startsWith('group:')) clear({ key } as TreeNode);
      }
    }
  }, [reduced, clear]);

  function begin(node: TreeNode, load: () => Promise<unknown>) {
    if (!['group', 'connection', 'database', 'schema'].includes(node.type)) return;
    clearTimeout(operations.current.get(node.key)?.timer);
    const operation: { timer?: ReturnType<typeof setTimeout> } = {};
    const started = performance.now();
    operations.current.set(node.key, operation);
    const finish = () => {
      if (operations.current.get(node.key) !== operation) return;
      operations.current.delete(node.key);
      setLoadingKeys((keys) => keys.filter((key) => key !== node.key));
    };
    if (node.type === 'group' && reduced) {
      finish();
      return;
    }
    setLoadingKeys((keys) => [...keys.filter((key) => key !== node.key), node.key]);
    if (node.type === 'group') {
      operation.timer = setTimeout(finish, motion.tree);
      return;
    }
    void load().finally(() => {
      if (operations.current.get(node.key) !== operation) return;
      operation.timer = setTimeout(finish, Math.max(0, 300 - (performance.now() - started)));
    });
  }
  return { loadingKeys, begin, clear };
}
