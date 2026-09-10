import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CollectorResult } from './sampler'

const execFileAsync = promisify(execFile)

export function parseNvidiaCsv(output: string): CollectorResult['gpu'] {
  const [utilization, usedMemory, totalMemory, temperature] = output.trim().split(',').map((item) => Number(item.trim()))
  if ([utilization, usedMemory, totalMemory, temperature].some(Number.isNaN)) return { available: false, reason: 'GPU 数据格式无效' }
  return {
    available: true,
    value: utilization,
    unit: '%',
    extras: [
      { label: '温度', value: temperature, unit: '°C' },
      { label: '显存已用', value: usedMemory, unit: 'MiB' },
      { label: '显存总量', value: totalMemory, unit: 'MiB' }
    ]
  }
}

export async function collectNvidiaMetrics(): Promise<CollectorResult> {
  if (process.platform !== 'linux' && process.platform !== 'win32') return { gpu: { available: false, reason: '当前系统未提供 NVIDIA 采集器' } }
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 1500, windowsHide: true })
    return { gpu: parseNvidiaCsv(stdout) }
  } catch {
    return { gpu: { available: false, reason: '未检测到可用的 NVIDIA 驱动' } }
  }
}
