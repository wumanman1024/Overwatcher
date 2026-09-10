import { app, BrowserWindow, ipcMain, screen } from 'electron'
// 托盘菜单功能暂时停用，恢复时一并取消此处和初始化块的注释。
// import { Menu, Tray, nativeImage } from 'electron'
import type { MetricSnapshot } from '../shared/metrics'
import { join } from 'node:path'
import { collectBaseMetrics } from './collectors/base'
import { MetricSampler } from './collectors/sampler'
import { collectNvidiaMetrics } from './collectors/nvidia'
import { collectLinuxTemperature } from './collectors/linux-temperature'
import { collectPlatformTelemetry } from './collectors/platform-telemetry'
// import { clickThroughLabel } from './tray-labels'
import { placeAtRightCenter } from './window-placement'
// import { formatStatusText } from './status-text'
import { loadOverlayPreferences, saveOverlayPreferences } from './overlay-store'
import { clampPosition, sizeForOverlayMode } from './overlay-state'

// Electron 官方支持的高性能 GPU 开关：多 GPU 设备优先使用独立显卡。
app.commandLine.appendSwitch('force_high_performance_gpu')

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...sizeForOverlayMode('orb'),
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  window.on('ready-to-show', () => {
    const bounds = window.getBounds()
    const preferences = loadOverlayPreferences()
    const position = preferences.position ?? placeAtRightCenter(screen.getPrimaryDisplay().workArea, bounds)
    window.setPosition(position.x, position.y)
    window.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/* 底部状态栏窗口暂时停用。
function createStatusWindow(): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({ width: 520, height: 28, x: workArea.x + Math.round((workArea.width - 520) / 2), y: workArea.y + workArea.height - 34, show: false, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false } })
  window.setIgnoreMouseEvents(true)
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?surface=status`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface: 'status' } })
  return window
}
*/

app.whenReady().then(() => {
  let latestSnapshot: MetricSnapshot | undefined
  ipcMain.handle('monitor:get-snapshot', () => latestSnapshot)
  const window = createWindow()
  // const statusWindow = createStatusWindow()
  ipcMain.on('monitor:move-overlay', (_event, position: unknown) => {
    if (!position || typeof position !== 'object') return
    const candidate = position as { x?: unknown; y?: unknown }
    if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return
    const bounds = window.getBounds()
    const next = clampPosition({ x: candidate.x, y: candidate.y }, bounds, screen.getDisplayMatching(bounds).workArea)
    window.setPosition(next.x, next.y)
    saveOverlayPreferences({ ...loadOverlayPreferences(), position: next })
  })
  ipcMain.on('monitor:set-overlay-expanded', (_event, expanded: unknown) => {
    if (typeof expanded !== 'boolean') return
    const nextSize = sizeForOverlayMode(expanded ? 'expanded' : 'orb')
    const currentBounds = window.getBounds()
    const workArea = screen.getDisplayMatching(currentBounds).workArea
    const position = clampPosition({ x: currentBounds.x, y: currentBounds.y }, nextSize, workArea)
    window.setBounds({ ...position, ...nextSize })
  })
  /* 托盘菜单功能暂时停用。
  let clickThrough = false
  const tray = new Tray(nativeImage.createEmpty())
  const updateTray = (): void => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: window.isVisible() ? '隐藏悬浮窗' : '显示悬浮窗', click: () => window.isVisible() ? window.hide() : window.show() },
      { label: clickThroughLabel(clickThrough), click: () => { clickThrough = !clickThrough; window.setIgnoreMouseEvents(clickThrough, { forward: true }); updateTray() } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]))
  }
  updateTray()
  */
  const sampler = new MetricSampler([collectBaseMetrics, collectNvidiaMetrics, collectLinuxTemperature, collectPlatformTelemetry])
  const publish = async (): Promise<void> => {
    const snapshot = await sampler.collectOnce()
    latestSnapshot = snapshot
    window.webContents.send('monitor:snapshot', snapshot)
    // statusWindow.webContents.send('monitor:status', formatStatusText(snapshot))
    setTimeout(publish, 1000)
  }
  void publish()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
