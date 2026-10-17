// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTreeExpansion } from './useTreeExpansion';
import type { TreeNode } from '../model';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const child: TreeNode = { key: 'connection', title: '连接', type: 'connection' };
const group: TreeNode = { key: 'group:one', title: '分组', type: 'group', children: [child] };
it('gives groups local feedback without queries and clears descendant operations on collapse', async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => {});
  const { result } = renderHook(() => useTreeExpansion('one'));
  act(() => result.current.begin(group, load));
  expect(load).not.toHaveBeenCalled();
  expect(result.current.loadingKeys).toEqual(['group:one']);
  act(() => vi.advanceTimersByTime(180));
  expect(result.current.loadingKeys).toEqual([]);
  let finish!: () => void;
  act(() =>
    result.current.begin(
      child,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  act(() => result.current.clear(group));
  await act(async () => finish());
  act(() => vi.runAllTimers());
  expect(result.current.loadingKeys).toEqual([]);
});
it('rejects stale loading completions after reopening or changing workspace', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const { result, rerender } = renderHook(({ workspace }) => useTreeExpansion(workspace), {
    initialProps: { workspace: 'one' },
  });
  act(() =>
    result.current.begin(
      child,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  act(() => result.current.clear(group));
  act(() => result.current.begin(child, () => new Promise(() => {})));
  await act(async () => finish());
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.loadingKeys).toEqual(['connection']);
  rerender({ workspace: 'two' });
  expect(result.current.loadingKeys).toEqual([]);
});
