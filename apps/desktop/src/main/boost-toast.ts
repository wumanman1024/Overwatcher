import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { clampPosition } from '@localforge/shared/overlay-state'

export type BoostPhase = 'running' | 'done' | 'error'
export type BoostStatus = {
  phase: BoostPhase
  freedBytes?: number
  trimmed?: number
  skipped?: number
  message?: string
}

// 卡片宽度取 268：够放「已整理 280.7 MB」加两行说明而不被省略号截断，又不至于宽到跨屏。
const toastSize = { width: 268, height: 78 }
// 卡片与球之间留出的间隙，避免贴边看起来像一个整体。
const gapAboveOrb = 10

let toastWindow: BrowserWindow | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined

function loadToastSurface(window: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?surface=boost-toast`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface: 'boost-toast' } })
}

function createToastWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...toastSize,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  // 卡片只是播报，不该抢走用户正在输入的窗口焦点，也不该挡住下面的点击。
  window.setIgnoreMouseEvents(true)
  window.setAlwaysOnTop(true, 'screen-saver')
  loadToastSurface(window)
  return window
}

/*
 * 卡片贴着悬浮球上方出现：结果是对这次点击的回应，离得远了用户不知道它在说哪件事。
 * 球可能被拖到屏幕边缘或副屏，所以定位后仍要走一次 clampPosition。
 */
function positionAbove(orb: BrowserWindow): void {
  if (!toastWindow || toastWindow.isDestroyed()) return
  const orbBounds = orb.getBounds()
  const workAreas = screen.getAllDisplays().map((display) => display.workArea)
  const target = workAreas.find((area) => (
    orbBounds.x + orbBounds.width / 2 >= area.x
    && orbBounds.x + orbBounds.width / 2 <= area.x + area.width
    && orbBounds.y + orbBounds.height / 2 >= area.y
    && orbBounds.y + orbBounds.height / 2 <= area.y + area.height
  )) ?? screen.getDisplayNearestPoint({ x: orbBounds.x, y: orbBounds.y }).workArea

  const desired = { x: orbBounds.x - 40, y: orbBounds.y - toastSize.height - gapAboveOrb }
  const placed = clampPosition(desired, toastSize, target)
  toastWindow.setPosition(placed.x, placed.y)
}

const RESULT_VISIBLE_MS = 4_000
const ERROR_VISIBLE_MS = 6_000

/*
 * 播报一次加速的状态。orb 传入自身是为了把卡片定位到球旁边；
 * running 阶段不安排自动隐藏，由随后的 done/error 或异常兜底负责收起。
 */
export function showBoostStatus(status: BoostStatus, orb: BrowserWindow): void {
  if (!toastWindow || toastWindow.isDestroyed()) toastWindow = createToastWindow()
  if (hideTimer) clearTimeout(hideTimer)

  const deliver = (): void => {
    if (!toastWindow || toastWindow.isDestroyed()) return
    positionAbove(orb)
    toastWindow.webContents.send('boost-toast:status', status)
    if (!toastWindow.isVisible()) toastWindow.showInactive()
    if (status.phase !== 'running') {
      hideTimer = setTimeout(hideBoostToast, status.phase === 'error' ? ERROR_VISIBLE_MS : RESULT_VISIBLE_MS)
    }
  }

  // 首次创建时内容还没加载，过早 send 会被丢弃，必须等就绪。
  if (toastWindow.webContents.isLoading()) toastWindow.webContents.once('did-finish-load', deliver)
  else deliver()
}

export function hideBoostToast(): void {
  if (hideTimer) clearTimeout(hideTimer)
  if (toastWindow && !toastWindow.isDestroyed() && toastWindow.isVisible()) toastWindow.hide()
}
