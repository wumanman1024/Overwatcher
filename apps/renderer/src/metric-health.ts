import type { MetricKey, MetricValue } from '@localforge/shared/metrics'

export type MetricHealth = 'normal' | 'warning' | 'danger'

type Threshold = { warning: number; danger: number }

const utilizationThresholds: Partial<Record<MetricKey, Threshold>> = {
  cpu: { warning: 80, danger: 95 },
  gpu: { warning: 85, danger: 98 },
  memory: { warning: 85, danger: 95 },
  disk: { warning: 85, danger: 95 }
}

const temperatureThreshold: Threshold = { warning: 80, danger: 90 }
const rank: Record<MetricHealth, number> = { normal: 0, warning: 1, danger: 2 }

export function healthForValue(value: number | undefined, threshold: Threshold | undefined): MetricHealth {
  if (value === undefined || !Number.isFinite(value) || !threshold) return 'normal'
  if (value >= threshold.danger) return 'danger'
  if (value >= threshold.warning) return 'warning'
  return 'normal'
}

export function metricHealth(key: MetricKey, metric: MetricValue | undefined): MetricHealth {
  if (!metric?.available) return 'normal'

  const states = [healthForValue(metric.value, utilizationThresholds[key])]
  if (key === 'cpu' || key === 'gpu') {
    for (const extra of metric.extras ?? []) {
      if (extra.label.includes('温度') && typeof extra.value === 'number') states.push(healthForValue(extra.value, temperatureThreshold))
    }
  }

  return states.reduce((highest, state) => rank[state] > rank[highest] ? state : highest, 'normal' as MetricHealth)
}

export const metricHealthLabel: Record<MetricHealth, string> = {
  normal: '正常',
  warning: '警告',
  danger: '危险'
}
