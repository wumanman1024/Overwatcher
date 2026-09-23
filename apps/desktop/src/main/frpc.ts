import { execFile, spawn } from 'node:child_process'
import { readFile, writeFile, copyFile, lstat } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { ipcMain, shell, dialog } from 'electron'
import Store from 'electron-store'

const run = promisify(execFile)

/*
 * frpc 管理：进程控制、配置校验与编辑、开机自启、隧道状态与热重载。
 *
 * 与 nginx 的差异都在这里：
 *  1. frpc 没有 prefix 约定，一个 frpc.exe 通常配一个任意路径的配置文件，
 *     故 exe 与 config 分开存、分开选，启动时统一用 `-c <config>` 指定。
 *  2. frpc 没有 `nginx -s reload/stop` 这类信号通道。改配置后的热重载走 admin API
 *     （等价于 `frpc reload -c`），停止则只能按进程树结束。
 *  3. frpc 自带 admin web server（默认 127.0.0.1:7500），隧道在线状态、流量都从这里取，
 *     这也是 frpc 工具相对 nginx 最大的增量价值。
 *
 * 配置文件可能是新版 TOML（webServer.*）或旧版 INI（[webserver] / [common] admin_*），
 * 端口与鉴权按这两套 key 解析，解析不到时回落到 frpc 默认 127.0.0.1:7500。
 *
 * 开机自启写当前用户的 HKCU\...\Run，与 nginx 一致；命令行里 cd 到配置目录再启动，
 * 因为 frpc 配置中的相对路径（证书等）按工作目录解析。
 */

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const AUTOSTART_VALUE = 'LocalForgeFrpc'

const DEFAULT_ADMIN_ADDR = '127.0.0.1'
const DEFAULT_ADMIN_PORT = 7500

interface FrpcLayout { exePath: string; configPath: string; cwd: string }

interface FrpcRunResult { code: number; output: string }

function runFrpc(exePath: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<FrpcRunResult> {
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
      if (output.length > 4 * 1024 * 1024) { child.kill(); finish(new Error('frpc 输出过多，已停止')) }
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => finish(error))
    child.once('close', () => finish())
    const timeout = setTimeout(() => { child.kill(); finish(new Error('frpc 命令执行超时')) }, timeoutMs)
  })
}

interface FrpcPreferences { executable?: string; config?: string }
const store = new Store<FrpcPreferences>({ name: 'frpc-preferences' })

// 校验渲染层传来的 exe 路径确实存在且是 frpc.exe（渲染层可任意传路径，这里必须落盘核实）。
async function resolveExe(rawPath?: unknown): Promise<string> {
  if (process.platform !== 'win32') throw new Error('frpc 管理当前仅支持 Windows')
  if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('请先选择 frpc.exe 路径')
  const exePath = resolve(rawPath.trim())
  if (basename(exePath).toLowerCase() !== 'frpc.exe') throw new Error('请选择 frpc.exe 文件')
  const info = await lstat(exePath).catch(() => null)
  if (!info?.isFile()) throw new Error('frpc.exe 不存在，请重新选择路径')
  return exePath
}

// 配置文件可与 exe 不同目录，按后缀接受 .toml / .ini / .yaml / .yml / .json。
async function resolveConfig(rawPath?: unknown): Promise<string> {
  if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('请先选择 frpc 配置文件路径')
  const configPath = resolve(rawPath.trim())
  const ext = extname(configPath).toLowerCase()
  if (!['.toml', '.ini', '.yaml', '.yml', '.json'].includes(ext)) throw new Error('请选择 frpc 配置文件（.toml / .ini 等）')
  const info = await lstat(configPath).catch(() => null)
  if (!info?.isFile()) throw new Error('配置文件不存在，请重新选择路径')
  return configPath
}

function savedExe(): string {
  const value = store.get('executable')
  if (typeof value !== 'string' || !value.trim()) throw new Error('请先选择 frpc.exe 路径')
  return value
}

function savedConfig(): string {
  const value = store.get('config')
  if (typeof value !== 'string' || !value.trim()) throw new Error('请先选择 frpc 配置文件路径')
  return value
}

// 两者都齐全才能组装出可执行的 layout；任缺其一在调用处给出针对性提示。
async function resolveLayout(): Promise<FrpcLayout> {
  const exePath = await resolveExe(savedExe())
  const configPath = await resolveConfig(savedConfig())
  return { exePath, configPath, cwd: dirname(configPath) }
}

