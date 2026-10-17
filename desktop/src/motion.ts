import { useSyncExternalStore } from 'react';
import type { TreeProps } from 'antd';

/** 全应用动效参数；CSS、Ant Design 和内容过渡共用这一份定义。 */
export const motion = {
  press: 100,
  fast: 120,
  content: 180,
  tree: 60,
  slow: 220,
  easing: 'ease-out',
  distance: 6,
};

const query = '(prefers-reduced-motion: reduce)';
function subscribe(listener: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

export const motionVariables = {
  '--motion-press': `${motion.press}ms`,
  '--motion-fast': `${motion.fast}ms`,
  '--motion-content': `${motion.content}ms`,
  '--motion-tree': `${motion.tree}ms`,
  '--motion-slow': `${motion.slow}ms`,
  '--motion-easing': motion.easing,
};

/** 使用树组件的虚拟分支过渡，不为每个节点单独创建动画。 */
export const treeMotion: NonNullable<TreeProps['motion']> = {
  motionName: 'db-tree-collapse',
  motionAppear: false,
  motionDeadline: motion.tree + 100,
  onAppearStart: () => ({ height: 0, opacity: 0 }),
  onAppearActive: (node: HTMLElement) => ({ height: node.scrollHeight, opacity: 1 }),
  onAppearEnd: (_: HTMLElement, event?: { deadline?: boolean; propertyName?: string }) =>
    event?.deadline === true || event?.propertyName === 'height',
  onEnterStart: () => ({ height: 0, opacity: 0 }),
  onEnterActive: (node: HTMLElement) => ({ height: node.scrollHeight, opacity: 1 }),
  onLeaveStart: (node: HTMLElement) => ({ height: node.offsetHeight, opacity: 1 }),
  onLeaveActive: () => ({ height: 0, opacity: 0 }),
  onEnterEnd: (_: HTMLElement, event?: { deadline?: boolean; propertyName?: string }) =>
    event?.deadline === true || event?.propertyName === 'height',
  onLeaveEnd: (_: HTMLElement, event?: { deadline?: boolean; propertyName?: string }) =>
    event?.deadline === true || event?.propertyName === 'height',
};
