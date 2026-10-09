import type { DesktopBridge } from './types';
import { previewBridge } from './preview';
import { copyModel } from './copy';
export const preview = new URLSearchParams(location.search).get('preview') === '1';
const bridge: DesktopBridge | undefined = window.dataSync || (preview ? previewBridge : undefined);
export async function api<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (!bridge) throw new Error('请通过桌面客户端启动。浏览器设计预览请使用 ?preview=1。');
  return bridge.invoke<T>(method, copyModel(params));
}
export const onEvent = (fn: (event: Record<string, unknown>) => void) =>
  bridge?.onEvent(fn) || (() => {});
export function windowAction(action: string) {
  bridge?.window(action);
}
