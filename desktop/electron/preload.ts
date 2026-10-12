import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('dbAligner', {
  invoke: (method: string, params: Record<string, unknown> = {}) =>
    ipcRenderer.invoke('dbaligner:invoke', method, params),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown) => callback(event);
    ipcRenderer.on('dbaligner:event', listener);
    return () => ipcRenderer.removeListener('dbaligner:event', listener);
  },
  window: (action: string) => ipcRenderer.send('dbaligner:window', action),
});
