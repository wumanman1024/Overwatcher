import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import si from 'systeminformation'
import type { CollectorResult } from './sampler'

const execFileAsync = promisify(execFile)

/*
 * systeminformation 的 networkStats() 在 Windows 上不可用：
 * 1. 不传接口时它靠 `netstat -r` 猜“默认网卡”，多网卡（USB 网卡、代理虚拟网卡）
 *    机器上经常猜到一个静默接口；
 * 2. 猜对之后仍要拿接口名去 Get-NetAdapterStatistics 的结果里做字符串匹配，
 *    带空格的名字（“以太网 2”）被规范化成“以太网2”，永远匹配不上，rx_sec 恒为 null；
 * 3. 传 '*' 能拿全，但内部是「每个网卡 spawn 一次 PowerShell」，实测 8 网卡要 1.5~1.9 秒，
 *    放不进 1 秒的采集循环。
 * 这里改为一次 .NET 计数器调用拿齐全部网卡的累计字节数，速率由本地相邻两帧差值得到。
 */
interface AdapterCounters {
  id: string
  name: string
  type: string
  operationalStatus: string
  received: number
  sent: number
}

interface CounterSample {
  received: number
  sent: number
  at: number
}

// 只统计真正承载出入站流量的物理链路；Tunnel/PPP 与代理虚拟网卡会和物理网卡重复计数。
const countedTypes = new Set(['ethernet', 'wireless80211'])
// 只挂着 VPN / 代理虚拟网卡的机器不能让网速显示为 0，退回统计所有非回环的在连接口。
const excludedFallbackTypes = new Set(['loopback'])

const windowsCounterScript = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;[System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object { $stats = $_.GetIPv4Statistics(); [PSCustomObject]@{ id = $_.Id; name = $_.Name; type = [string]$_.NetworkInterfaceType; operationalStatus = [string]$_.OperationalStatus; received = $stats.BytesReceived; sent = $stats.BytesSent } } | ConvertTo-Json -Compress"

// 一次 PowerShell 进程换全部网卡的计数器；启动约 200ms，远快于按接口逐个 spawn。
const readWindowsAdapterCounters = async (): Promise<AdapterCounters[]> => {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsCounterScript], {
    encoding: 'utf8', timeout: 3_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024
  })
  const trimmed = stdout.trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed) as AdapterCounters | AdapterCounters[]
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => item && typeof item.received === 'number' && typeof item.sent === 'number')
}

const isUp = (adapter: AdapterCounters): boolean => adapter.operationalStatus.toLowerCase() === 'up'

const pickCounted = (adapters: AdapterCounters[]): AdapterCounters[] => {
  const physical = adapters.filter((adapter) => isUp(adapter) && countedTypes.has(adapter.type.toLowerCase()))
  return physical.length > 0 ? physical : adapters.filter((adapter) => isUp(adapter) && !excludedFallbackTypes.has(adapter.type.toLowerCase()))
}

/*
 * 速率 = 相邻两帧累计字节的差值除以实际间隔。用实际间隔而非固定 1 秒，是因为
 * PowerShell 耗时随系统负载波动，按固定间隔算会在卡顿时把网速放大。
 * 只返回基准、不改写 previous，是为了让采集失败的帧保留旧基准：否则下一帧会拿
 * 失败前的累计值和一个空槽位比对，把整段流量算成 0 或算成一次巨大的跳变。
 */
const accumulateRates = (adapters: AdapterCounters[], previous: Map<string, CounterSample>): { received: number; sent: number; baseline: Map<string, CounterSample> } => {
  const now = Date.now()
  let received = 0
  let sent = 0
  const baseline = new Map<string, CounterSample>()
  for (const adapter of pickCounted(adapters)) {
    const sample = { received: adapter.received, sent: adapter.sent, at: now }
    baseline.set(adapter.id, sample)
    const last = previous.get(adapter.id)
    if (!last) continue
    const elapsedMs = now - last.at
    // 网卡重建会换 id；网卡或系统重启后计数器归零、差值为负。这两种按 0 计。
    if (elapsedMs <= 0 || sample.received < last.received || sample.sent < last.sent) continue
    received += (sample.received - last.received) / elapsedMs * 1000
    sent += (sample.sent - last.sent) / elapsedMs * 1000
  }
  return { received, sent, baseline }
}

/*
 * 非 Windows 平台交给 systeminformation：Linux 读 /sys、macOS 读 netstat，
 * 都比 Windows 的字符串匹配可靠。传 '*' 拿全部接口再求和，避开 network[0]
 * 恰好取到静默接口（回环、虚拟网卡）而恒显示 0 的问题。
 */
const collectPortableNetworkRates = async (): Promise<{ received: number; sent: number }> => {
  const stats = await si.networkStats('*')
  let received = 0
  let sent = 0
  for (const stat of stats) {
    if (stat.operstate?.toLowerCase() === 'down') continue
    received += typeof stat.rx_sec === 'number' && Number.isFinite(stat.rx_sec) ? stat.rx_sec : 0
    sent += typeof stat.tx_sec === 'number' && Number.isFinite(stat.tx_sec) ? stat.tx_sec : 0
  }
  return { received, sent }
}

let windowsBaseline = new Map<string, CounterSample>()

const networkMetric = (received: number, sent: number): NonNullable<CollectorResult['network']> => ({
  available: true,
  value: received + sent,
  unit: 'B/s',
  extras: [{ label: '下载', value: received, unit: 'B/s' }, { label: '上传', value: sent, unit: 'B/s' }]
})

export async function collectNetworkMetric(): Promise<CollectorResult> {
  try {
    if (process.platform === 'win32') {
      const rates = accumulateRates(await readWindowsAdapterCounters(), windowsBaseline)
      windowsBaseline = rates.baseline
      return { network: networkMetric(rates.received, rates.sent) }
    }
    const rates = await collectPortableNetworkRates()
    return { network: networkMetric(rates.received, rates.sent) }
  } catch {
    return { network: { available: false, reason: '未检测到网络接口' } }
  }
}
