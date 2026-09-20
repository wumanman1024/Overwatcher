import si from 'systeminformation'
import type { CollectorResult } from './sampler'
import { createCache } from './cache'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${Number((bytes / 1024 ** (index + 1)).toFixed(1))} ${units[index]}`
}

export function calculateMemoryUsage(memory: { total: number; available: number }): number {
  return ((memory.total - memory.available) / memory.total) * 100
}

export function getDiskIoRates(disks: { rIO_sec?: number | null; wIO_sec?: number | null } | null | undefined): { read: number; write: number } {
  return { read: disks?.rIO_sec ?? 0, write: disks?.wIO_sec ?? 0 }
}

/*
 * 采集分频：磁盘容量 / 布局 / CPU 静态信息几乎不变，而 Windows 下每次
 * systeminformation 调用都可能拉起 PowerShell 子进程，用 TTL 缓存把它们
 * 挪出 1 秒热路径；利用率、内存、磁盘 IO、网速保持实时。
 */
const filesystemsCache = createCache(() => si.fsSize().catch(() => []), { ttlMs: 60_000 })
const diskLayoutCache = createCache(() => si.diskLayout().catch(() => []), { ttlMs: 60_000 })
const cpuInfoCache = createCache(() => si.cpu(), { ttlMs: 60_000 })
const cpuTemperatureCache = createCache(() => si.cpuTemperature().catch(() => ({ main: -1 } as Awaited<ReturnType<typeof si.cpuTemperature>>)), { ttlMs: 5_000 })
const diskIoCache = createCache(() => si.disksIO().catch(() => null), { ttlMs: 3_000 })

export async function collectBaseMetrics(): Promise<CollectorResult> {
  const [load, memory, network, disks, filesystems, cpu, temperature, diskDevices] = await Promise.all([
    si.currentLoad(), si.mem(), si.networkStats(), diskIoCache(), filesystemsCache(), cpuInfoCache(), cpuTemperatureCache(), diskLayoutCache()
  ])
  const net = network[0]
  const diskIoRates = getDiskIoRates(disks)
  const diskSize = filesystems.reduce((total, filesystem) => total + filesystem.size, 0)
  const diskUsed = filesystems.reduce((total, filesystem) => total + filesystem.used, 0)
  const diskTemperatures = diskDevices
    .map((disk) => disk.temperature)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
  const diskTemperature = diskTemperatures.length > 0 ? Math.round(Math.max(...diskTemperatures)) : undefined
  const cpuExtras = [
    { label: '频率', value: `${cpu.speed.toFixed(2)} GHz` },
    { label: '核心', value: `${cpu.cores} 核 / ${cpu.physicalCores} 线程` },
    ...(temperature.main > 0 ? [{ label: '温度', value: `${Math.round(temperature.main)}°C` }] : [])
  ]
  return {
    cpu: { available: true, value: load.currentLoad, unit: '%', extras: cpuExtras },
    memory: {
      available: true,
      value: calculateMemoryUsage(memory),
      unit: '%',
      extras: [{ label: '已用', value: memory.total - memory.available, unit: 'B' }, { label: '总量', value: memory.total, unit: 'B' }]
    },
    disk: {
      available: true,
      value: diskSize > 0 ? (diskUsed / diskSize) * 100 : 0,
      unit: '%',
      extras: [
        { label: '已用', value: diskUsed, unit: 'B' },
        { label: '总量', value: diskSize, unit: 'B' },
        { label: '读取', value: diskIoRates.read, unit: 'B/s' },
        { label: '写入', value: diskIoRates.write, unit: 'B/s' },
        ...(diskTemperature !== undefined ? [{ label: '温度', value: diskTemperature, unit: '°C' }] : [])
      ]
    },
    network: net ? {
      available: true,
      value: net.rx_sec + net.tx_sec,
      unit: 'B/s',
      extras: [{ label: '下载', value: net.rx_sec, unit: 'B/s' }, { label: '上传', value: net.tx_sec, unit: 'B/s' }]
    } : { available: false, reason: '未检测到网络接口' }
  }
}
