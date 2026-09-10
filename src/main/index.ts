import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen } from 'electron'
import type { MetricSnapshot } from '../shared/metrics'
import { join } from 'node:path'
import { collectBaseMetrics } from './collectors/base'
import { MetricSampler } from './collectors/sampler'
import { collectNvidiaMetrics } from './collectors/nvidia'
import { collectLinuxTemperature } from './collectors/linux-temperature'
import { clickThroughLabel } from './tray-labels'
import { placeAtRightCenter } from './window-placement'
import { formatStatusText } from './status-text'
import { loadOverlayPreferences, saveOverlayPreferences } from './overlay-store'
import { clampPosition } from './overlay-state'

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 92,
    height: 92,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
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

function createStatusWindow(): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({ width: 520, height: 28, x: workArea.x + Math.round((workArea.width - 520) / 2), y: workArea.y + workArea.height - 34, show: false, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false } })
  window.setIgnoreMouseEvents(true)
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?surface=status`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface: 'status' } })
  return window
}

app.whenReady().then(() => {
  let latestSnapshot: MetricSnapshot | undefined
  ipcMain.handle('monitor:get-snapshot', () => latestSnapshot)
  const window = createWindow()
  const statusWindow = createStatusWindow()
  ipcMain.on('monitor:move-overlay', (_event, position: unknown) => {
    if (!position || typeof position !== 'object') return
    const candidate = position as { x?: unknown; y?: unknown }
    if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return
    const bounds = window.getBounds()
    const next = clampPosition({ x: candidate.x, y: candidate.y }, bounds, screen.getDisplayMatching(bounds).workArea)
    window.setPosition(next.x, next.y)
    saveOverlayPreferences({ ...loadOverlayPreferences(), position: next })
  })
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
  const sampler = new MetricSampler([collectBaseMetrics, collectNvidiaMetrics, collectLinuxTemperature])
  const publish = async (): Promise<void> => {
    const snapshot = await sampler.collectOnce()
    latestSnapshot = snapshot
    window.webContents.send('monitor:snapshot', snapshot)
    statusWindow.webContents.send('monitor:status', formatStatusText(snapshot))
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
