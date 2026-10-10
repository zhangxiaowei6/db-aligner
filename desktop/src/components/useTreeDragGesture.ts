import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';

export const TREE_LONG_PRESS_MS = 400;
const MOVE_TOLERANCE = 6;

/** Long press controls cursor feedback; native dragging never has to wait for it. */
export function useTreeDragGesture(disabled: boolean, resetKey: string) {
  const [readyKey, setReadyKey] = useState('');
  const press = useRef<
    { key: string; x: number; y: number; armed: boolean; dragging: boolean } | undefined
  >(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const release = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    press.current = undefined;
    setReadyKey('');
  }, []);
  useEffect(() => {
    release();
  }, [disabled, resetKey, release]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') release();
    };
    document.addEventListener('pointerup', release);
    document.addEventListener('mouseup', release);
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', release);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerup', release);
      document.removeEventListener('mouseup', release);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('blur', release);
    };
  }, [release]);
  return {
    readyKey,
    release,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      release();
      if (disabled || event.button !== 0) return;
      const row = (event.target as Element).closest('.ant-tree-treenode-draggable');
      const label = row?.querySelector<HTMLElement>('.tree-label');
      const key = label?.dataset.nodeKey;
      if (!key || !['group', 'connection'].includes(label!.dataset.nodeType || '')) return;
      press.current = { key, x: event.clientX, y: event.clientY, armed: false, dragging: false };
      timer.current = setTimeout(() => {
        if (press.current?.key !== key) return;
        press.current.armed = true;
        setReadyKey(key);
      }, TREE_LONG_PRESS_MS);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = press.current;
      if (
        current &&
        !current.armed &&
        Math.hypot(event.clientX - current.x, event.clientY - current.y) > MOVE_TOLERANCE
      ) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
    },
    onPointerCancel() {
      if (!press.current?.dragging) release();
    },
    onDragStartCapture(event: DragEvent<HTMLDivElement>) {
      if (!press.current || disabled) {
        event.preventDefault();
        event.stopPropagation();
        release();
      } else {
        press.current.dragging = true;
        clearTimeout(timer.current);
        setReadyKey('');
      }
    },
  };
}
