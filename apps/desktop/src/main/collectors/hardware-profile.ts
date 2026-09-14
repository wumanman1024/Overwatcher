import si from 'systeminformation'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HardwareField, HardwareProfile, HardwareSection } from '@hardware-overlay/shared/metrics'
import { formatBytes } from './base'

const execFileAsync = promisify(execFile)

interface DesktopDisplayMetric {
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
}

interface NativeDisplayMode {
  instanceName: string
  width: number
  height: number
}

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

const field = (label: string, value: unknown, suffix = ''): HardwareField | undefined => {
  const normalized = text(value)
  return normalized ? { label, value: `${normalized}${suffix}` } : undefined
}

const fields = (...items: Array<HardwareField | undefined>): HardwareField[] => items.filter((item): item is HardwareField => Boolean(item))
const bytes = (value: unknown): string | undefined => typeof value === 'number' && value > 0 ? formatBytes(value) : undefined
const ghz = (value: unknown): string | undefined => typeof value === 'number' && value > 0 ? `${value.toFixed(2)} GHz` : undefined

const collectWindowsNativeDisplayModes = async (): Promise<NativeDisplayMode[]> => {
  if (process.platform !== 'win32') return []
  const command = "$items = Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorListedSupportedSourceModes -ErrorAction SilentlyContinue | Where-Object { $_.Active }; $items | ForEach-Object { $mode = $_.MonitorSourceModes[$_.PreferredMonitorSourceModeIndex]; [PSCustomObject]@{ instanceName = $_.InstanceName; width = $mode.HorizontalActivePixels; height = $mode.VerticalActivePixels } } | ConvertTo-Json -Compress"
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 3500, windowsHide: true })
    const parsed = JSON.parse(stdout.trim() || '[]') as NativeDisplayMode | NativeDisplayMode[]
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => item.instanceName && item.width > 0 && item.height > 0)
  } catch {
    return []
  }
}

