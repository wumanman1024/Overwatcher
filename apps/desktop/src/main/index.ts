import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import type { HardwareProfile, MetricSnapshot } from '@hardware-overlay/shared/metrics'
import { join } from 'node:path'
import { collectBaseMetrics } from './collectors/base'
import { MetricSampler } from './collectors/sampler'
import { collectNvidiaMetrics } from './collectors/nvidia'
import { collectLinuxTemperature } from './collectors/linux-temperature'
import { collectPlatformTelemetry } from './collectors/platform-telemetry'
import { collectHardwareProfile } from './collectors/hardware-profile'
import { placeAtRightCenter } from './window-placement'
// import { formatStatusText } from './status-text'
import { loadOverlayPreferences, saveOverlayPreferences } from './overlay-store'
import { clampPosition, selectWorkAreaForPosition, sizeForOverlayMode } from '@hardware-overlay/shared/overlay-state'
import { ensureSingleInstance } from './startup'
import { installMainErrorLogging } from './runtime-errors'

installMainErrorLogging()
let tray: Tray | undefined
if (!ensureSingleInstance(app)) {
  process.exit(0)
}

function createOrbWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...sizeForOverlayMode('orb'),
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
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

function createPanelWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...sizeForOverlayMode('expanded'),
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  window.once('ready-to-show', () => {
    const bounds = window.getBounds()
    const position = placeAtRightCenter(screen.getPrimaryDisplay().workArea, bounds)
    window.setPosition(position.x, position.y)
    window.show()
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?surface=panel`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface: 'panel' } })
  return window
}

function createTrendWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 860,
    height: 440,
    minWidth: 720,
    minHeight: 380,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  window.once('ready-to-show', () => {
    const bounds = window.getBounds()
    const position = placeAtRightCenter(screen.getPrimaryDisplay().workArea, bounds)
    window.setPosition(position.x, position.y)
    window.show()
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?surface=trend`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface: 'trend' } })
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
  let hardwareProfile: HardwareProfile | undefined
  let snapshotHistory: MetricSnapshot[] = []
  const desktopDisplays = screen.getAllDisplays().map((display) => ({ ...display.bounds, scaleFactor: display.scaleFactor }))
  void collectHardwareProfile(desktopDisplays).then((profile) => { hardwareProfile = profile }).catch((error) => console.error('[硬件监控] 读取硬件档案失败', error))
  ipcMain.handle('monitor:get-snapshot', () => latestSnapshot)
  ipcMain.handle('monitor:get-history', () => snapshotHistory)
  const window = createOrbWindow()
  let panelWindow: BrowserWindow | undefined
  let trendWindow: BrowserWindow | undefined
  // const statusWindow = createStatusWindow()
  const moveWindow = (targetWindow: BrowserWindow | undefined, position: unknown): void => {
    if (!targetWindow || targetWindow.isDestroyed()) return
    if (!position || typeof position !== 'object') return
    const candidate = position as { x?: unknown; y?: unknown }
    if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return
    const bounds = targetWindow.getBounds()
    const requestedPosition = { x: Math.round(candidate.x), y: Math.round(candidate.y) }
    const workAreas = screen.getAllDisplays().map((display) => display.workArea)
    const targetWorkArea = selectWorkAreaForPosition(requestedPosition, bounds, workAreas)
    const next = clampPosition(requestedPosition, bounds, targetWorkArea)
    targetWindow.setPosition(next.x, next.y)
    if (targetWindow === window) saveOverlayPreferences({ ...loadOverlayPreferences(), position: next })
  }
  ipcMain.on('monitor:move-overlay', (_event, position: unknown) => moveWindow(window, position))
  ipcMain.on('monitor:move-panel', (_event, position: unknown) => moveWindow(panelWindow, position))
  ipcMain.on('monitor:move-trend', (_event, position: unknown) => moveWindow(trendWindow, position))
  const openPanel = (): void => {
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.show()
      panelWindow.focus()
      return
    }
    panelWindow = createPanelWindow()
    panelWindow.on('closed', () => { panelWindow = undefined })
  }
  const openTrend = (): void => {
    if (trendWindow && !trendWindow.isDestroyed()) {
      trendWindow.show()
      trendWindow.focus()
      return
    }
    trendWindow = createTrendWindow()
    trendWindow.on('closed', () => { trendWindow = undefined })
  }
  ipcMain.on('monitor:open-panel', openPanel)
  ipcMain.on('monitor:close-panel', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.on('monitor:open-trend', openTrend)
  ipcMain.on('monitor:close-trend', (event) => BrowserWindow.fromWebContents(event.sender)?.close())

  const iconPath = app.isPackaged
    ? join(__dirname, '../renderer/core-pulse-icon.png')
    : join(__dirname, '../../build/core-pulse-icon.png')
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))
  tray.setToolTip('硬件监控')
  const updateTray = (): void => {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: '打开监控中心', click: openPanel },
      { label: '打开趋势分析', click: openTrend },
      { type: 'separator' },
      { label: window.isVisible() ? '隐藏悬浮窗' : '显示悬浮窗', click: () => { window.isVisible() ? window.hide() : window.show(); updateTray() } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]))
  }
  tray.on('click', openPanel)
  tray.on('double-click', openPanel)
  updateTray()
  const sampler = new MetricSampler([collectBaseMetrics, collectNvidiaMetrics, collectLinuxTemperature, collectPlatformTelemetry])
  const publish = async (): Promise<void> => {
    const metrics = await sampler.collectOnce()
    const displaySection = hardwareProfile?.sections.find((section) => section.key === 'display')
    const mainDisplay = displaySection?.groups?.find((group) => group.status === '主屏') ?? displaySection?.groups?.[0]
    const correctedResolution = mainDisplay?.fields.find((item) => item.label === '当前分辨率')?.value
    const correctedMetrics = correctedResolution && metrics.display
      ? { ...metrics, display: { ...metrics.display, detail: correctedResolution.replace(/\s/g, '') } }
      : metrics
    const snapshot: MetricSnapshot = { ...correctedMetrics, ...(hardwareProfile ? { hardware: hardwareProfile } : {}) }
    latestSnapshot = snapshot
    snapshotHistory = [...snapshotHistory, snapshot].slice(-60)
    window.webContents.send('monitor:snapshot', snapshot)
    panelWindow?.webContents.send('monitor:snapshot', snapshot)
    trendWindow?.webContents.send('monitor:snapshot', snapshot)
    // statusWindow.webContents.send('monitor:status', formatStatusText(snapshot))
    setTimeout(publish, 1000)
  }
  void publish()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOrbWindow()
  })
})

app.on('window-all-closed', () => {
  // 系统托盘常驻；退出操作由托盘菜单明确触发。
})
