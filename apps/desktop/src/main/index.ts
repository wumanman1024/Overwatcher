import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, net as electronNet, screen, Tray } from 'electron'
import type { HardwareProfile, MetricSnapshot } from '@localforge/shared/metrics'
import { basename, join, parse, relative, resolve } from 'node:path'
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lookup, resolve4, resolve6 } from 'node:dns/promises'
import { connect } from 'node:net'
import { homedir, networkInterfaces } from 'node:os'
import { collectBaseMetrics } from './collectors/base'
import { MetricSampler } from './collectors/sampler'
import { collectNvidiaMetrics } from './collectors/nvidia'
import { collectLinuxTemperature } from './collectors/linux-temperature'
import { collectPlatformTelemetry } from './collectors/platform-telemetry'
import { collectHardwareProfile } from './collectors/hardware-profile'
import { placeAtRightCenter } from './window-placement'
// import { formatStatusText } from './status-text'
import { loadOverlayPreferences, saveOverlayPreferences } from './overlay-store'
import { clampPosition, selectWorkAreaForPosition, sizeForOverlayMode } from '@localforge/shared/overlay-state'
import { ensureSingleInstance } from './startup'
import { installMainErrorLogging } from './runtime-errors'

installMainErrorLogging()
let tray: Tray | undefined
if (!ensureSingleInstance(app)) {
  process.exit(0)
}

function applicationIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app-icon.png') : join(__dirname, '../../build/app-icon.png')
}

function trayIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'tray-icon.png') : join(__dirname, '../../build/tray-icon.png')
}

type ListeningProcess = { protocol: string; address: string; port: number; pid: number; name: string }
type LocalIpv4 = { name: string; address: string }
type AssistantConfigTool = 'codex' | 'cursor' | 'claude-code'
type AssistantConfigFile = 'prompt' | 'config'
type ScreenColorPickerSession = {
  sourceWindow: BrowserWindow
  overlayWindows: BrowserWindow[]
  resolve: (color: string) => void
  reject: (error: Error) => void
}

function assistantConfigPath(tool: AssistantConfigTool, file: AssistantConfigFile): string {
  const userHome = homedir()
  const appData = process.env.APPDATA || join(userHome, 'AppData', 'Roaming')
  const paths: Record<AssistantConfigTool, Record<AssistantConfigFile, string>> = {
    codex: { prompt: join(userHome, '.codex', 'AGENTS.md'), config: join(userHome, '.codex', 'config.toml') },
    cursor: { prompt: join(userHome, '.cursor', 'rules', 'global.mdc'), config: join(appData, 'Cursor', 'User', 'settings.json') },
    'claude-code': { prompt: join(userHome, '.claude', 'CLAUDE.md'), config: join(userHome, '.claude', 'settings.json') }
  }
  return paths[tool][file]
}

function assertAssistantConfigRequest(request: unknown): { tool: AssistantConfigTool; file: AssistantConfigFile; content?: string } {
  const { tool, file, content } = request as { tool?: unknown; file?: unknown; content?: unknown }
  if (tool !== 'codex' && tool !== 'cursor' && tool !== 'claude-code') throw new Error('不支持的 AI 编程助手')
  if (file !== 'prompt' && file !== 'config') throw new Error('不支持的文件类型')
  if (content !== undefined && typeof content !== 'string') throw new Error('配置内容无效')
  return { tool, file, content }
}

function localIpv4Addresses(): { lan: LocalIpv4[]; wired: LocalIpv4[] } {
  const lan: LocalIpv4[] = []
  const wired: LocalIpv4[] = []
  const seen = new Set<string>()
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      // 某些 Node/Electron 组合会以数字 4 表示地址族；链路本地地址
      // 也是有效的本机 IPv4，不能因为没有 DHCP 地址而被隐藏。
      if (String(entry.family) !== 'IPv4' || entry.internal) continue
      const address = { name, address: entry.address }
      if (!seen.has(`${name}:${entry.address}`)) {
        seen.add(`${name}:${entry.address}`)
        lan.push(address)
        if (/ethernet|以太网|本地连接/i.test(name)) wired.push(address)
      }
    }
  }
  return { lan, wired }
}

