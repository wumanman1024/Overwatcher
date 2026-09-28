import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ipcMain } from 'electron'
import { basename } from 'node:path'
import si from 'systeminformation'

const run = promisify(execFile)

export type ManagedProcess = {
  pid: number
  name: string
  /** 占物理内存百分比，直接用 systeminformation 的口径，与悬浮球一致 */
  memoryPercent: number
  memoryBytes: number
  cpuPercent: number
  started?: string
  command?: string
}

export type KillOutcome = { pid: number; ok: boolean; error?: string }

/*
 * 结束这些进程会直接让系统掉线、黑屏或无法登录，因此既不列给用户，
 * 主进程也独立拒绝 —— 渲染层可以传任意 PID 进来，只靠界面隐藏不算防护。
 */
const PROTECTED_NAMES = new Set([
  'system', 'secure system', 'registry', 'memory compression', 'idle',
  'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe',
  'lsass.exe', 'svchost.exe', 'dwm.exe', 'fontdrvhost.exe', 'sihost.exe',
  'taskhostw.exe', 'ctfmon.exe', 'explorer.exe', 'runtimebroker.exe',
  'audiodg.exe', 'spoolsv.exe', 'wmiprvse.exe', 'vds.exe', 'vmauthd.exe'
])

// 屏蔽自己的映像：结束宿主等于让应用闪退。主进程与渲染进程同一个 exe，按名字一次挡掉。
// 注意 systeminformation 给出的名字有时不带 .exe（如 "electron"），所以要双向比对。
// 除本应用与下列系统进程外不做任何屏蔽：第三方应用（含开发工具）能不能结束由用户决定。
const selfImage = basename(process.execPath).toLowerCase()
const selfImageStem = selfImage.replace(/\.exe$/, '')

function isSelf(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === selfImage || lower === selfImageStem
}

function isProtected(name: string, pid: number): boolean {
  if (pid === 0 || pid === 4) return true
  return PROTECTED_NAMES.has(name.toLowerCase()) || isSelf(name)
}

let cache: { at: number; list: ManagedProcess[] } | undefined
// 全量进程枚举约 600ms，面板打开后可能反复切换标签，给一个很短的缓存。
const CACHE_TTL_MS = 1_500

export async function listManagedProcesses(): Promise<ManagedProcess[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.list
  const snapshot = await si.processes()
  const list = snapshot.list
    .filter((item) => item.pid > 0 && item.name && !isProtected(item.name, item.pid))
    .map((item) => ({
      pid: item.pid,
      name: item.name,
      memoryPercent: item.mem,
      // Windows 上 memRss 是 KB。
      memoryBytes: item.memRss * 1024,
      cpuPercent: item.cpu,
      ...(item.started ? { started: item.started } : {}),
      // 命令行用来区分同名进程（例如多个 node.exe 分别跑的什么）。
      ...(item.command && item.command !== item.name ? { command: item.command } : {})
    }))
    // 同名进程在 Windows 上极常见（浏览器一个应用就十几个），先按占用排，
    // 再把同名的挨着放，方便一次勾选同一个应用的多个进程。
    .sort((a, b) => b.memoryPercent - a.memoryPercent || a.name.localeCompare(b.name))
  cache = { at: Date.now(), list }
  return list
}

/*
 * 批量结束。逐个 kill 而不是拼一条 taskkill：一个 PID 失败不应该让整批不执行，
 * 而且逐个才能给出「哪几个没成功、为什么」。
 */
export async function terminateProcesses(pids: unknown): Promise<KillOutcome[]> {
  if (process.platform !== 'win32') throw new Error('进程管理当前仅支持 Windows')
  if (!Array.isArray(pids) || !pids.length) throw new Error('没有选择要结束的进程')
  if (pids.length > 64) throw new Error('一次最多结束 64 个进程')
  const targets = pids.map((pid) => {
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) throw new Error('进程 ID 无效')
    return pid
  })

  // 名单以此刻的真实进程表为准，不用渲染层传来的名字：名字可以伪造，PID 不能。
  const snapshot = await si.processes()
  const known = new Map(snapshot.list.map((item) => [item.pid, item.name]))
  const outcomes: KillOutcome[] = []
  for (const pid of targets) {
    const name = known.get(pid)
    if (!name) { outcomes.push({ pid, ok: false, error: '进程已不存在' }); continue }
    if (isProtected(name, pid)) { outcomes.push({ pid, ok: false, error: '系统关键进程，已拒绝结束' }); continue }
    try {
      await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 })
      outcomes.push({ pid, ok: true })
    } catch (error) {
      outcomes.push({ pid, ok: false, error: error instanceof Error ? error.message.split('\n')[0] : String(error) })
    }
  }
  cache = undefined
  return outcomes
}

export function registerProcessPanelIpc(): void {
  ipcMain.handle('process:list-managed', () => listManagedProcesses())
  ipcMain.handle('process:terminate-many', (_event, pids: unknown) => terminateProcesses(pids))
}
