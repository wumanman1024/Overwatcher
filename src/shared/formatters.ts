const rateUnits = ['B/s', 'KB/s', 'MB/s', 'GB/s']

export function formatNumber(value: number, maximumFractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits }).format(value)
}

export function formatRate(bytesPerSecond: number): string {
  let value = Math.max(0, bytesPerSecond)
  let unit = 0
  while (value >= 1024 && unit < rateUnits.length - 1) {
    value /= 1024
    unit++
  }
  return `${formatNumber(value)} ${rateUnits[unit]}`
}

export function formatMetricValue(value?: number, unit?: string): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (unit === 'B/s') return formatRate(value)
  return `${formatNumber(value)}${unit ?? ''}`
}

export function formatByteSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${formatNumber(value)} ${units[unit]}`
}