function commandOutput(command: string, args: string[], options?: { cwd?: string }): Promise<string> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { windowsHide: true, ...options })
    let output = ''
    let errorOutput = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString() })
    child.once('error', rejectCommand)
    child.once('exit', (code) => code === 0 ? resolveCommand(output) : rejectCommand(new Error(errorOutput || `${command} 退出，代码 ${code ?? '未知'}`)))
  })
}

function voltaVersionFrom(output: string): string | undefined {
  return output.match(/node@([^\s(]+)/)?.[1]
}

function assertNodeSpecifier(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Node 版本参数无效')
  const specifier = value.trim()
  if (!/^(?:v?\d+(?:\.\d+){0,2}|latest|lts(?:\/[a-z0-9-]+)?)$/i.test(specifier)) {
    throw new Error('请输入版本号（例如 22、22.18.0、lts 或 latest）')
  }
  return specifier
}

type NvmAvailableRelease = { version: string; channel: 'CURRENT' | 'LTS' | 'OLD STABLE' | 'OLD UNSTABLE' }
let nvmAvailableReleaseCache: { expiresAt: number; releases: NvmAvailableRelease[] } | undefined

async function getNvmDownloadableNodeReleases(): Promise<NvmAvailableRelease[]> {
  if (nvmAvailableReleaseCache && nvmAvailableReleaseCache.expiresAt > Date.now()) return nvmAvailableReleaseCache.releases
  const output = await commandOutput('nvm', ['list', 'available'])
  const channels: NvmAvailableRelease['channel'][] = ['CURRENT', 'LTS', 'OLD STABLE', 'OLD UNSTABLE']
  const releases = output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim().startsWith('|') || /^\|[-\s|]+\|$/.test(line)) return []
    const columns = line.split('|').slice(1, -1).map((item) => item.trim())
    if (columns.some((value) => /CURRENT|LTS|OLD/i.test(value))) return []
    return columns.flatMap((version, index) => /^\d+\.\d+\.\d+$/.test(version) ? [{ version, channel: channels[index] }] : [])
  })
  nvmAvailableReleaseCache = { releases, expiresAt: Date.now() + 15 * 60_000 }
  return releases
}

async function installVersionManager(manager: unknown): Promise<void> {
  if (process.platform !== 'win32') throw new Error('内置安装入口当前仅支持 Windows')
  const packageId = manager === 'volta' ? 'Volta.Volta' : manager === 'nvm' ? 'CoreyButler.NVMforWindows' : undefined
  if (!packageId) throw new Error('版本管理工具参数无效')
  await commandOutput('winget', ['install', '--exact', '--id', packageId, '--accept-package-agreements', '--accept-source-agreements'])
}

