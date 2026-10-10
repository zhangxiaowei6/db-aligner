// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TREE_LONG_PRESS_MS, useTreeDragGesture } from './useTreeDragGesture';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});
function setup() {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div class="ant-tree-treenode-draggable"><span class="tree-label" data-node-key="group:a" data-node-type="group">A</span></div>';
  const hook = renderHook(({ disabled, workspace }) => useTreeDragGesture(disabled, workspace), {
    initialProps: { disabled: false, workspace: 'a' },
  });
  const down = () =>
    act(() =>
      hook.result.current.onPointerDown({
        button: 0,
        target: document.querySelector('.tree-label'),
        clientX: 10,
        clientY: 20,
      } as never),
    );
  return { ...hook, down };
}
it('shows grab after 400 ms but permits dragging immediately without waiting for the cursor', () => {
  const hook = setup();
  hook.down();
  act(() => vi.advanceTimersByTime(TREE_LONG_PRESS_MS - 1));
  expect(hook.result.current.readyKey).toBe('');
  act(() => vi.advanceTimersByTime(1));
  expect(hook.result.current.readyKey).toBe('group:a');
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  act(() => hook.result.current.onDragStartCapture(event as never));
  expect(event.preventDefault).not.toHaveBeenCalled();
  act(() => hook.result.current.onPointerCancel());
  expect(hook.result.current.readyKey).toBe('');
  act(() => hook.result.current.release());
  hook.down();
  act(() => hook.result.current.onDragStartCapture(event as never));
  expect(event.preventDefault).not.toHaveBeenCalled();
  act(() => hook.result.current.release());
  act(() => hook.result.current.onDragStartCapture(event as never));
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
});
it('cancels short clicks, early movement, Escape and workspace changes without arming later', () => {
  const hook = setup();
  hook.down();
  act(() => document.dispatchEvent(new Event('pointerup')));
  act(() => vi.advanceTimersByTime(500));
  expect(hook.result.current.readyKey).toBe('');
  hook.down();
  act(() => hook.result.current.onPointerMove({ clientX: 18, clientY: 20 } as never));
  act(() => vi.advanceTimersByTime(500));
  expect(hook.result.current.readyKey).toBe('');
  hook.down();
  act(() => vi.advanceTimersByTime(400));
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(hook.result.current.readyKey).toBe('');
  hook.down();
  hook.rerender({ disabled: false, workspace: 'b' });
  act(() => vi.advanceTimersByTime(500));
  expect(hook.result.current.readyKey).toBe('');
});
