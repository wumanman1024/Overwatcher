import si from 'systeminformation'
import type { CollectorResult } from './sampler'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${Number((bytes / 1024 ** (index + 1)).toFixed(1))} ${units[index]}`
}

export function calculateMemoryUsage(memory: { total: number; available: number }): number {
  return ((memory.total - memory.available) / memory.total) * 100
}

export async function collectBaseMetrics(): Promise<CollectorResult> {
  const [load, memory, disks, network, filesystems, cpu, temperature, diskDevices] = await Promise.all([
    si.currentLoad(), si.mem(), si.disksIO(), si.networkStats(), si.fsSize(), si.cpu(), si.cpuTemperature(), si.diskLayout().catch(() => [])
  ])
  const net = network[0]
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
        { label: '读取', value: disks.rIO_sec ?? 0, unit: 'B/s' },
        { label: '写入', value: disks.wIO_sec ?? 0, unit: 'B/s' },
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