async function getVoltaNodeState(): Promise<{ installed: boolean; voltaVersion?: string; versions: Array<{ version: string; isDefault: boolean }>; defaultVersion?: string; currentVersion?: string; error?: string }> {
  try {
    const [voltaVersion, listOutput, defaultOutput, currentOutput] = await Promise.all([
      commandOutput('volta', ['--version']),
      commandOutput('volta', ['list', 'all', '--format', 'plain']),
      commandOutput('volta', ['list', 'node', '--default', '--format', 'plain']).catch(() => ''),
      commandOutput('volta', ['list', 'node', '--current', '--format', 'plain']).catch(() => '')
    ])
    const parsedVersions = Array.from(listOutput.matchAll(/node@([^\s(]+)/g), (match) => ({
      version: match[1],
      isDefault: /\(default\)/.test(match[0])
    }))
    const versions = Array.from(parsedVersions.reduce((items, item) => {
      const existing = items.get(item.version)
      items.set(item.version, { ...item, isDefault: item.isDefault || existing?.isDefault || false })
      return items
    }, new Map<string, { version: string; isDefault: boolean }>()).values())
    const defaultVersion = voltaVersionFrom(defaultOutput) ?? versions.find((item) => item.isDefault)?.version
    return {
      installed: true,
      voltaVersion: voltaVersion.trim(),
      versions: versions.map((item) => ({ ...item, isDefault: item.isDefault || item.version === defaultVersion })),
      defaultVersion,
      currentVersion: voltaVersionFrom(currentOutput)
    }
  } catch (error) {
    return { installed: false, versions: [], error: error instanceof Error ? error.message : String(error) }
  }
}

async function getNvmNodeState(): Promise<{ installed: boolean; nvmVersion?: string; versions: Array<{ version: string; isCurrent: boolean }>; currentVersion?: string; error?: string }> {
  try {
    const [nvmVersion, listOutput] = await Promise.all([
      commandOutput('nvm', ['version']),
      commandOutput('nvm', ['list'])
    ])
    const versions = listOutput.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(\*)?\s*v?(\d+(?:\.\d+){0,2})/)
      return match ? [{ version: match[2], isCurrent: Boolean(match[1]) || /currently using/i.test(line) }] : []
    })
    return {
      installed: true,
      nvmVersion: nvmVersion.trim(),
      versions,
      currentVersion: versions.find((item) => item.isCurrent)?.version
    }
  } catch (error) {
    return { installed: false, versions: [], error: error instanceof Error ? error.message : String(error) }
  }
}

async function processNameForPid(pid: number): Promise<string> {
  if (process.platform !== 'win32') return '未知进程'
  const output = await commandOutput('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).catch(() => '')
  const match = output.match(/^"([^"]+)"/m)
  return match?.[1] ?? '未知进程'
}

async function listListeningProcesses(): Promise<ListeningProcess[]> {
  if (process.platform !== 'win32') throw new Error('端口进程管理当前仅支持 Windows')
  const output = await commandOutput('netstat.exe', ['-ano', '-p', 'tcp'])
  const rows = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => /\sLISTENING\s/i.test(line))
  const parsed = rows.map((line) => {
    const fields = line.split(/\s+/)
    const local = fields[1]
    const pid = Number(fields.at(-1))
    const separator = local.lastIndexOf(':')
    const port = Number(local.slice(separator + 1))
    return { protocol: fields[0]?.toUpperCase() ?? 'TCP', address: local.slice(0, separator), port, pid }
  }).filter((item) => Number.isInteger(item.port) && item.port > 0 && Number.isInteger(item.pid) && item.pid > 0)
  const withNames = await Promise.all(parsed.map(async (item) => ({ ...item, name: await processNameForPid(item.pid) })))
  return withNames.sort((left, right) => left.port - right.port)
}

function diagnoseTcp(host: string, port: number): Promise<{ reachable: boolean; latencyMs?: number; error?: string }> {
  return new Promise((resolveDiagnosis) => {
    const startedAt = performance.now()
    const socket = connect({ host, port })
    const finish = (result: { reachable: boolean; latencyMs?: number; error?: string }) => {
      socket.removeAllListeners()
      socket.destroy()
      resolveDiagnosis(result)
    }
    socket.setTimeout(5_000)
    socket.once('connect', () => finish({ reachable: true, latencyMs: Math.round(performance.now() - startedAt) }))
    socket.once('timeout', () => finish({ reachable: false, error: '连接超时（5 秒）' }))
    socket.once('error', (error) => finish({ reachable: false, error: error.message }))
  })
}

async function removeDirectory(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    await rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
    return
  }
  await new Promise<void>((resolveRemove, rejectRemove) => {
    // Windows 的 rd 直接由系统处理目录树，通常比逐文件删除更适合 node_modules 这类小文件集合。
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `rd /s /q "${path}"`], { windowsHide: true })
    child.once('error', rejectRemove)
    child.once('exit', (code) => code === 0 ? resolveRemove() : rejectRemove(new Error(`Windows 删除命令退出，代码 ${code ?? '未知'}`)))
  })
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
    minWidth: 860,
    minHeight: 620,
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

function createToolboxWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1060,
    height: 740,
    minWidth: 860,
    minHeight: 620,
    show: false,
    title: 'LocalForge',
    icon: applicationIconPath(),
    backgroundColor: '#f5f6f7',
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?surface=toolbox`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface: 'toolbox' } })
  return window
}

function createScreenColorPickerWindow(display: Electron.Display): BrowserWindow {
  const { x, y, width, height } = display.bounds
  const window = new BrowserWindow({
    x, y, width, height, show: false, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const query = { surface: 'screen-color-picker', displayId: String(display.id) }
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query).toString()}`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query })
  return window
}

async function readScreenColor(point: Electron.Point): Promise<{ color: string; preview: string }> {
  const display = screen.getDisplayNearestPoint(point)
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const displayIndex = screen.getAllDisplays().findIndex((item) => item.id === display.id)
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[displayIndex]
  if (!source) throw new Error('无法读取当前显示器画面')
  const image = source.thumbnail
  const { width, height } = image.getSize()
  if (!width || !height) throw new Error('当前显示器未返回可用画面')
  const x = Math.min(width - 1, Math.max(0, Math.floor((point.x - display.bounds.x) / display.bounds.width * width)))
  const y = Math.min(height - 1, Math.max(0, Math.floor((point.y - display.bounds.y) / display.bounds.height * height)))
  const bitmap = image.toBitmap()
  const offset = (y * width + x) * 4
  // Windows 的 NativeImage 位图是 BGRA；这里显式转换以避免红蓝通道互换。
  const color = `#${[bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  const cropSize = Math.min(17, width, height)
  const cropX = Math.min(width - cropSize, Math.max(0, x - Math.floor(cropSize / 2)))
  const cropY = Math.min(height - cropSize, Math.max(0, y - Math.floor(cropSize / 2)))
  const preview = image.crop({ x: cropX, y: cropY, width: cropSize, height: cropSize }).resize({ width: 153, height: 153, quality: 'best' }).toDataURL()
  return { color, preview }
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
  Menu.setApplicationMenu(null)
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
  let toolboxWindow: BrowserWindow | undefined
  let screenColorPicker: ScreenColorPickerSession | undefined
  let screenColorCapturePending = false
  const finishScreenColorPicker = (result?: { color?: string; error?: Error }): void => {
    const session = screenColorPicker
    if (!session) return
    screenColorPicker = undefined
    screenColorCapturePending = false
    for (const overlay of session.overlayWindows) if (!overlay.isDestroyed()) overlay.destroy()
    if (!session.sourceWindow.isDestroyed()) session.sourceWindow.show()
    if (result?.color) session.resolve(result.color)
    else session.reject(result?.error ?? new Error('已取消屏幕取色'))
  }
  const startScreenColorPicker = (sourceWindow: BrowserWindow): Promise<string> => new Promise((resolvePicker, rejectPicker) => {
    if (screenColorPicker) { rejectPicker(new Error('屏幕取色已在进行中')); return }
    const displays = screen.getAllDisplays()
    if (!displays.length) { rejectPicker(new Error('未检测到可用显示器')); return }
    sourceWindow.hide()
    const overlayWindows = displays.map(createScreenColorPickerWindow)
    screenColorPicker = { sourceWindow, overlayWindows, resolve: resolvePicker, reject: rejectPicker }
    let readyCount = 0
    const showWhenReady = (): void => {
      readyCount += 1
      if (readyCount === overlayWindows.length && screenColorPicker?.overlayWindows === overlayWindows) overlayWindows.forEach((overlay) => overlay.showInactive())
    }
    overlayWindows.forEach((overlay) => overlay.once('ready-to-show', showWhenReady))
  })
  const cleanupTargets = new Map<string, { path: string; rootPath: string; directoryName: string }>()
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
  const openToolbox = (): void => {
    if (toolboxWindow && !toolboxWindow.isDestroyed()) {
      toolboxWindow.show()
      toolboxWindow.focus()
      return
    }
    toolboxWindow = createToolboxWindow()
    toolboxWindow.on('closed', () => { toolboxWindow = undefined })
  }
  ipcMain.on('monitor:open-panel', openPanel)
  ipcMain.on('monitor:close-panel', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.on('monitor:open-trend', openTrend)
  ipcMain.on('monitor:close-trend', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.on('window:toggle-maximize', (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target) return
    if (target.isMaximized()) target.unmaximize()
    else target.maximize()
  })
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
  ipcMain.handle('screen-color:pick', (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)
    if (!sourceWindow) throw new Error('无法确定取色来源窗口')
    return startScreenColorPicker(sourceWindow)
  })
  ipcMain.on('screen-color:cancel', () => finishScreenColorPicker())
  ipcMain.handle('screen-color:preview', async (_event, point: unknown) => {
    if (!screenColorPicker || !point || typeof point !== 'object') throw new Error('屏幕取色未启动')
    const { x, y } = point as { x?: unknown; y?: unknown }
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('取色坐标无效')
    return readScreenColor({ x: Math.round(x), y: Math.round(y) })
  })
  ipcMain.on('screen-color:choose', async (_event, point: unknown) => {
    if (!point || typeof point !== 'object') return
    const { x, y } = point as { x?: unknown; y?: unknown }
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return
    if (!screenColorPicker || screenColorCapturePending) return
    screenColorCapturePending = true
    for (const overlay of screenColorPicker.overlayWindows) if (!overlay.isDestroyed()) overlay.destroy()
    try {
      // 等待合成器移除准星覆盖层，确保截图不会把取色 UI 本身采进去。
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 80))
      const { color } = await readScreenColor({ x: Math.round(x), y: Math.round(y) })
      finishScreenColorPicker({ color })
    } catch (error) {
      finishScreenColorPicker({ error: error instanceof Error ? error : new Error(String(error)) })
    }
  })
  ipcMain.handle('network:get-local-ipv4', () => localIpv4Addresses())
  ipcMain.handle('network:detect-exit-ip', async () => {
    const response = await electronNet.fetch('https://ipwho.is/', { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`出口 IP 服务响应异常（${response.status}）`)
    const payload = await response.json() as {
      success?: unknown
      ip?: unknown
      country?: unknown
      city?: unknown
      connection?: { isp?: unknown }
      timezone?: { id?: unknown }
    }
    if (payload.success === false) throw new Error('出口 IP 服务未能完成查询')
    if (typeof payload.ip !== 'string' || !payload.ip) throw new Error('出口 IP 服务没有返回有效地址')
    return {
      ip: payload.ip,
      country: typeof payload.country === 'string' ? payload.country : '',
      city: typeof payload.city === 'string' ? payload.city : '',
      isp: typeof payload.connection?.isp === 'string' ? payload.connection.isp : '',
      timezone: typeof payload.timezone?.id === 'string' ? payload.timezone.id : ''
    }
  })
  ipcMain.handle('network:diagnose', async (_event, request: unknown) => {
    const { host, port, mode } = request as { host?: unknown; port?: unknown; mode?: unknown }
    if (typeof host !== 'string' || !host.trim()) throw new Error('请输入域名或 IP 地址')
    const normalizedHost = host.trim()
    const normalizedPort = typeof port === 'number' ? port : Number(port)
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65_535) throw new Error('端口必须在 1 到 65535 之间')
    if (mode !== 'tcp' && mode !== 'http' && mode !== 'https') throw new Error('诊断方式无效')
    const addresses = await lookup(normalizedHost, { all: true }).then((items) => items.map((item) => item.address))
    const [ipv4, ipv6, tcp, http] = await Promise.all([
      resolve4(normalizedHost).catch(() => [] as string[]),
      resolve6(normalizedHost).catch(() => [] as string[]),
      diagnoseTcp(normalizedHost, normalizedPort),
      mode === 'tcp' ? Promise.resolve(undefined) : (async () => {
        const startedAt = performance.now()
        try {
          const response = await electronNet.fetch(`${mode}://${normalizedHost}:${normalizedPort}/`, { method: 'HEAD', signal: AbortSignal.timeout(8_000) })
          return { reachable: true, status: response.status, statusText: response.statusText, latencyMs: Math.round(performance.now() - startedAt) }
        } catch (error) {
          return { reachable: false, error: error instanceof Error ? error.message : String(error) }
        }
      })()
    ])
    return { host: normalizedHost, port: normalizedPort, addresses: [...new Set(addresses)], ipv4, ipv6, tcp, http }
  })
  ipcMain.handle('process:list-listening', () => listListeningProcesses())
  ipcMain.handle('process:terminate', async (_event, rawPid: unknown) => {
    if (!Number.isInteger(rawPid) || rawPid <= 0) throw new Error('进程 ID 无效')
    if (process.platform !== 'win32') throw new Error('端口进程管理当前仅支持 Windows')
    await commandOutput('taskkill.exe', ['/PID', String(rawPid), '/T', '/F'])
    return { pid: rawPid }
  })

  ipcMain.handle('volta:get-node-state', () => getVoltaNodeState())
  ipcMain.handle('volta:install-node', async (_event, rawVersion: unknown) => {
    const version = assertNodeSpecifier(rawVersion)
    await commandOutput('volta', ['install', `node@${version}`])
    return getVoltaNodeState()
  })
  ipcMain.handle('volta:pin-node', async (_event, request: unknown) => {
    const { version, directory } = request as { version?: unknown; directory?: unknown }
    const normalizedVersion = assertNodeSpecifier(version)
    if (typeof directory !== 'string' || !directory.trim()) throw new Error('请选择项目目录')
    const projectDirectory = resolve(directory)
    const info = await lstat(projectDirectory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('请选择一个真实的项目目录')
    await commandOutput('volta', ['pin', `node@${normalizedVersion}`], { cwd: projectDirectory })
    return { directory: projectDirectory, version: normalizedVersion }
  })
  ipcMain.handle('nvm:get-node-state', () => getNvmNodeState())
  ipcMain.handle('nvm:install-node', async (_event, rawVersion: unknown) => {
    const version = assertNodeSpecifier(rawVersion)
    await commandOutput('nvm', ['install', version])
    return getNvmNodeState()
  })
  ipcMain.handle('nvm:use-node', async (_event, rawVersion: unknown) => {
    const version = assertNodeSpecifier(rawVersion)
    await commandOutput('nvm', ['use', version])
    return getNvmNodeState()
  })
  ipcMain.handle('nvm:uninstall-node', async (_event, rawVersion: unknown) => {
    const version = assertNodeSpecifier(rawVersion)
    await commandOutput('nvm', ['uninstall', version])
    return getNvmNodeState()
  })
  ipcMain.handle('node-releases:list', () => getNvmDownloadableNodeReleases())
  ipcMain.handle('version-manager:install', async (_event, manager: unknown) => {
    await installVersionManager(manager)
    return manager === 'volta' ? getVoltaNodeState() : getNvmNodeState()
  })

  ipcMain.handle('assistant-config:read', async (_event, request: unknown) => {
    const { tool, file } = assertAssistantConfigRequest(request)
    const path = assistantConfigPath(tool, file)
    try {
      return { path, exists: true, content: await readFile(path, 'utf8') }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, exists: false, content: '' }
      throw error
    }
  })
  ipcMain.handle('assistant-config:save', async (_event, request: unknown) => {
    const { tool, file, content } = assertAssistantConfigRequest(request)
    if (content === undefined) throw new Error('配置内容无效')
    const path = assistantConfigPath(tool, file)
    await mkdir(parse(path).dir, { recursive: true })
    await writeFile(path, content, 'utf8')
    return { path }
  })

  ipcMain.handle('toolbox:select-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('toolbox:scan-directories', async (_event, request: unknown) => {
    const { rootPath, directoryName } = request as { rootPath?: unknown; directoryName?: unknown }
    if (typeof rootPath !== 'string' || typeof directoryName !== 'string') throw new Error('扫描参数无效')
    const normalizedRoot = resolve(rootPath)
    const normalizedName = directoryName.trim()
    if (!normalizedName || normalizedName.includes('/') || normalizedName.includes('\\')) throw new Error('目录名不能包含路径分隔符')
    if (normalizedRoot === parse(normalizedRoot).root) throw new Error('不能以磁盘根目录作为扫描范围')
    const rootInfo = await lstat(normalizedRoot)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('请选择一个真实目录作为扫描根目录')
    const matches: Array<{ id: string; path: string }> = []
    const visit = async (currentPath: string): Promise<void> => {
      const entries = await readdir(currentPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const childPath = join(currentPath, entry.name)
        if (entry.name === normalizedName) {
          const id = randomUUID()
          cleanupTargets.set(id, { path: childPath, rootPath: normalizedRoot, directoryName: normalizedName })
          matches.push({ id, path: childPath })
          continue
        }
        await visit(childPath)
      }
    }
    await visit(normalizedRoot)
    return matches
  })
  ipcMain.handle('toolbox:delete-directories', async (_event, ids: unknown) => {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('删除参数无效')
    const results: Array<{ id: string; path?: string; success: boolean; error?: string }> = []
    for (const id of ids) {
      const target = cleanupTargets.get(id)
      if (!target) {
        results.push({ id, success: false, error: '目录不在本次扫描结果中，请重新扫描' })
        continue
      }
      try {
        const relativePath = relative(target.rootPath, target.path)
        if (!relativePath || relativePath.startsWith('..') || basename(target.path) !== target.directoryName) throw new Error('目标目录不在安全扫描范围内')
        const info = await lstat(target.path)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('目标目录已变化或不是可删除的真实目录')
        await removeDirectory(target.path)
        cleanupTargets.delete(id)
        results.push({ id, path: target.path, success: true })
      } catch (error) {
        results.push({ id, path: target.path, success: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return results
  })
  ipcMain.handle('image:select-output-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: '选择图片导出位置' })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle('image:save-compressed-images', async (_event, request: unknown) => {
    const { outputDirectory, files } = request as { outputDirectory?: unknown; files?: unknown }
    if (typeof outputDirectory !== 'string' || !Array.isArray(files) || !files.length) throw new Error('导出参数无效')
    const targetRoot = resolve(outputDirectory)
    const targetInfo = await lstat(targetRoot)
    if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new Error('请选择真实的导出文件夹')
    const batchDirectory = join(targetRoot, `tinypng-output-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomUUID().slice(0, 8)}`)
    await mkdir(batchDirectory, { recursive: false })
    const saved: string[] = []
    for (const file of files) {
      if (!file || typeof file !== 'object') throw new Error('图片数据无效')
      const { name, data } = file as { name?: unknown; data?: unknown }
      if (typeof name !== 'string' || !(data instanceof ArrayBuffer)) throw new Error('图片数据无效')
      const safeName = basename(name)
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(safeName)) throw new Error('导出文件名无效')
      const outputPath = resolve(batchDirectory, safeName)
      if (relative(batchDirectory, outputPath).startsWith('..')) throw new Error('导出路径无效')
      await writeFile(outputPath, Buffer.from(data))
      saved.push(outputPath)
    }
    return { directory: batchDirectory, files: saved }
  })

  tray = new Tray(nativeImage.createFromPath(trayIconPath()).resize({ width: 32, height: 32 }))
  tray.setToolTip('LocalForge · 开发者工具箱')
  const updateTray = (): void => {
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 LocalForge', click: openToolbox },
      { label: '打开监控中心', click: openPanel },
      { label: '打开趋势分析', click: openTrend },
      { type: 'separator' },
      { label: window.isVisible() ? '隐藏悬浮窗' : '显示悬浮窗', click: () => { window.isVisible() ? window.hide() : window.show(); updateTray() } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]))
  }
  tray.on('click', openToolbox)
  tray.on('double-click', openToolbox)
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
  openToolbox()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOrbWindow()
  })
})

app.on('window-all-closed', () => {
  // 系统托盘常驻；退出操作由托盘菜单明确触发。
})
