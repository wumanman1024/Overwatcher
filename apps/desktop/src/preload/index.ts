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
  diagnose: (host: string, port: number, mode: 'tcp' | 'http' | 'https') => ipcRenderer.invoke('network:diagnose', { host, port, mode })
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
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized')
})

contextBridge.exposeInMainWorld('screenColorPicker', {
  pick: () => ipcRenderer.invoke('screen-color:pick'),
  preview: (point: { x: number; y: number }) => ipcRenderer.invoke('screen-color:preview', point),
  choose: (point: { x: number; y: number }) => ipcRenderer.send('screen-color:choose', point),
  cancel: () => ipcRenderer.send('screen-color:cancel')
})

contextBridge.exposeInMainWorld('menuSqlTools', {
  saveScript: (request: { fileName?: string; content: string }) => ipcRenderer.invoke('menu-sql:save-script', request)
})

// 模型配置的增删改查，落到主进程的 SQLite；渲染层不直接碰数据库。
contextBridge.exposeInMainWorld('modelConfigs', {
  list: () => ipcRenderer.invoke('model-configs:list'),
  save: (input: unknown, id?: string) => ipcRenderer.invoke('model-configs:save', { input, id }),
  remove: (id: string) => ipcRenderer.invoke('model-configs:delete', { id }),
  setDefault: (id: string) => ipcRenderer.invoke('model-configs:set-default', { id })
})

// 只转发配置，模型地址/密钥由渲染层传入，preload 不保存任何东西。
contextBridge.exposeInMainWorld('llmTools', {
  test: (config: unknown) => ipcRenderer.invoke('llm:test', { config: plain(config) }),
  chat: (request: unknown) => ipcRenderer.invoke('llm:chat', plain(request)),
  chatStream: (request: { config: unknown; messages: unknown }) => {
    const requestId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    // 三个通道全进程共享，靠 requestId 区分本次调用；每个订阅都返回只解绑自己的闭包。
    const subscribe = <T extends { requestId?: string }>(channel: string, callback: (payload: T) => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: unknown) => {
        const event = payload as T
        if (event?.requestId === requestId) callback(event)
      }
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
    ipcRenderer.send('llm:chat-stream', plain({ ...request, requestId }))
    type StreamPayload = { requestId?: string; delta?: string; finishReason?: string; error?: string }
    return {
      onChunk: (callback: (delta: string) => void) => subscribe<StreamPayload>('llm:chunk', (payload) => callback(payload.delta ?? '')),
      onDone: (callback: (finishReason?: string) => void) => subscribe<StreamPayload>('llm:done', (payload) => callback(payload.finishReason)),
      onError: (callback: (error: string) => void) => subscribe<StreamPayload>('llm:error', (payload) => callback(payload.error ?? '模型调用失败'))
    }
  }
})
