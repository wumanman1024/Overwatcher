import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface DiskIoRates {
  read: number
  write: number
}

export async function collectWindowsDiskIoRates(): Promise<DiskIoRates | undefined> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Get-Counter -Counter '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec','\\PhysicalDisk(_Total)\\Disk Write Bytes/sec' |",
    '  Select-Object -ExpandProperty CounterSamples |',
    '  Select-Object Path, CookedValue |',
    '  ConvertTo-Json -Compress'
  ].join('\n')

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 2500, windowsHide: true })
    const value: unknown = JSON.parse(String(stdout))
    const samples = Array.isArray(value) ? value : [value]
    if (samples.length !== 2 || samples.some((sample) => !sample || typeof sample !== 'object' || !('CookedValue' in sample))) return undefined

    const read = Number(samples[0].CookedValue)
    const write = Number(samples[1].CookedValue)
    return Number.isFinite(read) && read >= 0 && Number.isFinite(write) && write >= 0 ? { read, write } : undefined
  } catch {
    return undefined
  }
}
