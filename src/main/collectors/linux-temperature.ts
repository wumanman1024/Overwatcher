import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CollectorResult } from './sampler'

export function parseMillidegrees(input: string): number {
  return Number(input.trim()) / 1000
}

function cpuZonePriority(type: string): number | undefined {
  if (/^x86_pkg_temp$/i.test(type)) return 0
  if (/(?:package|tctl|tdie)/i.test(type)) return 1
  if (/^tcpu(?:_pci)?$/i.test(type)) return 2
  if (/(?:cpu.*thermal|thermal.*cpu)/i.test(type)) return 3
  return undefined
}

export async function collectLinuxTemperature(): Promise<CollectorResult> {
  if (process.platform !== 'linux') return {}
  try {
    const zones = await readdir('/sys/class/thermal')
    const candidates = await Promise.all(zones
      .filter((name) => name.startsWith('thermal_zone'))
      .map(async (zone) => {
        const root = join('/sys/class/thermal', zone)
        const type = (await readFile(join(root, 'type'), 'utf8')).trim()
        const priority = cpuZonePriority(type)
        if (priority === undefined) return undefined
        const value = parseMillidegrees(await readFile(join(root, 'temp'), 'utf8'))
        return Number.isFinite(value) && value > 0 ? { priority, value } : undefined
      }))
    const selected = candidates
      .filter((item): item is { priority: number; value: number } => item !== undefined)
      .sort((a, b) => a.priority - b.priority || b.value - a.value)[0]
    if (!selected) return {}
    return { cpu: { available: true, extras: [{ label: '温度', value: Math.round(selected.value), unit: '°C' }] } }
  } catch { return {} }
}
