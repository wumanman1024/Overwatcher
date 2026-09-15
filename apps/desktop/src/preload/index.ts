import { contextBridge } from 'electron'
import { ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hardwareMonitor', {
  getSnapshot: () => ipcRenderer.invoke('monitor:get-snapshot'),
  getHistory: () => ipcRenderer.invoke('monitor:get-history'),
  subscribe: (callback: (snapshot: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: unknown) => callback(snapshot)
    ipcRenderer.on('monitor:snapshot', listener)
    return () => ipcRenderer.removeListener('monitor:snapshot', listener)
  },
  moveOverlay: (position: { x: number; y: number }) => ipcRenderer.send('monitor:move-overlay', position),
  movePanel: (position: { x: number; y: number }) => ipcRenderer.send('monitor:move-panel', position),
  moveTrend: (position: { x: number; y: number }) => ipcRenderer.send('monitor:move-trend', position),
  openPanel: () => ipcRenderer.send('monitor:open-panel'),
  closePanel: () => ipcRenderer.send('monitor:close-panel'),
  openTrend: () => ipcRenderer.send('monitor:open-trend'),
  closeTrend: () => ipcRenderer.send('monitor:close-trend'),
  subscribeStatus: (callback: (text: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, text: string) => callback(text)
    ipcRenderer.on('monitor:status', listener)
    return () => ipcRenderer.removeListener('monitor:status', listener)
  }
})

contextBridge.exposeInMainWorld('developerTools', {
  selectDirectory: () => ipcRenderer.invoke('toolbox:select-directory'),
  scanDirectories: (rootPath: string, directoryName: string) => ipcRenderer.invoke('toolbox:scan-directories', { rootPath, directoryName }),
  deleteDirectories: (ids: string[]) => ipcRenderer.invoke('toolbox:delete-directories', ids)
})

contextBridge.exposeInMainWorld('networkTools', {
  detectExitIp: () => ipcRenderer.invoke('network:detect-exit-ip'),
  diagnose: (host: string, port: number) => ipcRenderer.invoke('network:diagnose', { host, port })
})

contextBridge.exposeInMainWorld('processTools', {
  listListening: () => ipcRenderer.invoke('process:list-listening'),
  terminate: (pid: number) => ipcRenderer.invoke('process:terminate', pid)
})

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized')
})
