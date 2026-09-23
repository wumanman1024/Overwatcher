import { execFile, spawn } from 'node:child_process'
import { readFile, writeFile, copyFile, lstat, readdir } from 'node:fs/promises'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { ipcMain, shell, dialog } from 'electron'
import Store from 'electron-store'

const run = promisify(execFile)

/*
 * nginx 管理：进程控制、配置校验与编辑、开机自启、快捷打开目录。
 *
 * nginx 的习惯是把反馈（含 `nginx -t` 的 "syntax is ok"）写到 stderr，成功时退出码仍为 0，
 * 所以这里用 runNginx 始终返回「合并输出 + 退出码」，而不是只在失败时才读 stderr。
 *
 * 目录一律按 nginx 官方 Windows 包的 prefix 约定推导：exe 所在目录即 prefix，
 * 其下就是 conf/、logs/、html/，因此 nginx.exe 必须就地运行（不要单独拷出来）。
 *
 * 开机自启写当前用户的 HKCU\...\Run，不需要管理员权限；代价是仅在用户登录后才启动。
 * Run 键只能是一条命令行，而 nginx 依赖工作目录定位 conf/，故包一层 cmd /c cd。
 */

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const AUTOSTART_VALUE = 'LocalForgeNginx'

// nginx.exe 所在目录即 prefix，其下就是 conf/、logs/、html/。
interface NginxLayout { exePath: string; prefix: string; conf: string; logs: string; html: string }

const layoutOf = (exePath: string): NginxLayout => {
  const prefix = dirname(exePath)
  return { exePath, prefix, conf: join(prefix, 'conf', 'nginx.conf'), logs: join(prefix, 'logs'), html: join(prefix, 'html') }
}

interface NginxRunResult { code: number; output: string }

function runNginx(exePath: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<NginxRunResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(exePath, args, { cwd, windowsHide: true })
    let output = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) rejectRun(error)
      else resolveRun({ code: child.exitCode ?? 0, output: output.trim() })
    }
    const append = (chunk: Buffer) => {
      if (settled) return
      output += chunk.toString()
      if (output.length > 4 * 1024 * 1024) { child.kill(); finish(new Error('nginx 输出过多，已停止')) }
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => finish(error))
    child.once('close', () => finish())
    const timeout = setTimeout(() => { child.kill(); finish(new Error('nginx 命令执行超时')) }, timeoutMs)
  })
}

interface NginxPreferences { executable?: string }
const store = new Store<NginxPreferences>({ name: 'nginx-preferences' })

// 校验渲染层传来的路径确实是一个存在的 nginx.exe（渲染层可任意传路径，这里必须落盘核实）。
async function resolveExecutable(rawPath?: unknown): Promise<NginxLayout> {
  if (process.platform !== 'win32') throw new Error('nginx 管理当前仅支持 Windows')
  if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('请先选择 nginx.exe 路径')
  const exePath = resolve(rawPath.trim())
  if (basename(exePath).toLowerCase() !== 'nginx.exe') throw new Error('请选择 nginx.exe 文件')
  const info = await lstat(exePath).catch(() => null)
  if (!info?.isFile()) throw new Error('nginx.exe 不存在，请重新选择路径')
  return layoutOf(exePath)
}

function savedExecutable(): string {
  const value = store.get('executable')
  if (typeof value !== 'string' || !value.trim()) throw new Error('请先选择 nginx.exe 路径')
  return value
}

type NginxProcess = { pid: number; role: 'master' | 'worker'; command: string }

/*
 * master 与 worker 的命令行几乎相同，无法据此区分；可靠办法是比父进程：
 * worker 的父进程就是那个 master，master 的父进程不是 nginx。
 */
function parseNginxProcesses(output: string): NginxProcess[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  const rows = JSON.parse(trimmed.startsWith('[') ? trimmed : `[${trimmed}]`) as Array<{ ProcessId?: number; ParentProcessId?: number; CommandLine?: string | null }>
  const pids = new Set(rows.flatMap((row) => typeof row.ProcessId === 'number' ? [row.ProcessId] : []))
  return rows.flatMap((row) => typeof row.ProcessId === 'number'
    ? [{ pid: row.ProcessId, role: pids.has(row.ParentProcessId ?? -1) ? 'worker' as const : 'master' as const, command: row.CommandLine ?? '' }]
    : [])
}

async function nginxProcesses(): Promise<NginxProcess[]> {
  try {
    // WMIC 在新版 Windows 上可能已被裁剪，故用 Get-CimInstance。
    const { stdout } = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='nginx.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"
    ], { windowsHide: true, timeout: 20_000 })
    return parseNginxProcesses(stdout)
  } catch {
    return []
  }
}

function autostartCommand(layout: NginxLayout): string {
  return `cmd /c cd /d "${layout.prefix}" && "${layout.exePath}"`
}

