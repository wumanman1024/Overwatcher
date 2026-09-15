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
  deleteDirectories: (ids: string[]) => ipcRenderer.invoke('toolbox:delete-directories', ids),
  selectImageOutputDirectory: () => ipcRenderer.invoke('image:select-output-directory'),
  saveCompressedImages: (outputDirectory: string, files: Array<{ name: string; data: ArrayBuffer }>) => ipcRenderer.invoke('image:save-compressed-images', { outputDirectory, files })
})

contextBridge.exposeInMainWorld('networkTools', {
  getLocalIpv4: () => ipcRenderer.invoke('network:get-local-ipv4'),
  detectExitIp: () => ipcRenderer.invoke('network:detect-exit-ip'),
  diagnose: (host: string, port: number) => ipcRenderer.invoke('network:diagnose', { host, port })
})

contextBridge.exposeInMainWorld('processTools', {
  listListening: () => ipcRenderer.invoke('process:list-listening'),
  terminate: (pid: number) => ipcRenderer.invoke('process:terminate', pid)
})

contextBridge.exposeInMainWorld('voltaTools', {
  getNodeState: () => ipcRenderer.invoke('volta:get-node-state'),
  installNode: (version: string) => ipcRenderer.invoke('volta:install-node', version),
  pinNode: (version: string, directory: string) => ipcRenderer.invoke('volta:pin-node', { version, directory })
})

contextBridge.exposeInMainWorld('nvmTools', {
  getNodeState: () => ipcRenderer.invoke('nvm:get-node-state'),
  installNode: (version: string) => ipcRenderer.invoke('nvm:install-node', version),
  useNode: (version: string) => ipcRenderer.invoke('nvm:use-node', version),
  uninstallNode: (version: string) => ipcRenderer.invoke('nvm:uninstall-node', version)
})

contextBridge.exposeInMainWorld('assistantConfig', {
  read: (tool: string, file: 'prompt' | 'config') => ipcRenderer.invoke('assistant-config:read', { tool, file }),
  save: (tool: string, file: 'prompt' | 'config', content: string) => ipcRenderer.invoke('assistant-config:save', { tool, file, content })
})

contextBridge.exposeInMainWorld('nodeReleaseTools', {
  list: () => ipcRenderer.invoke('node-releases:list'),
  installManager: (manager: 'volta' | 'nvm') => ipcRenderer.invoke('version-manager:install', manager)
})

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized')
})

contextBridge.exposeInMainWorld('screenColorPicker', {
  pick: () => ipcRenderer.invoke('screen-color:pick'),
  preview: (point: { x: number; y: number }) => ipcRenderer.invoke('screen-color:preview', point),
  choose: (point: { x: number; y: number }) => ipcRenderer.send('screen-color:choose', point),
  cancel: () => ipcRenderer.send('screen-color:cancel')
})
