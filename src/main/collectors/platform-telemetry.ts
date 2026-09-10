import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import si from 'systeminformation'
import type { CollectorResult } from './sampler'

const execFileAsync = promisify(execFile)
const ramSensorPattern = /(?:dimm|dram|ddr|memory|ram)/i

interface SlowTelemetry {
  refreshRate?: number
  resolution?: string
  ramTemperature?: number
}

let slowTelemetryCache: { expiresAt: number; value: SlowTelemetry } | undefined

async function readNumber(path: string): Promise<number | undefined> {
  try {
    const value = Number((await readFile(path, 'utf8')).trim())
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function readLinuxRamTemperature(): Promise<number | undefined> {
  try {
    const sensors: number[] = []
    const directories = await readdir('/sys/class/hwmon', { withFileTypes: true })
    for (const directory of directories.filter((entry) => entry.isDirectory())) {
      const root = join('/sys/class/hwmon', directory.name)
      const files = await readdir(root)
      for (const labelFile of files.filter((name) => /^temp\d+_label$/.test(name))) {
        const label = (await readFile(join(root, labelFile), 'utf8')).trim()
        if (!ramSensorPattern.test(label)) continue
        const raw = await readNumber(join(root, labelFile.replace('_label', '_input')))
        if (raw !== undefined && raw > 0) sensors.push(raw / 1000)
      }
    }
    return sensors.length > 0 ? Math.round(Math.max(...sensors)) : undefined
  } catch {
    return undefined
  }
}

async function readWindowsRamTemperature(): Promise<number | undefined> {
  const script = [
    "$namespaces = @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')",
    '$values = foreach ($namespace in $namespaces) {',
    '  try { Get-CimInstance -Namespace $namespace -ClassName Sensor -ErrorAction Stop |',
    "    Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'DIMM|DRAM|DDR|Memory|RAM' } |",
    '    Select-Object -ExpandProperty Value } catch {}',
    '}',
    '$values | Sort-Object -Descending | Select-Object -First 1'
  ].join('\n')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 2200, windowsHide: true })
    const value = Number(String(stdout).trim())
    return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
  } catch {
    return undefined
  }
}

async function readRamTemperature(): Promise<number | undefined> {
  if (process.platform === 'linux') return readLinuxRamTemperature()
  if (process.platform === 'win32') return readWindowsRamTemperature()
  // macOS 没有稳定且免提权的系统 RAM 温度接口。
  return undefined
}

async function readDisplay(): Promise<Pick<SlowTelemetry, 'refreshRate' | 'resolution'>> {
  try {
    const graphics = await si.graphics()
    const display = graphics.displays.find((item) => item.main) ?? graphics.displays[0]
    const refreshRate = display?.currentRefreshRate
    const width = display?.currentResX ?? display?.resolutionX
    const height = display?.currentResY ?? display?.resolutionY
    return {
      ...(typeof refreshRate === 'number' && refreshRate > 0 ? { refreshRate } : {}),
      ...(width && height ? { resolution: `${width}×${height}` } : {})
    }
  } catch {
    return {}
  }
}

async function getSlowTelemetry(): Promise<SlowTelemetry> {
  if (slowTelemetryCache && slowTelemetryCache.expiresAt > Date.now()) return slowTelemetryCache.value
  const [display, ramTemperature] = await Promise.all([readDisplay(), readRamTemperature()])
  const value = { ...display, ...(ramTemperature !== undefined ? { ramTemperature } : {}) }
  slowTelemetryCache = { expiresAt: Date.now() + 10_000, value }
  return value
}

async function readLinuxBatteryPower(): Promise<number | undefined> {
  try {
    const directories = await readdir('/sys/class/power_supply', { withFileTypes: true })
    for (const directory of directories.filter((entry) => entry.isDirectory() && /^BAT/i.test(entry.name))) {
      const root = join('/sys/class/power_supply', directory.name)
      const power = await readNumber(join(root, 'power_now'))
      if (power !== undefined && power > 0) return power / 1_000_000
      const [current, voltage] = await Promise.all([
        readNumber(join(root, 'current_now')),
        readNumber(join(root, 'voltage_now'))
      ])
      if (current !== undefined && voltage !== undefined && current > 0 && voltage > 0) return current * voltage / 1_000_000_000_000
    }
  } catch {
    // No battery or the platform does not expose power_supply.
  }
  return undefined
}

async function readWindowsBatteryPower(): Promise<number | undefined> {
  const script = [
    '$battery = Get-CimInstance -Namespace root/WMI -ClassName BatteryStatus -ErrorAction Stop | Select-Object -First 1',
    'if ($battery) {',
    '  if ($battery.Charging -and $battery.ChargeRate -gt 0) { $battery.ChargeRate }',
    '  elseif ($battery.DischargeRate -gt 0) { $battery.DischargeRate }',
    '}'
  ].join('\n')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 2200, windowsHide: true })
    const milliwatts = Number(String(stdout).trim())
    return Number.isFinite(milliwatts) && milliwatts > 0 ? milliwatts / 1000 : undefined
  } catch {
    return undefined
  }
}

async function readMacBatteryPower(): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync('ioreg', ['-r', '-n', 'AppleSmartBattery', '-d', '1'], { timeout: 1800 })
    const output = String(stdout)
    let amperage = Number(output.match(/"InstantAmperage"\s*=\s*(-?\d+)/)?.[1])
    const voltage = Number(output.match(/"Voltage"\s*=\s*(\d+)/)?.[1])
    if (amperage > 0x7fffffff) amperage -= 0x100000000
    const watts = Math.abs(amperage * voltage) / 1_000_000
    return Number.isFinite(watts) && watts > 0 ? watts : undefined
  } catch {
    return undefined
  }
}

async function readBatteryPower(): Promise<number | undefined> {
  if (process.platform === 'linux') return readLinuxBatteryPower()
  if (process.platform === 'win32') return readWindowsBatteryPower()
  if (process.platform === 'darwin') return readMacBatteryPower()
  return undefined
}

export async function collectPlatformTelemetry(): Promise<CollectorResult> {
  const [slow, battery, watts] = await Promise.all([
    getSlowTelemetry(),
    si.battery().catch(() => undefined),
    readBatteryPower()
  ])

  const result: CollectorResult = {
    display: slow.refreshRate !== undefined
      ? { available: true, value: slow.refreshRate, unit: 'Hz', detail: slow.resolution }
      : { available: false, reason: '系统未提供显示器刷新率' },
    power: battery?.hasBattery && watts !== undefined
      ? {
          available: true,
          value: watts,
          unit: 'W',
          detail: battery.isCharging ? '充电' : battery.acConnected ? '外接电源' : '放电',
          extras: [{ label: '电量', value: battery.percent, unit: '%' }]
        }
      : { available: false, reason: '系统未提供电池功率' }
  }

  if (slow.ramTemperature !== undefined) {
    result.memory = { available: true, extras: [{ label: '温度', value: slow.ramTemperature, unit: '°C' }] }
  }
  return result
}
