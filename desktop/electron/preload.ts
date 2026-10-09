import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('dataSync', {
  invoke: (method: string, params: Record<string, unknown> = {}) =>
    ipcRenderer.invoke('datasync:invoke', method, params),
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown) => callback(event);
    ipcRenderer.on('datasync:event', listener);
    return () => ipcRenderer.removeListener('datasync:event', listener);
  },
  window: (action: string) => ipcRenderer.send('datasync:window', action),
});
