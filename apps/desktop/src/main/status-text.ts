import type { MetricSnapshot, MetricValue } from '@hardware-overlay/shared/metrics'
import { formatMetricValue, formatRate } from '@hardware-overlay/shared/formatters'

const findRate = (metric: MetricValue, label: string): number | undefined => {
  const value = metric.extras?.find((extra) => extra.label === label)?.value
  return typeof value === 'number' ? value : undefined
}

export function formatStatusText(snapshot: MetricSnapshot): string {
  const parts: string[] = []
  if (snapshot.cpu.available) parts.push(`CPU ${formatMetricValue(snapshot.cpu.value, '%')}`)
  if (snapshot.memory.available) parts.push(`RAM ${formatMetricValue(snapshot.memory.value, '%')}`)
  if (snapshot.gpu.available) parts.push(`GPU ${formatMetricValue(snapshot.gpu.value, '%')}`)
  const down = findRate(snapshot.network, '下载')
  const up = findRate(snapshot.network, '上传')
  if (down !== undefined) parts.push(`↓ ${formatRate(down)}`)
  if (up !== undefined) parts.push(`↑ ${formatRate(up)}`)
  return parts.join(' · ')
}