async function readAutostart(): Promise<{ enabled: boolean; command?: string }> {
  try {
    const { stdout } = await run('reg.exe', ['query', RUN_KEY, '/v', AUTOSTART_VALUE], { windowsHide: true, timeout: 10_000 })
    const match = stdout.match(/REG_SZ\s+(.+)/)
    return { enabled: true, ...(match ? { command: match[1].trim() } : {}) }
  } catch {
    // reg query 在值不存在时以非 0 退出，这不是错误。
    return { enabled: false }
  }
}

interface NginxStatus {
  exeConfigured: boolean
  exePath?: string
  prefix?: string
  paths?: { conf: string; logs: string; html: string }
  configExists: boolean
  running: boolean
  // 只上报 pid 与角色；命令行可能含证书等无关路径，不跨 IPC 传给界面。
  processes: Array<{ pid: number; role: 'master' | 'worker' }>
  autostart: boolean
  autostartCommand?: string
}

async function getStatus(): Promise<NginxStatus> {
  const [found, autostart] = await Promise.all([nginxProcesses(), readAutostart()])
  const processes = found.map(({ pid, role }) => ({ pid, role }))
  const base = { running: processes.length > 0, processes, autostart: autostart.enabled, ...(autostart.command ? { autostartCommand: autostart.command } : {}) }
  const executable = store.get('executable')
  if (typeof executable !== 'string' || !executable.trim()) return { exeConfigured: false, configExists: false, ...base }
  // 已保存但被移动/删除时不整体报错，仍回报进程状态，由界面提示重新选择。
  const layout = await resolveExecutable(executable).catch(() => null)
  if (!layout) return { exeConfigured: false, configExists: false, ...base }
  const configExists = await lstat(layout.conf).then((info) => info.isFile()).catch(() => false)
  return {
    exeConfigured: true, exePath: layout.exePath, prefix: layout.prefix,
    paths: { conf: layout.conf, logs: layout.logs, html: layout.html },
    configExists, ...base
  }
}

async function setPath(request: { path?: unknown }): Promise<NginxStatus> {
  const layout = await resolveExecutable(request?.path)
  store.set('executable', layout.exePath)
  return getStatus()
}