export async function collectHardwareProfile(desktopDisplays: DesktopDisplayMetric[] = []): Promise<HardwareProfile> {
  const [system, board, cpu, memory, graphics, disks, networks, os] = await Promise.all([
    si.system(), si.baseboard(), si.cpu(), si.memLayout(), si.graphics(), si.diskLayout(), si.networkInterfaces(), si.osInfo()
  ])
  const nativeDisplayModes = await collectWindowsNativeDisplayModes()

  const memoryTotal = memory.reduce((total, item) => total + (item.size ?? 0), 0)
  const memoryModels = [...new Set(memory.map((item) => [item.manufacturer, item.partNum].filter(Boolean).join(' ')).filter(Boolean))]
  const gpuModels = graphics.controllers.map((item) => item.model).filter(Boolean)
  const diskModels = disks.map((item) => item.name || item.device).filter(Boolean)
  const mainDisplay = graphics.displays.find((item) => item.main) ?? graphics.displays[0]

  const sections: HardwareSection[] = [
    {
      key: 'system', title: '电脑概览', icon: 'PC', summary: [system.manufacturer, system.model].filter(Boolean).join(' ') || os.hostname || '本机',
      fields: fields(
        field('设备名称', os.hostname), field('制造商', system.manufacturer), field('设备型号', system.model), field('产品版本', system.version),
        field('操作系统', os.distro), field('系统版本', os.release), field('系统架构', os.arch), field('内核版本', os.kernel), field('平台', os.platform)
      )
    },
    {
      key: 'cpu', title: '处理器', icon: 'CPU', summary: cpu.brand || cpu.manufacturer || '处理器',
      fields: fields(
        field('处理器型号', cpu.brand), field('制造商', cpu.manufacturer), field('物理核心', cpu.physicalCores), field('逻辑线程', cpu.cores),
        field('处理器数量', cpu.processors), field('基础频率', ghz(cpu.speed)), field('最低频率', ghz(cpu.speedMin)), field('最高频率', ghz(cpu.speedMax)),
        field('插槽', cpu.socket), field('虚拟化', cpu.virtualization ? '支持' : '不支持'), field('一级数据缓存', bytes(cpu.cache?.l1d)),
        field('一级指令缓存', bytes(cpu.cache?.l1i)), field('二级缓存', bytes(cpu.cache?.l2)), field('三级缓存', bytes(cpu.cache?.l3))
      )
    },
    {
      key: 'board', title: '主板', icon: 'MB', summary: [board.manufacturer, board.model].filter(Boolean).join(' ') || '主板信息',
      fields: fields(field('制造商', board.manufacturer), field('主板型号', board.model), field('版本', board.version), field('芯片组', board.chipset), field('资产标签', board.assetTag))
    },
    {
      key: 'memory', title: '内存', icon: 'RAM', summary: `${bytes(memoryTotal) ?? '未知容量'} · ${memory.length} 个内存模块`,
      fields: fields(
        field('总容量', bytes(memoryTotal)), field('内存模块', memory.length), field('规格型号', memoryModels.join(' / ')),
        field('内存类型', [...new Set(memory.map((item) => item.type).filter(Boolean))].join(' / ')),
        field('工作频率', [...new Set(memory.map((item) => item.clockSpeed).filter((value) => value > 0))].join(' / '), ' MHz'),
        field('ECC', memory.some((item) => item.ecc) ? '支持' : '未检测到')
      ),
      groups: memory.map((item, index) => ({
        title: item.bank || `插槽 ${index + 1}`,
        subtitle: [item.manufacturer, item.partNum].filter(Boolean).join(' ') || item.formFactor || '内存模块',
        fields: fields(field('容量', bytes(item.size)), field('类型', item.type), field('频率', item.clockSpeed, ' MHz'), field('电压', item.voltageConfigured, ' V'), field('外形规格', item.formFactor))
      }))
    },
    {
      key: 'gpu', title: '显卡', icon: 'GPU', summary: gpuModels.join(' / ') || '图形处理器',
      fields: [],
      groups: graphics.controllers.map((item, index) => ({
        title: item.model || `显卡 ${index + 1}`,
        subtitle: item.vendor || '图形处理器',
        fields: fields(field('显存', item.vram, ' MB'), field('总线', item.bus), field('驱动版本', item.driverVersion), field('动态显存', item.vramDynamic ? '支持' : '不支持'))
      }))
    },
    {
      key: 'storage', title: '硬盘', icon: 'SSD', summary: diskModels.join(' / ') || '存储设备',
      fields: [],
      groups: disks.map((item, index) => ({
        title: item.name || item.device || `磁盘 ${index + 1}`,
        subtitle: [item.vendor, item.type].filter(Boolean).join(' · ') || '存储设备',
        status: item.smartStatus ? `SMART ${item.smartStatus}` : undefined,
        fields: fields(field('容量', bytes(item.size)), field('类型', item.type), field('接口', item.interfaceType), field('厂商', item.vendor), field('固件', item.firmwareRevision))
      }))
    },
    {
      key: 'display', title: '显示器', icon: 'DSP', summary: mainDisplay?.model || mainDisplay?.deviceName || '显示设备',
      fields: [],
      groups: graphics.displays.map((item, index) => {
        const desktopDisplay = desktopDisplays.find((display) => display.x === item.positionX && display.y === item.positionY && display.width === item.currentResX && display.height === item.currentResY) ?? desktopDisplays[index]
        const nativeMode = nativeDisplayModes.find((mode) => item.displayId && mode.instanceName.toLowerCase() === item.displayId.toLowerCase())
        const currentWidth = desktopDisplay ? Math.round(desktopDisplay.width * desktopDisplay.scaleFactor) : item.currentResX
        const currentHeight = desktopDisplay ? Math.round(desktopDisplay.height * desktopDisplay.scaleFactor) : item.currentResY
        const nativeWidth = nativeMode?.width ?? item.resolutionX
        const nativeHeight = nativeMode?.height ?? item.resolutionY
        return {
          title: item.model || item.deviceName || `显示器 ${index + 1}`,
          subtitle: item.main ? '主显示器' : `显示器 ${index + 1}`,
          status: item.main ? '主屏' : undefined,
          fields: fields(field('当前分辨率', currentWidth && currentHeight ? `${currentWidth} × ${currentHeight}` : undefined), field('原生分辨率', nativeWidth && nativeHeight ? `${nativeWidth} × ${nativeHeight}` : undefined), field('缩放比例', desktopDisplay ? `${Math.round(desktopDisplay.scaleFactor * 100)}%` : undefined), field('刷新率', item.currentRefreshRate, ' Hz'), field('连接方式', item.connection), field('像素深度', item.pixelDepth, ' bit'))
        }
      })
    },
    {
      key: 'network', title: '网卡', icon: 'NET', summary: `${networks.length} 个网络接口`,
      fields: [],
      groups: networks.map((item, index) => ({
        title: item.ifaceName || item.iface || `接口 ${index + 1}`,
        subtitle: [`IPv4 · ${item.ip4 || '未分配'}`, item.type, item.virtual ? '虚拟接口' : undefined].filter(Boolean).join('  ·  '),
        status: item.operstate || '未知',
        fields: fields(field('IPv4 地址', item.ip4 || '未分配'), field('速率', item.speed, ' Mbps'), field('IPv6 地址', item.ip6), field('MAC 地址', item.mac))
      }))
    }
  ]

  return {
    deviceName: os.hostname || system.model || '本机',
    operatingSystem: [os.distro, os.release].filter(Boolean).join(' '),
    sections: sections.map((section) => ({ ...section, fields: section.fields.length > 0 ? section.fields : [{ label: '状态', value: '系统未提供详细信息' }] }))
  }
}
