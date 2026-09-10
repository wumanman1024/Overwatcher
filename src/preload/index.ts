import { contextBridge } from 'electron'
import { ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hardwareMonitor', {
  getSnapshot: () => ipcRenderer.invoke('monitor:get-snapshot'),
  subscribe: (callback: (snapshot: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, snapshot: unknown) => callback(snapshot)
    ipcRenderer.on('monitor:snapshot', listener)
    return () => ipcRenderer.removeListener('monitor:snapshot', listener)
  },
  moveOverlay: (position: { x: number; y: number }) => ipcRenderer.send('monitor:move-overlay', position),
  subscribeStatus: (callback: (text: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, text: string) => callback(text)
    ipcRenderer.on('monitor:status', listener)
    return () => ipcRenderer.removeListener('monitor:status', listener)
  }
})