// 路径由用户在系统对话框里挑，避免任何形式的路径注入。
async function browseExecutable(): Promise<{ path?: string }> {
  if (process.platform !== 'win32') throw new Error('nginx 管理当前仅支持 Windows')
  const result = await dialog.showOpenDialog({
    title: '选择 nginx.exe',
    filters: [{ name: 'nginx 可执行文件', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile']
  })
  return result.canceled ? {} : { path: result.filePaths[0] }
}

const CONTROL_ACTIONS = ['stop', 'quit', 'reload', 'reopen'] as const

async function runControl(request: { action?: unknown }): Promise<{ output: string; ok: boolean }> {
  const action = request?.action
  if (typeof action !== 'string' || !CONTROL_ACTIONS.includes(action as typeof CONTROL_ACTIONS[number])) throw new Error('无效的控制指令')
  const layout = await resolveExecutable(savedExecutable())
  // nginx -s 是向已有 master 发信号，没有运行时必然失败，这个失败原样回传给用户。
  const result = await runNginx(layout.exePath, ['-s', action], layout.prefix)
  return { output: result.output || `nginx -s ${action} 已执行（退出码 ${result.code}）`, ok: result.code === 0 }
}

/*
 * Windows 上的 nginx.exe 不会自后台化：直接等它退出会一直挂着，所以这里 detach 后立即返回，
 * 由界面稍后轮询 status 确认是否真的起来了。启动失败（如端口占用、配置有误）不会体现在
 * 本次返回里，因此同时跑一次 -t：配置有问题时在启动当下就报出来，免得用户对着「未运行」猜原因。
 */
async function start(): Promise<{ output: string; ok: boolean }> {
  const layout = await resolveExecutable(savedExecutable())
  const check = await runNginx(layout.exePath, ['-t'], layout.prefix)
  if (check.code !== 0) return { output: `配置校验未通过，已取消启动：\n${check.output}`, ok: false }
  // stdio 必须 ignore：detached 子进程要活得比我们久，保留管道且无人读取会让 nginx 写满后阻塞。
  const child = spawn(layout.exePath, [], { cwd: layout.prefix, windowsHide: true, detached: true, stdio: 'ignore' })
  const failed = await new Promise<string | undefined>((resolveSpawn) => {
    child.once('error', (error) => resolveSpawn(error.message))
    // 没有立即报错即视为已交付给系统；nginx 自身的启动结果留给下一次 status 轮询。
    setTimeout(() => resolveSpawn(undefined), 600)
  })
  child.unref()
  return failed
    ? { output: `启动失败：${failed}`, ok: false }
    : { output: '已提交启动，正在后台拉起。若稍后状态仍为未运行，请检查端口占用或日志。', ok: true }
}

async function testConfig(): Promise<{ output: string; ok: boolean }> {
  const layout = await resolveExecutable(savedExecutable())
  const result = await runNginx(layout.exePath, ['-t'], layout.prefix)
  return { output: result.output || `nginx -t 完成（退出码 ${result.code}）`, ok: result.code === 0 }
}

/*
 * 强制结束所有 nginx.exe（含子进程），用于 nginx 卡死、-s stop 无效时。
 * 按镜像名整体 taskkill 是有意为之：nginx 卡死时无法逐个定位，但这也意味着
 * 它会连带结束本机其它 nginx 实例，界面侧必须明确二次确认。
 */
async function killAll(): Promise<{ killed: number }> {
  if (process.platform !== 'win32') throw new Error('nginx 管理当前仅支持 Windows')
  const before = (await nginxProcesses()).length
  const exited = await new Promise<number>((resolveKill, rejectKill) => {
    const child = spawn('taskkill.exe', ['/F', '/IM', 'nginx.exe', '/T'], { windowsHide: true })
    child.once('error', rejectKill)
    child.once('close', (code) => resolveKill(code ?? -1))
  })
  const remaining = (await nginxProcesses()).length
  // 128 = 没有找到匹配的进程；0 与 128 之外的失败且仍有残留才视为错误。
  if (exited !== 0 && exited !== 128 && remaining) throw new Error(`taskkill 退出码 ${exited}`)
  return { killed: Math.max(0, before - remaining) }
}

async function setAutostart(request: { enabled?: unknown }): Promise<NginxStatus> {
  const enabled = request?.enabled
  if (typeof enabled !== 'boolean') throw new Error('开机自启参数无效')
  if (enabled) {
    const layout = await resolveExecutable(savedExecutable())
    await run('reg.exe', ['add', RUN_KEY, '/v', AUTOSTART_VALUE, '/t', 'REG_SZ', '/d', autostartCommand(layout), '/f'], { windowsHide: true, timeout: 10_000 })
  } else {
    // 值不存在时 reg delete 会失败，目标状态已达成，吞掉。
    try { await run('reg.exe', ['delete', RUN_KEY, '/v', AUTOSTART_VALUE, '/f'], { windowsHide: true, timeout: 10_000 }) } catch { /* 已关闭 */ }
  }
  return getStatus()
}

async function readConfig(): Promise<{ path: string; exists: boolean; content: string }> {
  const layout = await resolveExecutable(savedExecutable())
  try {
    return { path: layout.conf, exists: true, content: await readFile(layout.conf, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: layout.conf, exists: false, content: '' }
    throw error
  }
}

// 覆盖前留 .bak：nginx.conf 写坏会让 nginx 起不来，必须给用户留退路。
async function saveConfig(request: { content?: unknown }): Promise<{ path: string }> {
  const content = request?.content
  if (typeof content !== 'string') throw new Error('配置内容无效')
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) throw new Error('配置文件不能超过 2 MB')
  const layout = await resolveExecutable(savedExecutable())
  await copyFile(layout.conf, `${layout.conf}.bak`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  await writeFile(layout.conf, content, 'utf8')
  return { path: layout.conf }
}

const OPENABLE = ['prefix', 'confDir', 'logs', 'html', 'config'] as const

async function openPath(request: { target?: unknown }): Promise<void> {
  const target = request?.target
  if (typeof target !== 'string' || !OPENABLE.includes(target as typeof OPENABLE[number])) throw new Error('未知的目标目录')
  const layout = await resolveExecutable(savedExecutable())
  // 配置文件用系统关联程序打开（可能已被用户绑到 VS Code），比编辑器内嵌视图更符合日常习惯。
  const path = target === 'prefix' ? layout.prefix : target === 'confDir' ? dirname(layout.conf) : target === 'logs' ? layout.logs : target === 'html' ? layout.html : layout.conf
  const error = await shell.openPath(path)
  if (error) throw new Error(error)
}

export function registerNginxIpc(): void {
  ipcMain.handle('nginx:status', () => getStatus())
  ipcMain.handle('nginx:set-path', (_event, request: { path?: unknown }) => setPath(request))
  ipcMain.handle('nginx:browse', () => browseExecutable())
  ipcMain.handle('nginx:start', () => start())
  ipcMain.handle('nginx:control', (_event, request: { action?: unknown }) => runControl(request))
  ipcMain.handle('nginx:test-config', () => testConfig())
  ipcMain.handle('nginx:kill-all', () => killAll())
  ipcMain.handle('nginx:set-autostart', (_event, request: { enabled?: unknown }) => setAutostart(request))
  ipcMain.handle('nginx:read-config', () => readConfig())
  ipcMain.handle('nginx:save-config', (_event, request: { content?: unknown }) => saveConfig(request))
  ipcMain.handle('nginx:open', (_event, request: { target?: unknown }) => openPath(request))
}