type FrpcProcess = { pid: number; command: string }

async function frpcProcesses(): Promise<FrpcProcess[]> {
  try {
    // 与 nginx 同：WMIC 可能被裁剪，用 Get-CimInstance；命令行用于按配置归属过滤。
    const { stdout } = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='frpc.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
    ], { windowsHide: true, timeout: 20_000 })
    const trimmed = stdout.trim()
    if (!trimmed) return []
    const rows = JSON.parse(trimmed.startsWith('[') ? trimmed : `[${trimmed}]`) as Array<{ ProcessId?: number; CommandLine?: string | null }>
    return rows.flatMap((row) => typeof row.ProcessId === 'number' ? [{ pid: row.ProcessId, command: row.CommandLine ?? '' }] : [])
  } catch {
    return []
  }
}

/*
 * 本机可能同时跑多个 frpc（不同配置），只把命令行里引用了当前配置文件名的进程算作「本工具的实例」。
 * 用文件名而非全路径匹配：frpc 命令行里的 -c 可能是相对路径，全路径比不上。
 */
function ownProcesses(processes: FrpcProcess[], configPath: string): FrpcProcess[] {
  const needle = basename(configPath).toLowerCase()
  const matched = processes.filter((item) => item.command.toLowerCase().includes(needle))
  // 匹配不到全路径时也不至于把正在跑的实例漏掉：命令行完全为空（权限受限读不到）时整体纳入。
  if (!matched.length && processes.length && processes.every((item) => !item.command)) return processes
  return matched
}

