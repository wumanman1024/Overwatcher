import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CollectorResult } from './sampler'

const execFileAsync = promisify(execFile)
const adapterIdPattern = /luid_(0x[\da-f]+_0x[\da-f]+)_phys_/i

export interface GpuEngineSample {
  Path: string
  CookedValue: unknown
}

export function selectActiveGpuUtilization(samples: GpuEngineSample[]): { adapterId: string; utilization: number } | undefined {
  const utilizationByAdapter = new Map<string, number>()
  for (const sample of samples) {
    const adapterId = sample.Path.match(adapterIdPattern)?.[0]?.replace(/_phys_$/i, '')
    const utilization = Number(sample.CookedValue)
    if (!adapterId || !Number.isFinite(utilization) || utilization < 0) continue
    utilizationByAdapter.set(adapterId.toLowerCase(), Math.max(utilizationByAdapter.get(adapterId.toLowerCase()) ?? 0, utilization))
  }

  let active: { adapterId: string; utilization: number } | undefined
  for (const [adapterId, utilization] of utilizationByAdapter) {
    if (!active || utilization > active.utilization) active = { adapterId, utilization }
  }
  return active
}

function parseSamples(output: string): GpuEngineSample[] {
  const value: unknown = JSON.parse(output)
  const entries = Array.isArray(value) ? value : [value]
  return entries.filter((entry): entry is GpuEngineSample => Boolean(entry) && typeof entry === 'object' && 'Path' in entry && 'CookedValue' in entry && typeof entry.Path === 'string')
}

export async function collectWindowsGpuMetrics(): Promise<CollectorResult> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Get-Counter '\\GPU Engine(*)\\Utilization Percentage' |",
    '  Select-Object -ExpandProperty CounterSamples |',
    '  Select-Object Path, CookedValue |',
    '  ConvertTo-Json -Compress'
  ].join('\n')

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, windowsHide: true })
    const active = selectActiveGpuUtilization(parseSamples(String(stdout)))
    if (!active) return { gpu: { available: false, reason: '系统未提供 GPU 利用率' } }
    return {
      gpu: {
        available: true,
        value: Math.round(active.utilization * 10) / 10,
        unit: '%',
        detail: '当前活跃 GPU'
      }
    }
  } catch {
    return { gpu: { available: false, reason: '系统未提供 GPU 利用率' } }
  }
}
