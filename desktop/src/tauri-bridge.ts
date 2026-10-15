import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DesktopBridge } from './types';

const pendingListeners = new Set<Promise<void>>();
let listenerError: Error | undefined;

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return new Error(message);
  }
  return new Error(String(error));
}

export const tauriBridge: DesktopBridge = {
  async invoke<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      return await invoke<T>('dbaligner_invoke', { method, params });
    } catch (error) {
      throw asError(error);
    }
  },
  onEvent(fn) {
    let active = true;
    let stop: (() => void) | undefined;
    const registration = listen<Record<string, unknown>>('dbaligner:event', ({ payload }) => {
      if (active) fn(payload);
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    });
    pendingListeners.add(registration);
    void registration
      .finally(() => pendingListeners.delete(registration))
      .catch((error: unknown) => {
        listenerError = asError(error);
        console.error('桌面事件监听失败', listenerError);
      });
    return () => {
      active = false;
      stop?.();
      stop = undefined;
    };
  },
  window(action) {
    void (async () => {
      // The host must not emit startup or close events before React is listening.
      if (action === 'renderer-ready') {
        if (listenerError) throw listenerError;
        await Promise.resolve(); // Let the remaining mount effects register their listeners.
        await Promise.all(pendingListeners);
        if (listenerError) throw listenerError;
      }
      await invoke('dbaligner_window', { action });
    })().catch((error: unknown) => console.error('窗口操作失败', asError(error)));
  },
};