function autostartCommand(layout: FrpcLayout): string {
  return `cmd /c cd /d "${layout.cwd}" && "${layout.exePath}" -c "${layout.configPath}"`
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

interface FrpcStatus {
  exeConfigured: boolean
  configConfigured: boolean
  ready: boolean
  exePath?: string
  configPath?: string
  configExists: boolean
  running: boolean
  // 只上报归属本配置的 pid 与 admin 探测目标；命令行可能含 token，不跨 IPC 传给界面。
  processes: Array<{ pid: number }>
  admin?: { addr: string; port: number; reachable: boolean; requiresAuth: boolean }
  autostart: boolean
  autostartCommand?: string
}

// admin 地址与鉴权从配置文件解析；解析不到时用 frpc 内置默认 127.0.0.1:7500。
async function readAdmin(configPath: string): Promise<AdminTarget> {
  let addr = DEFAULT_ADMIN_ADDR
  let port = DEFAULT_ADMIN_PORT
  let user = ''
  let password = ''
  try {
    const text = await readFile(configPath, 'utf8')
    // TOML: webServer.addr / webServer.port / webServer.user / webServer.password
    const toml = (key: string) => text.match(new RegExp(`webserver\\.${key}\\s*=\\s*"?([^"\\r\\n#]+)"?`, 'i'))?.[1]?.trim()
    addr = toml('addr') || addr
    port = Number(toml('port')) || port
    user = toml('user') || ''
    password = toml('password') || ''
    if (!toml('port')) {
      // INI: [webserver] addr/port/user/password，或旧版 [common] admin_addr/admin_port/admin_user/admin_password
      const ini = (key: string) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*([^;\\r\\n#]+)`, 'im'))?.[1]?.trim()
      addr = ini('addr') || ini('admin_addr') || addr
      port = Number(ini('port') || ini('admin_port')) || port
      user = ini('user') || ini('admin_user') || ''
      password = ini('password') || ini('admin_password') || ''
    }
  } catch { /* 读不到配置时按默认 admin 探测 */ }
  // 监听 0.0.0.0 时本机仍走回环访问。
  if (addr === '0.0.0.0' || addr === '::' || addr === '*') addr = DEFAULT_ADMIN_ADDR
  return { addr, port, requiresAuth: Boolean(user || password), ...(user && password ? { user, password } : {}) }
}

async function getStatus(): Promise<FrpcStatus> {
  const [found, autostart] = await Promise.all([frpcProcesses(), readAutostart()])
  const base = { autostart: autostart.enabled, ...(autostart.command ? { autostartCommand: autostart.command } : {}) }
  const exeRaw = store.get('executable')
  const configRaw = store.get('config')
  const exeConfigured = typeof exeRaw === 'string' && Boolean(exeRaw.trim())
  const configConfigured = typeof configRaw === 'string' && Boolean(configRaw.trim())
  if (!exeConfigured || !configConfigured) {
    return { exeConfigured, configConfigured, ready: false, configExists: false, running: false, processes: [], ...base }
  }
  // 已保存但被移动/删除时不整体报错，仍回报进程与自启状态，由界面提示重新选择。
  const layout = await resolveLayout().catch(() => null)
  if (!layout) return { exeConfigured: false, configConfigured: false, ready: false, configExists: false, running: false, processes: [], ...base }
  const own = ownProcesses(found, layout.configPath)
  const configExists = await lstat(layout.configPath).then((info) => info.isFile()).catch(() => false)
  // admin 只有在实例在跑时才谈得上可达，未运行时不发起网络探测。
  let admin: FrpcStatus['admin']
  if (own.length) {
    const target = await readAdmin(layout.configPath)
    const reachable = (await probeAdmin(target)).ok
    admin = { addr: target.addr, port: target.port, reachable, requiresAuth: target.requiresAuth }
  }
  return {
    exeConfigured: true, configConfigured: true, ready: true,
    exePath: layout.exePath, configPath: layout.configPath, configExists,
    running: own.length > 0, processes: own.map(({ pid }) => ({ pid })),
    ...(admin ? { admin } : {}), ...base
  }
}

type AdminTarget = { addr: string; port: number; requiresAuth: boolean; user?: string; password?: string }

function adminBase(target: AdminTarget): string {
  const host = target.addr.includes(':') && !target.addr.startsWith('[') ? `[${target.addr}]` : target.addr
  return `http://${host}:${target.port}`
}

async function adminFetch(target: AdminTarget, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (target.user && target.password) headers.set('Authorization', `Basic ${Buffer.from(`${target.user}:${target.password}`).toString('base64')}`)
  return fetch(`${adminBase(target)}${path}`, { ...init, headers, signal: AbortSignal.timeout(4_000) })
}

async function probeAdmin(target: AdminTarget): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await adminFetch(target, '/api/status')
    return { ok: response.ok, status: response.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

interface FrpcTunnel { name: string; type: string; status: string; trafficIn: number; trafficOut: number; todayTraffic: number }

/*
 * 隧道状态走 admin API：GET /api/status 在较新版本返回每个代理的 name/type/status/流量。
 * admin 未开启、鉴权失败或版本过旧（无 /api/status）时明确回报 unavailable 及原因，
 * 让界面提示「请在配置里开启 webServer 并升级到较新 frpc」，而不是空面板让人误判。
 */
async function getTunnels(): Promise<{ available: boolean; reason?: string; tunnels: FrpcTunnel[] }> {
  const layout = await resolveLayout()
  const target = await readAdmin(layout.configPath)
  let response: Response
  try {
    response = await adminFetch(target, '/api/status')
  } catch (error) {
    return { available: false, reason: `无法连接 admin API（${adminBase(target)}）：${error instanceof Error ? error.message : String(error)}`, tunnels: [] }
  }
  if (response.status === 401 || response.status === 403) return { available: false, reason: 'admin API 需要鉴权，请核对配置中的 webServer.user/password', tunnels: [] }
  if (!response.ok) return { available: false, reason: `admin API 返回 ${response.status}，可能是 frpc 版本过旧或未开启 webServer`, tunnels: [] }
  const rows = await response.json().catch(() => null) as Array<Record<string, unknown>> | null
  if (!Array.isArray(rows)) return { available: false, reason: 'admin API 返回格式无法解析', tunnels: [] }
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const tunnels = rows.map((row) => ({
    name: String(row.name ?? ''),
    type: String(row.type ?? ''),
    status: String(row.status ?? ''),
    trafficIn: num(row.trafficIn),
    trafficOut: num(row.trafficOut),
    todayTraffic: num(row.todayTraffic)
  }))
  return { available: true, tunnels }
}

async function setExe(request: { path?: unknown }): Promise<FrpcStatus> {
  const exePath = await resolveExe(request?.path)
  store.set('executable', exePath)
  return getStatus()
}

async function setConfig(request: { path?: unknown }): Promise<FrpcStatus> {
  const configPath = await resolveConfig(request?.path)
  store.set('config', configPath)
  return getStatus()
}

async function browse(kind: 'exe' | 'config'): Promise<{ path?: string }> {
  if (process.platform !== 'win32') throw new Error('frpc 管理当前仅支持 Windows')
  const result = await dialog.showOpenDialog(kind === 'exe'
    ? { title: '选择 frpc.exe', filters: [{ name: 'frpc 可执行文件', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }], properties: ['openFile'] }
    : { title: '选择 frpc 配置文件', filters: [{ name: 'frpc 配置', extensions: ['toml', 'ini', 'yaml', 'yml', 'json'] }, { name: '所有文件', extensions: ['*'] }], properties: ['openFile'] })
  return result.canceled ? {} : { path: result.filePaths[0] }
}

/*
 * frpc 没有 nginx -s 那套信号，热重载等价于 `frpc reload -c`（内部走 admin API）。
 * reload 要求实例已在运行且 admin 可访问，失败原样回传（多半是没开 webServer）。
 */
async function reload(): Promise<{ output: string; ok: boolean }> {
  const layout = await resolveLayout()
  const result = await runFrpc(layout.exePath, ['reload', '-c', layout.configPath], layout.cwd)
  return { output: result.output || `frpc reload 已执行（退出码 ${result.code}）`, ok: result.code === 0 }
}

async function verify(): Promise<{ output: string; ok: boolean }> {
  const layout = await resolveLayout()
  const result = await runFrpc(layout.exePath, ['verify', '-c', layout.configPath], layout.cwd)
  return { output: result.output || `frpc verify 完成（退出码 ${result.code}）`, ok: result.code === 0 }
}

/*
 * Windows 上的 frpc.exe 不会自后台化：直接等它退出会一直挂着，所以 detach 后立即返回，
 * 由界面稍后轮询 status 确认。启动失败（连不上 frps、配置有误）不会体现在本次返回里，
 * 因此同时跑一次 verify：配置有问题时在启动当下就报出来。
 */
async function start(): Promise<{ output: string; ok: boolean }> {
  const layout = await resolveLayout()
  const check = await runFrpc(layout.exePath, ['verify', '-c', layout.configPath], layout.cwd)
  // verify 在旧版可能不是子命令（会打印帮助、退出码非 0），仅当明显是配置错误时才拦启动。
  if (check.code !== 0 && /error|fail|invalid|非法|错误/i.test(check.output)) {
    return { output: `配置校验未通过，已取消启动：\n${check.output}`, ok: false }
  }
  // stdio 必须 ignore：detached 子进程要活得比我们久，保留管道且无人读取会让 frpc 写满后阻塞。
  const child = spawn(layout.exePath, ['-c', layout.configPath], { cwd: layout.cwd, windowsHide: true, detached: true, stdio: 'ignore' })
  const failed = await new Promise<string | undefined>((resolveSpawn) => {
    child.once('error', (error) => resolveSpawn(error.message))
    setTimeout(() => resolveSpawn(undefined), 600)
  })
  child.unref()
  return failed
    ? { output: `启动失败：${failed}`, ok: false }
    : { output: '已提交启动，正在后台拉起。若稍后状态仍为未运行，请检查与 frps 的连接或配置。', ok: true }
}

/*
 * 优雅停止：只结束归属本配置的进程树（frpc 无信号通道，靠结束进程）。
 * 不加 /F，先礼后兵；残留的再由 killAll 兜底。
 */
async function stop(): Promise<{ output: string; ok: boolean }> {
  if (process.platform !== 'win32') throw new Error('frpc 管理当前仅支持 Windows')
  const layout = await resolveLayout()
  const own = ownProcesses(await frpcProcesses(), layout.configPath)
  if (!own.length) return { output: '没有发现本配置的 frpc 进程。', ok: true }
  for (const { pid } of own) {
    try {
      await run('taskkill.exe', ['/T', '/PID', String(pid)], { windowsHide: true, timeout: 10_000 })
    } catch { /* 单个进程结束失败继续处理其余 */ }
  }
  const remaining = ownProcesses(await frpcProcesses(), layout.configPath).length
  return remaining
    ? { output: `仍有 ${remaining} 个进程未退出，可用「强制结束」清理。`, ok: false }
    : { output: `已结束 ${own.length} 个 frpc 进程。`, ok: true }
}

/*
 * 强制结束所有 frpc.exe（含子进程），用于卡死时兜底。
 * 按镜像名整体 taskkill 会连带结束本机其它 frpc 实例，界面侧必须明确二次确认。
 */
async function killAll(): Promise<{ killed: number }> {
  if (process.platform !== 'win32') throw new Error('frpc 管理当前仅支持 Windows')
  const before = (await frpcProcesses()).length
  const exited = await new Promise<number>((resolveKill, rejectKill) => {
    const child = spawn('taskkill.exe', ['/F', '/IM', 'frpc.exe', '/T'], { windowsHide: true })
    child.once('error', rejectKill)
    child.once('close', (code) => resolveKill(code ?? -1))
  })
  const remaining = (await frpcProcesses()).length
  // 128 = 没有找到匹配的进程；0 与 128 之外的失败且仍有残留才视为错误。
  if (exited !== 0 && exited !== 128 && remaining) throw new Error(`taskkill 退出码 ${exited}`)
  return { killed: Math.max(0, before - remaining) }
}

async function setAutostart(request: { enabled?: unknown }): Promise<FrpcStatus> {
  const enabled = request?.enabled
  if (typeof enabled !== 'boolean') throw new Error('开机自启参数无效')
  if (enabled) {
    const layout = await resolveLayout()
    await run('reg.exe', ['add', RUN_KEY, '/v', AUTOSTART_VALUE, '/t', 'REG_SZ', '/d', autostartCommand(layout), '/f'], { windowsHide: true, timeout: 10_000 })
  } else {
    // 值不存在时 reg delete 会失败，目标状态已达成，吞掉。
    try { await run('reg.exe', ['delete', RUN_KEY, '/v', AUTOSTART_VALUE, '/f'], { windowsHide: true, timeout: 10_000 }) } catch { /* 已关闭 */ }
  }
  return getStatus()
}

async function readConfig(): Promise<{ path: string; exists: boolean; content: string }> {
  const configPath = await resolveConfig(savedConfig())
  try {
    return { path: configPath, exists: true, content: await readFile(configPath, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: configPath, exists: false, content: '' }
    throw error
  }
}

// 覆盖前留 .bak：配置写坏会让 frpc 起不来，必须给用户留退路。
async function saveConfig(request: { content?: unknown }): Promise<{ path: string }> {
  const content = request?.content
  if (typeof content !== 'string') throw new Error('配置内容无效')
  if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) throw new Error('配置文件不能超过 2 MB')
  const configPath = await resolveConfig(savedConfig())
  await copyFile(configPath, `${configPath}.bak`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  await writeFile(configPath, content, 'utf8')
  return { path: configPath }
}

const OPENABLE = ['exeDir', 'configDir', 'config'] as const

async function openPath(request: { target?: unknown }): Promise<void> {
  const target = request?.target
  if (typeof target !== 'string' || !OPENABLE.includes(target as typeof OPENABLE[number])) throw new Error('未知的目标目录')
  const layout = await resolveLayout()
  // 配置文件用系统关联程序打开（可能已被用户绑到 VS Code），比编辑器内嵌视图更符合日常习惯。
  const path = target === 'exeDir' ? dirname(layout.exePath) : target === 'configDir' ? dirname(layout.configPath) : layout.configPath
  const error = await shell.openPath(path)
  if (error) throw new Error(error)
}

export function registerFrpcIpc(): void {
  ipcMain.handle('frpc:status', () => getStatus())
  ipcMain.handle('frpc:tunnels', () => getTunnels())
  ipcMain.handle('frpc:set-exe', (_event, request: { path?: unknown }) => setExe(request))
  ipcMain.handle('frpc:set-config', (_event, request: { path?: unknown }) => setConfig(request))
  ipcMain.handle('frpc:browse-exe', () => browse('exe'))
  ipcMain.handle('frpc:browse-config', () => browse('config'))
  ipcMain.handle('frpc:start', () => start())
  ipcMain.handle('frpc:stop', () => stop())
  ipcMain.handle('frpc:reload', () => reload())
  ipcMain.handle('frpc:verify', () => verify())
  ipcMain.handle('frpc:kill-all', () => killAll())
  ipcMain.handle('frpc:set-autostart', (_event, request: { enabled?: unknown }) => setAutostart(request))
  ipcMain.handle('frpc:read-config', () => readConfig())
  ipcMain.handle('frpc:save-config', (_event, request: { content?: unknown }) => saveConfig(request))
  ipcMain.handle('frpc:open', (_event, request: { target?: unknown }) => openPath(request))
}
