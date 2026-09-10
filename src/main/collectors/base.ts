import si from 'systeminformation'
import type { CollectorResult } from './sampler'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${Number((bytes / 1024 ** (index + 1)).toFixed(1))} ${units[index]}`
}

export async function collectBaseMetrics(): Promise<CollectorResult> {
  const [load, memory, disks, network, filesystems, cpu, temperature] = await Promise.all([
    si.currentLoad(), si.mem(), si.disksIO(), si.networkStats(), si.fsSize(), si.cpu(), si.cpuTemperature()
  ])
  const net = network[0]
  const diskSize = filesystems.reduce((total, filesystem) => total + filesystem.size, 0)
  const diskUsed = filesystems.reduce((total, filesystem) => total + filesystem.used, 0)
  const cpuExtras = [
    { label: '频率', value: `${cpu.speed.toFixed(2)} GHz` },
    { label: '核心', value: `${cpu.cores} 核 / ${cpu.physicalCores} 线程` },
    ...(temperature.main > 0 ? [{ label: '温度', value: `${Math.round(temperature.main)}°C` }] : [])
  ]
  return {
    cpu: { available: true, value: load.currentLoad, unit: '%', extras: cpuExtras },
    memory: {
      available: true,
      value: (memory.used / memory.total) * 100,
      unit: '%',
      extras: [{ label: '已用', value: memory.used, unit: 'B' }, { label: '总量', value: memory.total, unit: 'B' }]
    },
    disk: {
      available: true,
      value: diskSize > 0 ? (diskUsed / diskSize) * 100 : 0,
      unit: '%',
      extras: [
        { label: '已用', value: diskUsed, unit: 'B' },
        { label: '总量', value: diskSize, unit: 'B' },
        { label: '读取', value: disks.rIO_sec, unit: 'B/s' },
        { label: '写入', value: disks.wIO_sec, unit: 'B/s' }
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
