import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CollectorResult } from './sampler'

export function parseMillidegrees(input: string): number {
  return Number(input.trim()) / 1000
}

export async function collectLinuxTemperature(): Promise<CollectorResult> {
  if (process.platform !== 'linux') return {}
  try {
    const zones = await readdir('/sys/class/thermal')
    const zone = zones.find((name) => name.startsWith('thermal_zone'))
    if (!zone) return {}
    const value = parseMillidegrees(await readFile(join('/sys/class/thermal', zone, 'temp'), 'utf8'))
    return { cpu: { available: true, extras: [{ label: '温度', value: `${Math.round(value)}°C` }] } }
  } catch { return {} }
}
