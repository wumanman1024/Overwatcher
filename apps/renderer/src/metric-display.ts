export interface DisplayMetric {
  available: boolean
  value?: number
  unit?: string
}

export function formatMetric(metric: DisplayMetric): string {
  return metric.available ? formatMetricValue(metric.value, metric.unit) : '—'
}

export function formatExtra(value: string | number, unit?: string): string {
  if (typeof value === 'string') return value
  return unit === 'B' ? formatByteSize(value) : formatMetricValue(value, unit)
}
import { formatByteSize, formatMetricValue } from '@hardware-overlay/shared/formatters'
